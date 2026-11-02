/**
 * gate-lab-doors.mjs — Lab's TWO doors (24-09-26, user report "i press the lab button, and it
 * open the platform page"). Drives the LIVE services on their REAL origins (no tunnels):
 *
 *   S-vpn-lab     signed in on the VPN study origin http://<host>:8767, the reader's Lab button opens
 *                 a new tab that lands on http://<host>:8798/lab/<book>/<lesson> showing that code.
 *   S-vpn-login   signed out: Lab's VPN door -> http://<host>:8767/login?next=/lab/...; after sign-in
 *                 (the password step is SIMULATED by setting the session cookie, then doing exactly
 *                 what LoginPage does: window.location.assign(next)) the browser ends in Lab.
 *   S-vpn-no-443  every request the VPN flows made to our hosts went to :8767 or :8798 — none to the
 *                 public IP, none to 443. The VPN door works with the public port closed.
 *   S-public-lab  the same button on https://<public-ip>/ still lands on https://<public-ip>/lab/...
 *
 * Env: LAB_TOKEN (owner purpose='gate' session, from the wrapper's environment, never argv),
 *      VPN_HOST (192.168.100.66), PUBLIC_HOST (160.30.252.66), LAB_SHOTS (screenshot folder).
 * Read-only: every non-GET is aborted. Run through gates/run-gates-lab-doors.sh.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.LAB_TOKEN || '';
const VPN = process.env.VPN_HOST || '192.168.100.66';
const PUB = process.env.PUBLIC_HOST || '160.30.252.66';
const SHOTS = process.env.LAB_SHOTS || '/var/tmp/lab-shots';
const LESSON = { book: 'geron-homl3', id: 'ch02-b14', reader: '/geron-homl3/chapter-2/14-x', n: 14 };
if (!/^[A-Za-z0-9_-]{16,256}$/.test(TOKEN)) { console.error('LAB_TOKEN missing or malformed'); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (id, pass, detail = '') => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`); };
const cookie = (domain, secure) => ({ name: 'edu_session', value: TOKEN, domain, path: '/', httpOnly: true, secure, sameSite: 'Lax' });

const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const seen = [];                       // every request URL from the VPN contexts
const readOnly = async (ctx, record) => {
  await ctx.route('**/*', (route) => {
    const req = route.request();
    if (record) seen.push(req.url());
    return req.method() === 'GET' || req.method() === 'HEAD' ? route.continue() : route.abort();
  });
};
const errors = [];

