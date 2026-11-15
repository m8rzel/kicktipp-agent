import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { login, loginWhereRedirected, Page } from '../src/browser.js';
import { AuthError, loadMatchPredictPage } from '../src/core.js';
import { CookieJar } from '../src/http/cookie-jar.js';
import { mockFetch, page as htmlPage, type Handler, type RecordedRequest } from './helpers/mock-fetch.js';

/**
 * A community that lives on kicktipp.de, reached with the default base
 * kicktipp.com. The chain is the one the real sites answered for such a
 * community: .com redirects to its own community login page, which is a 404,
 * so the page falls back to .de, where nobody is logged in.
 */

const COM = 'https://www.kicktipp.com';
const DE = 'https://www.kicktipp.de';
const EMAIL = 'me@example.com';
const PASSWORD = 'correct horse';

const LOGIN_FORM = htmlPage(`
  <form method="post" action="/info/profil/login">
    <input type="text" name="kennung" value="">
    <input type="password" name="passwort" value="">
    <button type="submit" name="submitbutton" value="Anmelden">Anmelden</button>
  </form>`);

const PREDICT = htmlPage(`<div id="kicktipp-content">
  <form method="post" action="/schuttern/tippabgabe">
    <table id="tippabgabeSpiele"><tbody>
      <tr><td>Sa 20:30</td><td>Alpha</td><td>Beta</td>
        <td><input id="m1_heimTipp" name="h1" value=""><input id="m1_gastTipp" name="g1" value=""></td></tr>
    </tbody></table>
  </form></div>`);

function kicktipp(deAccepts = true): { handler: Handler; logins: string[] } {
  const logins: string[] = [];
  const handler: Handler = (req: RecordedRequest) => {
    const url = new URL(req.url);
    const cookie = req.headers.get('cookie') || '';

    if (url.pathname === '/info/profil/login') {
      if (req.method === 'GET') return LOGIN_FORM;
      const form = new URLSearchParams(req.body || '');
      if (form.get('kennung') !== EMAIL || form.get('passwort') !== PASSWORD) return LOGIN_FORM;
      if (url.origin === DE && !deAccepts) return LOGIN_FORM;
      logins.push(url.origin);
      const sid = url.origin === DE ? 'de-session' : 'com-session';
      return { status: 302, location: '/', setCookies: [`sid=${sid}; Path=/`] };
    }
    if (url.pathname === '/') return htmlPage('Start');

    if (url.origin === COM) {
      if (url.pathname === '/schuttern/tippabgabe') return { status: 301, location: '/schuttern/predict' };
      if (url.pathname === '/schuttern/predict') return { status: 302, location: '/schuttern/profile/login' };
      return undefined; // 404, including /schuttern/profile/login
    }
    if (url.origin === DE && url.pathname === '/schuttern/tippabgabe') {
      if (!cookie.includes('sid=de-session')) return { status: 302, location: `${DE}/schuttern/profil/login` };
      return PREDICT;
    }
    if (url.origin === DE && url.pathname === '/schuttern/profil/login') return LOGIN_FORM;
    return undefined;
  };
  return { handler, logins };
}

beforeEach(() => {
  vi.stubEnv('KICKTIPP_EMAIL', EMAIL);
  vi.stubEnv('KICKTIPP_PASSWORD', PASSWORD);
  vi.stubEnv('KICKTIPP_BASE_URL', '');
  vi.stubEnv('KICKTIPP_SITE', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a community on the other Kicktipp host', () => {
  it('reports the foreign login page, then works after logging in there', async () => {
    const site = kicktipp();
    const { fetchImpl } = mockFetch(site.handler);
    const page = new Page(new CookieJar(), fetchImpl);
    await login(page, EMAIL, PASSWORD);

    const first = await loadMatchPredictPage(page, 'schuttern').catch((err) => err);
    expect(first).toBeInstanceOf(AuthError);
    expect(first.loginPage).toBe(`${DE}/schuttern/profil/login`);

    await expect(loginWhereRedirected(page, first.loginPage, { sessionFile: null })).resolves.toBe(true);
    expect(site.logins).toEqual([COM, DE]);

    const $ = await loadMatchPredictPage(page, 'schuttern');
    expect($('table#tippabgabeSpiele td').eq(1).text()).toBe('Alpha');
  });

  it('leaves a login page on the configured host to the caller', async () => {
    const { fetchImpl, calls } = mockFetch(kicktipp().handler);
    const page = new Page(new CookieJar(), fetchImpl);

    await expect(
      loginWhereRedirected(page, `${COM}/info/profil/login`, { sessionFile: null }),
    ).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it.each([
    'https://evil.example/profil/login',
    'https://evil.kicktipp.de/profil/login',
    'https://www.kicktipp.de.evil.example/profil/login',
  ])('never sends the password to %s', async (loginPage) => {
    const { fetchImpl, calls } = mockFetch(kicktipp().handler);
    const page = new Page(new CookieJar(), fetchImpl);

    await expect(loginWhereRedirected(page, loginPage, { sessionFile: null })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('logs in over https even when the redirect pointed at plain http', async () => {
    const { fetchImpl, calls } = mockFetch(kicktipp().handler);
    const page = new Page(new CookieJar(), fetchImpl);

    await loginWhereRedirected(page, 'http://www.kicktipp.de/schuttern/profil/login', { sessionFile: null });

    expect(calls.map((c) => c.url)).not.toContain('http://www.kicktipp.de/info/profil/login');
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([`${DE}/info/profil/login`]);
  });

  it('says which site turned the login down', async () => {
    const { fetchImpl } = mockFetch(kicktipp(false).handler);
    const page = new Page(new CookieJar(), fetchImpl);

    await expect(
      loginWhereRedirected(page, `${DE}/schuttern/profil/login`, { sessionFile: null }),
    ).rejects.toThrow(/www\.kicktipp\.de rejected the email and password that work on www\.kicktipp\.com/);
  });
});
