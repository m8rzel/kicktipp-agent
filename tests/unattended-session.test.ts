import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Unattended runs: an agent places bets with nobody at the screen. These
 * tests drive the built server against a stand-in Kicktipp and check that an
 * expired session is healed with the stored password instead of ending in a
 * setup link, and that nothing is reported as submitted that Kicktipp threw
 * away.
 */

const EMAIL = 'me@example.com';
const PASSWORD = 'correct horse';

const LOGIN_FORM = `<html><body>
  <form method="post" action="/info/profil/login">
    <input type="text" name="kennung" value="">
    <input type="password" name="passwort" value="">
    <button type="submit" name="submitbutton" value="Anmelden">Anmelden</button>
  </form></body></html>`;

const COMMUNITIES = `<html><body><div id="kicktipp-content">
  <a href="/mycomm">mycomm</a></div></body></html>`;

const PREDICT = `<html><body><div id="kicktipp-content">
  <form method="post" action="/mycomm/tippabgabe">
    <input type="hidden" name="spieltagIndex" value="5">
    <table id="tippabgabeSpiele"><tbody>
      <tr><td>Sa 20:30</td><td>Alpha</td><td>Beta</td>
        <td><input id="m1_heimTipp" name="spielTipp[1].heimTipp" value="">
            <input id="m1_gastTipp" name="spielTipp[1].gastTipp" value=""></td></tr>
    </tbody></table>
    <button type="submit" name="submitbutton" value="Tipps speichern">Tipps speichern</button>
  </form></div></body></html>`;

const BONUS = `<html><body><div id="kicktipp-content">
  <form method="post" action="/mycomm/tippabgabe">
    <input type="hidden" name="bonus" value="true">
    <table id="tippabgabeFragen"><tbody>
      <tr><td>Fr 18:00</td><td>Who wins the title?</td>
        <td><select name="bonusTipp[7]"><option value="-1">--</option>
          <option value="11">Alpha</option><option value="12">Beta</option></select></td></tr>
    </tbody></table>
    <button type="submit" name="submitbutton" value="Tipps speichern">Tipps speichern</button>
  </form></div></body></html>`;

/** When the stand-in drops the session: never, once, or on every tip page. */
type Expiry = 'none' | 'on-first-load' | 'on-first-submit' | 'on-every-load';

interface FakeKicktipp {
  url: string;
  logins: number;
  saved: URLSearchParams[];
  close(): Promise<void>;
}