/* ---- S-vpn-lab: signed in on http://VPN:8767, click Lab ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([cookie(VPN, false)]);
  await readOnly(ctx, true);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://${VPN}:8767${LESSON.reader}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#lab-open-btn', { timeout: 20_000 });
  const href = await page.getAttribute('#lab-open-btn', 'href');
  // ⚑ 25-09-26: the Lab button opens Lab IN THIS WINDOW (reader/LabDock.tsx iframe), not a new tab.
  await page.click('#lab-open-btn');
  const tab = await (await page.waitForSelector('#lab-dock-frame', { timeout: 20_000 })).contentFrame();
  await tab.waitForLoadState('networkidle');
  await tab.waitForSelector('#lab-editor', { timeout: 20_000 }).catch(() => {});
  const url = tab.url();
  const title = (await tab.textContent('#lab-lesson-title').catch(() => ''))?.trim() || '';
  const editor = await tab.$eval('#lab-editor', (e) => e.value).catch(() => '');
  const code = await tab.evaluate(async (u) => (await (await fetch(u, { credentials: 'same-origin' })).json()).code, `/lab/api/books/${LESSON.book}/lessons/${LESSON.id}`).catch(() => null);
  await page.screenshot({ path: path.join(SHOTS, 'lab-from-vpn-origin-1440.png') });
  check('S-vpn-lab VPN reader (http :8767) Lab button -> panel in the same window framing http://<host>:8798/lab/<book>/<lesson> showing that lesson\'s code',
    url === `http://${VPN}:8798/lab/${LESSON.book}/${LESSON.id}` && title.startsWith(`${LESSON.n}. `) && Boolean(code) && editor === code,
    JSON.stringify({ href, url, title: title.slice(0, 50), codeMatches: Boolean(code) && editor === code }));
  await ctx.close();
}

/* ---- S-vpn-login: signed out -> login on :8767 with next -> (sign-in) -> Lab on :8798 ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await readOnly(ctx, true);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://${VPN}:8798/lab/${LESSON.book}/${LESSON.id}`, { waitUntil: 'networkidle' });
  const loginUrl = page.url();
  const onLogin = loginUrl === `http://${VPN}:8767/login?next=${encodeURIComponent(`/lab/${LESSON.book}/${LESSON.id}`)}`;
  // Sign-in itself needs a real password; the server's answer to it is the session cookie. Set that
  // cookie and do what LoginPage.tsx does on success: a full navigation to `next`.
  await ctx.addCookies([cookie(VPN, false)]);
  await page.evaluate(() => window.location.assign(new URLSearchParams(window.location.search).get('next') || '/'));
  await page.waitForURL(`http://${VPN}:8798/**`, { timeout: 20_000 }).catch(() => {});
  await page.waitForSelector('#lab-editor', { timeout: 20_000 }).catch(() => {});
  const endUrl = page.url();
  const hasEditor = (await page.locator('#lab-editor').count()) > 0;
  check('S-vpn-login signed out on the VPN door -> :8767/login?next=/lab/... -> after sign-in the browser ends in Lab on :8798 (password step simulated by the session cookie)',
    onLogin && endUrl === `http://${VPN}:8798/lab/${LESSON.book}/${LESSON.id}` && hasEditor, JSON.stringify({ loginUrl, endUrl, hasEditor }));
  await ctx.close();
}

/* ---- S-vpn-no-443: nothing in the VPN flows touched the public door ---- */
{
  const ours = seen.map((u) => new URL(u)).filter((u) => u.hostname === VPN || u.hostname === PUB);
  const bad = ours.filter((u) => u.hostname !== VPN || !['8767', '8798'].includes(u.port) || u.protocol !== 'http:');
  const external = [...new Set(seen.map((u) => new URL(u)).filter((u) => u.hostname !== VPN && u.hostname !== PUB).map((u) => u.hostname))];
  const ports = [...new Set(ours.map((u) => u.port))];
  check('S-vpn-no-443 every request the VPN flows made to our hosts went to http :8767 / :8798 — none to the public IP or 443',
    ours.length > 0 && bad.length === 0,
    `${ours.length} requests to ours on ports ${JSON.stringify(ports)}; bad ${bad.length}${bad.length ? ' e.g. ' + bad.slice(0, 3).map(String).join(' ') : ''}; third-party hosts (not our 443): ${JSON.stringify(external)}`);
}

/* ---- S-public-lab: https://PUB/ reader -> Lab button -> https://PUB/lab/... ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  await ctx.addCookies([cookie(PUB, true)]);
  await readOnly(ctx, false);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`https://${PUB}${LESSON.reader}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#lab-open-btn', { timeout: 20_000 });
  // ⚑ 25-09-26: the Lab button opens Lab IN THIS WINDOW (reader/LabDock.tsx iframe), not a new tab.
  await page.click('#lab-open-btn');
  const tab = await (await page.waitForSelector('#lab-dock-frame', { timeout: 20_000 })).contentFrame();
  await tab.waitForLoadState('networkidle');
  await tab.waitForSelector('#lab-editor', { timeout: 20_000 }).catch(() => {});
  const url = tab.url();
  const title = (await tab.textContent('#lab-lesson-title').catch(() => ''))?.trim() || '';
  await page.screenshot({ path: path.join(SHOTS, 'lab-from-public-1440.png') });
  check('S-public-lab public reader (https) Lab button -> panel framing https://<public-ip>/lab/<book>/<lesson> showing Lab',
    url === `https://${PUB}/lab/${LESSON.book}/${LESSON.id}` && title.startsWith(`${LESSON.n}. `), JSON.stringify({ url, title: title.slice(0, 50) }));
  await ctx.close();
}

check('S-doors-noerrors no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
if (results.some((r) => !r.pass)) process.exit(1);
