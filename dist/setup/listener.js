import http from 'http';
import crypto from 'crypto';
import { CookieJar } from '../http/cookie-jar.js';
import { Page } from '../http/page.js';
import { getCommunities, login } from '../browser.js';
import { saveAuth, saveCommunity, saveReadOnly, saveUiLanguage, saveUiSite, sessionFile } from '../config.js';
import { communityPage, donePage, forbiddenPage, loginPage } from './html.js';
import { parseLanguage, setLanguage, t } from '../i18n/index.js';
import { parseSite, setUrlBase, siteLabel } from '../url.js';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
function tokensMatch(expected, given) {
    if (!given)
        return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    if (a.length !== b.length)
        return false;
    return crypto.timingSafeEqual(a, b);
}
function headerLine(value) {
    if (value === undefined)
        return undefined;
    return Array.isArray(value) ? value[0] : value;
}
function isLoopbackHost(host, port) {
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
function isLoopbackOrigin(origin, port) {
    if (!origin || origin === 'null')
        return true;
    return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}
function isLoopbackRequest(req, port) {
    const host = headerLine(req.headers.host) ?? '';
    if (!isLoopbackHost(host, port))
        return false;
    const method = req.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD')
        return true;
    return isLoopbackOrigin(headerLine(req.headers.origin), port);
}
function send(res, status, html) {
    return new Promise((resolve) => {
        res.writeHead(status, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Content-Length': Buffer.byteLength(html),
        });
        res.end(html, () => resolve());
    });
}
async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > MAX_BODY_BYTES)
            throw new Error('Request too large');
        chunks.push(buf);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
function tokenFrom(req, body) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    return body?.get('token') || url.searchParams.get('token');
}
/**
 * One-shot loopback listener that collects Kicktipp credentials in a browser
 * form so they never enter the chat or an MCP client's JSON config.
 */
export function startSetupListener(opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let phase = { kind: 'login' };
    let closed = false;
    let settle = () => { };
    const finished = new Promise((resolve) => {
        settle = resolve;
    });
    const token = crypto.randomBytes(32).toString('hex');
    let port = 0;
    const server = http.createServer((req, res) => {
        void handle(req, res);
    });
    async function shutdown(outcome) {
        if (closed)
            return;
        closed = true;
        clearTimeout(timer);
        await new Promise((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
        });
        settle(outcome);
    }
    async function forbid(res) {
        await send(res, 403, forbiddenPage());
    }
    async function rejectToken(res) {
        await forbid(res);
        await shutdown('rejected');
    }
    async function handle(req, res) {
        try {
            if (closed) {
                await forbid(res);
                return;
            }
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (url.pathname !== '/setup') {
                await send(res, 404, forbiddenPage());
                return;
            }
            if (!isLoopbackRequest(req, port)) {
                await forbid(res);
                return;
            }
            const method = req.method ?? 'GET';
            if (method === 'GET' || method === 'HEAD') {
                if (!tokensMatch(token, tokenFrom(req, null))) {
                    await forbid(res);
                    return;
                }
                const html = phase.kind === 'community' ? communityPage(token, phase.communities) : loginPage(token);
                await send(res, 200, method === 'HEAD' ? '' : html);
                return;
            }
            if (method !== 'POST') {
                await send(res, 405, forbiddenPage());
                return;
            }
            const body = await readBody(req);
            if (!tokensMatch(token, tokenFrom(req, body))) {
                await rejectToken(res);
                return;
            }
            const step = body.get('step');
            if (step === 'community' && phase.kind === 'community') {
                const community = body.get('community') ?? '';
                if (!phase.communities.includes(community)) {
                    await send(res, 200, communityPage(token, phase.communities, 'Pick one of the listed communities.'));
                    return;
                }
                saveCommunity(community);
                opts.onSaved?.();
                await send(res, 200, donePage());
                await shutdown('saved');
                return;
            }
            if (step !== 'login' || phase.kind !== 'login') {
                await send(res, 200, loginPage(token, t('setup.startAgain')));
                return;
            }
            const email = (body.get('email') ?? '').trim();
            const password = body.get('password') ?? '';
            if (!email || !password) {
                await send(res, 200, loginPage(token, t('setup.emailPasswordRequired')));
                return;
            }
            const store = body.get('store') === 'session' ? 'session' : 'password';
            const readOnly = body.get('read_only') === '1';
            const language = parseLanguage(body.get('language'));
            if (language) {
                saveUiLanguage(language);
                setLanguage(language);
            }
            const site = parseSite(body.get('site'));
            if (site) {
                saveUiSite(siteLabel(site));
                setUrlBase(site);
            }
            const page = new Page(new CookieJar(), opts.fetchImpl);
            try {
                await login(page, email, password);
            }
            catch (err) {
                const raw = err instanceof Error ? err.message : '';
                const message = /login failed/i.test(raw)
                    ? t('setup.signInFailed')
                    : raw || t('setup.signInFailed');
                await send(res, 200, loginPage(token, message));
                return;
            }
            saveAuth({ email, password: store === 'password' ? password : undefined, store });
            saveReadOnly(readOnly);
            page.saveSession(sessionFile());
            const communities = await getCommunities(page);
            if (communities.length === 0) {
                opts.onSaved?.();
                await send(res, 200, donePage());
                await shutdown('saved');
                return;
            }
            if (communities.length === 1) {
                saveCommunity(communities[0]);
                opts.onSaved?.();
                await send(res, 200, donePage());
                await shutdown('saved');
                return;
            }
            phase = { kind: 'community', communities };
            await send(res, 200, communityPage(token, communities));
        }
        catch {
            await send(res, 500, loginPage(token, t('setup.somethingWrong')));
        }
    }
    const timer = setTimeout(() => {
        void shutdown('timeout');
    }, timeoutMs);
    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('Setup listener did not bind a TCP port.'));
                return;
            }
            port = addr.port;
            if (opts.keepAlive === false) {
                server.unref();
                timer.unref();
            }
            resolve({
                url: `http://127.0.0.1:${port}/setup?token=${token}`,
                finished,
                close: () => shutdown('rejected'),
            });
        });
        server.on('error', reject);
    });
}
let active = null;
/** Reuse one listener per process so get_status and later tools share the URL. */
export async function ensureSetupListener(opts = {}) {
    if (active)
        return active.url;
    const handle = await startSetupListener(opts);
    active = handle;
    void handle.finished.finally(() => {
        if (active === handle)
            active = null;
    });
    return handle.url;
}
