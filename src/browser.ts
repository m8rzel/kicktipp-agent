import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import fs from 'fs';
import { urlLogin, urlBase, otherSite, getLoginUrlOn, getCommunitiesUrl, getLeaderboardUrl } from './url.js';
import { sessionFile, loadCredentials, isSessionOnly, SessionOnlyExpiredError } from './config.js';
import { status, statusClear } from './helpers/spinner.js';
import { t } from './i18n/index.js';
import { normalizeSlug } from './helpers/normalize-slug.js';
import { CookieJar } from './http/cookie-jar.js';
import { Page } from './http/page.js';
import type { FetchLike } from './http/page.js';

export { Page } from './http/page.js';
export type { FetchLike } from './http/page.js';

export interface LaunchOptions {
  /** Where to persist cookies. Pass null to keep the session in memory only. */
  sessionFile?: string | null;
  /** Injection point for tests. */
  fetchImpl?: FetchLike;
}

/**
 * Open an authenticated Kicktipp session: restore the saved cookies when
 * they still work, otherwise log in and save fresh ones.
 */
export async function launchBrowser(opts: LaunchOptions = {}): Promise<{ page: Page }> {
  const file = opts.sessionFile === undefined ? sessionFile() : opts.sessionFile;

  if (file && fs.existsSync(file)) {
    status(t('status.restoringSession'));
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const page = new Page(CookieJar.fromJSON(stored), opts.fetchImpl);
      await page.goto(getCommunitiesUrl());
      if (!page.isAuthRedirect() && !page.isNotFound()) {
        statusClear();
        return { page };
      }
    } catch {
      // An unreadable or outdated session file is not worth reporting —
      // logging in again produces a good one.
    }
    status(t('status.sessionExpired'));
  }

  if (isSessionOnly()) {
    statusClear();
    throw new SessionOnlyExpiredError();
  }

  statusClear();
  const { email, password } = await loadCredentials();
  const page = new Page(new CookieJar(), opts.fetchImpl);
  await login(page, email, password);
  if (file) page.saveSession(file);
  return { page };
}

/** Kicktipp turned the email/password pair down. Trying again will not help. */
export class LoginFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginFailedError';
  }
}

export async function login(
  page: Page,
  username: string,
  password: string,
  loginUrl: string = urlLogin(),
): Promise<void> {
  status(t('status.loggingIn'));
  await page.goto(loginUrl);

  if (!page.has('input[name="kennung"]')) {
    statusClear();
    throw new Error(t('login.formMissing', { url: page.url() }));
  }

  page.setInputValue('input[name="kennung"]', username);
  page.setInputValue('input[name="passwort"]', password);
  await page.submitForm('input[name="kennung"]');

  // A failed login lands back on the login page.
  if (page.isAuthRedirect()) {
    statusClear();
    throw new LoginFailedError(t('login.failed'));
  }
  statusClear();
}

/**
 * The community lives on the other Kicktipp site, and only a session cookie
 * for the configured one is saved: without a password there is no logging
 * in over there.
 */
export class SessionOnlyOtherSiteError extends Error {
  constructor(readonly site: string) {
    super(`The community lives on ${site}, but only a session for ${urlBase()} is saved, without a password.`);
    this.name = 'SessionOnlyOtherSiteError';
  }
}

/**
 * Kicktipp sent a request to the login page of the other site. A community
 * can live on kicktipp.de while the configured base is kicktipp.com (or the
 * other way round), and a session cookie only counts on the site that set
 * it, so log in there as well.
 *
 * The redirect only decides whether to log in, never where: the password
 * goes to the fixed counterpart of the configured site, with its scheme,
 * and nowhere else. Returns false when there is nothing to do here — the
 * login page is on the configured site (logging in again there is the
 * caller's job), or on any host other than that counterpart.
 */
export async function loginWhereRedirected(
  page: Page,
  loginPage: string | undefined,
  opts: { sessionFile?: string | null } = {},
): Promise<boolean> {
  if (!loginPage) return false;
  const base = new URL(urlBase());
  const other = new URL(otherSite());
  const target = new URL(loginPage);
  if (other.hostname === base.hostname || target.hostname !== other.hostname) return false;
  if (isSessionOnly()) throw new SessionOnlyOtherSiteError(other.origin);
  const { email, password } = await loadCredentials();
  try {
    await login(page, email, password, getLoginUrlOn(other.origin));
  } catch (err) {
    if (!(err instanceof LoginFailedError)) throw err;
    // Not the usual "wrong password": the same login just worked on the
    // configured site, so asking for it again would not help.
    throw new Error(
      `${other.hostname} rejected the email and password that work on ${base.hostname}. The community lives on ${other.hostname}; check the account there.`,
    );
  }
  const file = opts.sessionFile === undefined ? sessionFile() : opts.sessionFile;
  if (file) page.saveSession(file);
  return true;
}

export async function getCommunities(page: Page): Promise<string[]> {
  status(t('status.fetchingCommunities'));
  await page.goto(getCommunitiesUrl());
  if (page.isAuthRedirect()) {
    statusClear();
    throw new Error(
      t('login.notAuthenticated', { url: page.url() }),
    );
  }

  const $ = cheerio.load(await page.content());
  const communities = new Set<string>();
  // A community link is a single path segment ("/<slug>" or "/<slug>/") whose
  // slug matches the link's own label. Kicktipp derives the slug from the
  // community name — dropping underscores and turning spaces into hyphens —
  // so the comparison has to be made on normalized forms.
  const reserved = new Set(['info', 'service']);
  $('#kicktipp-content a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/^\/([^/?#]+)\/?$/);
    if (!match) return;
    const slug = decodeURIComponent(match[1]);
    if (reserved.has(slug.toLowerCase())) return;
    const menuDiv = $(el).find('div.menu-title-mit-tippglocke');
    if (
      normalizeSlug(slug) === normalizeSlug($(el).text().trim()) ||
      (menuDiv.length && normalizeSlug(menuDiv.text().trim()) === normalizeSlug(slug))
    ) {
      communities.add(slug);
    }
  });
  statusClear();
  return Array.from(communities);
}

export function parseOdds($: cheerio.CheerioAPI, td: AnyNode): [string, string, string] {
  const el = $(td);
  const home = el.find('span.quote-heim span.quote-text').text().trim();
  const draw = el.find('span.quote-remis span.quote-text').text().trim();
  const road = el.find('span.quote-gast span.quote-text').text().trim();
  return [home, draw, road];
}

export async function getPlayers(page: Page, community: string): Promise<string[]> {
  status(t('status.fetchingPlayers'));
  await page.goto(getLeaderboardUrl(community));
  statusClear();

  const $ = cheerio.load(await page.content());
  const players: string[] = [];
  $('table#ranking tbody tr').each((_, tr) => {
    const name = $(tr).find('div.mg_name').text().trim();
    if (name) players.push(name);
  });
  return players;
}