/** Cookie-gated pages behind a login form; can drop the session once. */
async function fakeKicktipp(expiry: Expiry): Promise<FakeKicktipp> {
  const valid = new Set<string>();
  let nextSid = 1;
  let expired = false;
  const state = { logins: 0, saved: [] as URLSearchParams[] };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const sid = /sid=(\d+)/.exec(req.headers.cookie || '')?.[1];
      const authed = !!sid && valid.has(sid);
      const [path, query = ''] = (req.url || '/').split('?');
      const send = (status: number, html: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
        res.end(html);
      };
      const toLogin = () => send(302, '', { location: '/info/profil/login' });
      const dropSession = () => {
        expired = true;
        valid.delete(sid!);
      };

      if (path === '/info/profil/login') {
        if (req.method === 'GET') return send(200, LOGIN_FORM);
        const form = new URLSearchParams(body);
        if (form.get('kennung') === EMAIL && form.get('passwort') === PASSWORD) {
          const fresh = String(nextSid++);
          valid.add(fresh);
          state.logins++;
          return send(302, '', { location: '/', 'set-cookie': `sid=${fresh}; Path=/; HttpOnly` });
        }
        return send(200, LOGIN_FORM);
      }
      if (!authed) return toLogin();
      if (path === '/') return send(200, '<html><body>Start</body></html>');
      if (path === '/info/profil/meinetipprunden') return send(200, COMMUNITIES);
      if (path === '/mycomm/tippabgabe' && req.method === 'GET') {
        if (expiry === 'on-every-load' || (expiry === 'on-first-load' && !expired)) {
          dropSession();
          return toLogin();
        }
        return send(200, new URLSearchParams(query).get('bonus') === 'true' ? BONUS : PREDICT);
      }
      if (path === '/mycomm/tippabgabe' && req.method === 'POST') {
        if (expiry === 'on-first-submit' && !expired) {
          dropSession();
          return toLogin(); // Kicktipp throws the bets away
        }
        state.saved.push(new URLSearchParams(body));
        return send(302, '', { location: '/mycomm/tippabgabe' });
      }
      return send(404, '<html><body>Seite wurde nicht gefunden</body></html>');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    get logins() {
      return state.logins;
    },
    saved: state.saved,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Call one tool on the built server and wait for its answer. */
function callTool(name: string, args: object, env: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['dist/server.js'], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${name}: no answer within 15 s`));
    }, 15_000);
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(msg.result);
        }
      }
    });
    child.on('error', reject);
    const send = (msg: object) => child.stdin.write(JSON.stringify(msg) + '\n');
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
  });
}

let home: string;
let kicktipp: FakeKicktipp | undefined;

function writeConfig(auth: string): void {
  const dir = path.join(home, '.config', 'kicktipp-agent');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.ini'),
    `[auth]\nemail = ${EMAIL}\n${auth}\n[community]\nname = mycomm\n`,
  );
}

const withPassword = (password: string) => `password = ${password}`;

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    HOME: home,
    KICKTIPP_DATA_DIR: path.join(home, 'data'),
    KICKTIPP_BASE_URL: kicktipp!.url,
    ...extra,
  };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'kicktipp-unattended-'));
});

afterEach(async () => {
  await kicktipp?.close();
  kicktipp = undefined;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('unattended betting', () => {
  it('logs in again when the session expired before the form loaded', async () => {
    kicktipp = await fakeKicktipp('on-first-load');
    writeConfig(withPassword(PASSWORD));

    const result = await callTool('place_bets', { bets: ['Alpha vs Beta=2:1'] }, env());

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.data).toMatchObject({ success: true, dry_run: false });
    expect(kicktipp.logins).toBe(2);
    expect(kicktipp.saved).toHaveLength(1);
    expect(kicktipp.saved[0].get('spielTipp[1].heimTipp')).toBe('2');
    expect(kicktipp.saved[0].get('spielTipp[1].gastTipp')).toBe('1');
  });

  it('sends the bets again when Kicktipp dropped the session on submit', async () => {
    kicktipp = await fakeKicktipp('on-first-submit');
    writeConfig(withPassword(PASSWORD));

    const result = await callTool('place_bets', { bets: ['Alpha vs Beta=3:0'] }, env());

    expect(result.isError).toBeFalsy();
    expect(kicktipp.logins).toBe(2);
    expect(kicktipp.saved).toHaveLength(1);
    expect(kicktipp.saved[0].get('spielTipp[1].heimTipp')).toBe('3');

    const audit = fs
      .readFileSync(path.join(home, 'data', 'audit', 'mycomm.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).outcome);
    expect(audit[0]).toBe('intent');
    expect(audit[1]).toMatch(/^failed:.*The bets were not saved/);
    expect(audit.slice(2)).toEqual(['intent', 'submitted']);
  });

  it('retries bonus answers the same way', async () => {
    kicktipp = await fakeKicktipp('on-first-submit');
    writeConfig(withPassword(PASSWORD));

    const result = await callTool('place_bonus_bets', { bets: ['Who wins the title?=Beta'] }, env());

    expect(result.isError).toBeFalsy();
    expect(kicktipp.logins).toBe(2);
    expect(kicktipp.saved).toHaveLength(1);
    expect(kicktipp.saved[0].get('bonusTipp[7]')).toBe('12');
  });

  it('gives up after one fresh login, without a setup link', async () => {
    kicktipp = await fakeKicktipp('on-every-load');
    writeConfig(withPassword(PASSWORD));

    const result = await callTool('place_bets', { bets: ['Alpha vs Beta=2:1'] }, env());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Logged in to Kicktipp again, but it still sends this request to the login page/);
    expect(result.content[0].text).not.toMatch(/setup\?token=/);
    expect(kicktipp.logins).toBe(2);
    expect(kicktipp.saved).toHaveLength(0);
  });

  it('works with credentials from the environment alone', async () => {
    kicktipp = await fakeKicktipp('on-first-load');

    const result = await callTool(
      'place_bets',
      { bets: ['Alpha vs Beta=1:1'] },
      env({ KICKTIPP_EMAIL: EMAIL, KICKTIPP_PASSWORD: PASSWORD, KICKTIPP_COMMUNITY: 'mycomm' }),
    );

    expect(result.isError).toBeFalsy();
    expect(kicktipp.saved).toHaveLength(1);
  });
});

describe('connect_account', () => {
  it('verifies a working login and hands out no setup link', async () => {
    kicktipp = await fakeKicktipp('none');
    writeConfig(withPassword(PASSWORD));

    const result = await callTool('connect_account', {}, env());
    const data = result.structuredContent.data;

    expect(data).toMatchObject({ connected: true, login_verified: true, setup_url: null, community: 'mycomm' });
    expect(kicktipp.logins).toBe(1);
  });

  it('says the password was rejected, not that the session expired', async () => {
    kicktipp = await fakeKicktipp('none');
    writeConfig(withPassword('wrong'));

    const result = await callTool('connect_account', {}, env());
    const data = result.structuredContent.data;

    expect(data.connected).toBe(false);
    expect(data.reason).toBe('rejected');
    expect(data.setup_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/setup\?token=/);
    expect(data.message).toMatch(/rejected the saved email and password/);
    expect(data.message).not.toMatch(/expired/);
  });

  it('points at the client config when environment credentials are wrong', async () => {
    kicktipp = await fakeKicktipp('none');

    const result = await callTool(
      'connect_account',
      {},
      env({ KICKTIPP_EMAIL: EMAIL, KICKTIPP_PASSWORD: 'wrong', KICKTIPP_COMMUNITY: 'mycomm' }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/KICKTIPP_EMAIL \/ KICKTIPP_PASSWORD from the environment/);
  });

  it('treats reconnect as a check, not as a reason to send the user away', async () => {
    kicktipp = await fakeKicktipp('none');
    writeConfig(withPassword(PASSWORD));

    const result = await callTool('connect_account', { reconnect: true }, env());

    expect(result.structuredContent.data).toMatchObject({ connected: true, setup_url: null });
  });

  it('hands out a link when the user asks to switch accounts', async () => {
    kicktipp = await fakeKicktipp('none');
    writeConfig(withPassword(PASSWORD));

    const result = await callTool('connect_account', { switch_account: true }, env());
    const data = result.structuredContent.data;

    expect(data.connected).toBe(false);
    expect(data.setup_url).toMatch(/\/setup\?token=/);
    expect(kicktipp.logins).toBe(0);
  });

  it.each([
    ['missing', null, /Not set up yet/],
    ['session_only_expired', 'store = session', /session-only mode/],
    // Encrypted for some other host: decrypting it fails.
    ['unreadable', `password = enc.${Buffer.alloc(48, 7).toString('base64')}`, /cannot be read on this machine/],
  ])('names the reason: %s', async (reason, auth, message) => {
    kicktipp = await fakeKicktipp('none');
    if (auth) writeConfig(auth);

    const result = await callTool('connect_account', {}, env());
    const data = result.structuredContent.data;

    expect(data).toMatchObject({ connected: false, reason });
    expect(data.setup_url).toMatch(/\/setup\?token=/);
    expect(data.message).toMatch(message);
    expect(kicktipp.logins).toBe(0);
  });
});

describe('get_status', () => {
  it.each([
    ['env', null, { KICKTIPP_EMAIL: EMAIL, KICKTIPP_PASSWORD: PASSWORD }],
    ['password', withPassword(PASSWORD), {}],
    ['session_only', 'store = session', {}],
    ['none', null, {}],
  ])('reports auth_mode %s without going online', async (mode, auth, extra) => {
    kicktipp = await fakeKicktipp('none');
    if (auth) writeConfig(auth);

    const result = await callTool('get_status', {}, env(extra as Record<string, string>));

    expect(result.structuredContent.data.auth_mode).toBe(mode);
    expect(kicktipp.logins).toBe(0);
  });
});
