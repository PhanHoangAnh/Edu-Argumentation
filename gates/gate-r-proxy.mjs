// gate-r-proxy.mjs — 23-09-26: the app behind nginx at https://160.30.252.66/.
// Tier 2, against the LOCAL harness (R_BASE, bound to 127.0.0.1) and the ISOLATED gate database.
//
// The trust rule under test (app/backend/main.py client_ip / _via_https): X-Real-IP,
// X-Forwarded-For and X-Forwarded-Proto are believed ONLY from a loopback peer (127.0.0.1 / ::1 —
// nginx on the same host). Any other peer's headers are ignored.
//
// How a NON-proxy peer is made without opening the harness to the LAN: the harness listens on
// 127.0.0.1, and Linux lets a client connect to it FROM 127.0.0.2 (all of 127/8 is loopback). The
// server then sees peer 127.0.0.2, which is not in the trusted set. No other interface is used.
//
// ⛔ RUN WITHOUT lib/auth-preload.mjs (R_NO_PRELOAD=1): this suite signs in through the API.
// ⛔ Output contract: one line per check, 'PASS  ' / 'FAIL  ' (TWO spaces), exit 1 on any FAIL.
// ⛔ The forwarded IPs are random TEST-NET-3 addresses per run, so the in-process login throttle
//    (5 failures / 5 min / client) never carries between runs or collides with gate-r-auth's
//    127.0.0.1 lock-out.
import http from 'node:http';

const BASE = new URL(process.env.R_BASE || 'http://127.0.0.1:8795');
const READER = process.env.R_GATE_READER || 'gate-reader';
const READER_PW = process.env.R_GATE_READER_PW || '';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -- ${detail}`}`);
};

const rnd = () => `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
function distinctIps(n) {
  const out = new Set();
  while (out.size < n) out.add(rnd());
  return [...out];
}

/** One HTTP request from a chosen LOCAL source address. Returns {status, headers, body}. */
function send({ path, method = 'GET', body, headers = {}, from = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: BASE.hostname, port: BASE.port, path, method, localAddress: from,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const badLogin = (headers, from) => send({ path: '/api/auth/login', method: 'POST', from, headers,
  body: { username: 'no-such-proxy-user', password: 'wrong-password-for-gate' } });

// ------------------------------------------------------------------ PX-1 spoof from a non-proxy peer
{
  // Six attempts from peer 127.0.0.2, each claiming a DIFFERENT client IP. If the claim were
  // believed, each would be its own throttle key and none would be blocked. Ignored => all six share
  // key 127.0.0.2 and the sixth is refused with 429.
  const ips = distinctIps(6);
  const codes = [];
  for (const ip of ips) {
    const r = await badLogin({ 'X-Real-IP': ip, 'X-Forwarded-For': ip }, '127.0.0.2');
    codes.push(r.status);
  }
  check('PX-1 X-Real-IP / X-Forwarded-For from a NON-proxy peer are ignored (6 spoofed IPs share one throttle key)',
    codes.slice(0, 5).every((c) => c === 401) && codes[5] === 429, JSON.stringify(codes));
}

// ------------------------------------------------------------------ PX-2 honoured from the proxy
{
  const [a, b] = distinctIps(2);
  const codesA = [];
  for (let i = 0; i < 6; i += 1) codesA.push((await badLogin({ 'X-Real-IP': a, 'X-Forwarded-For': a })).status);
  const firstB = (await badLogin({ 'X-Real-IP': b, 'X-Forwarded-For': b })).status;
  check('PX-2 from the loopback proxy the forwarded IP is honoured: IP A locked after 5, IP B still gets its own attempts',
    codesA.slice(0, 5).every((c) => c === 401) && codesA[5] === 429 && firstB === 401,
    `A=${JSON.stringify(codesA)} B=${firstB}`);
}

// ------------------------------------------------------------------ PX-3..5 Secure cookie
async function readerLogin(headers, from) {
  const r = await send({ path: '/api/auth/login', method: 'POST', from, headers,
    body: { username: READER, password: READER_PW } });
  const set = [].concat(r.headers['set-cookie'] || []);
  const cookie = set.find((c) => c.startsWith('edu_session=')) || '';
  if (cookie) {       // tidy: end the session again
    await send({ path: '/api/auth/logout', method: 'POST', from, body: {},
      headers: { ...headers, Cookie: cookie.split(';')[0] } });
  }
  return { status: r.status, cookie };
}
const hasSecure = (c) => /;\s*secure(\s*;|\s*$)/i.test(c);
{
  const ip = rnd();
  const r = await readerLogin({ 'X-Real-IP': ip, 'X-Forwarded-For': ip, 'X-Forwarded-Proto': 'https' });
  check('PX-3 from the proxy with X-Forwarded-Proto=https the session cookie is Secure (and still HttpOnly, SameSite=Lax)',
    r.status === 200 && hasSecure(r.cookie) && /httponly/i.test(r.cookie) && /samesite=lax/i.test(r.cookie),
    `${r.status} ${r.cookie.replace(/edu_session=[^;]*/, 'edu_session=<redacted>')}`);
}
{
  const ip = rnd();
  const r = await readerLogin({ 'X-Real-IP': ip, 'X-Forwarded-For': ip });
  check('PX-4 without X-Forwarded-Proto the session cookie is NOT Secure (the plain-HTTP VPN door keeps working)',
    r.status === 200 && r.cookie !== '' && !hasSecure(r.cookie),
    `${r.status} ${r.cookie.replace(/edu_session=[^;]*/, 'edu_session=<redacted>')}`);
}
{
  // 127.0.0.3, not .2: PX-1 has just locked 127.0.0.2 out of sign-in for 5 minutes.
  const r = await readerLogin({ 'X-Forwarded-Proto': 'https' }, '127.0.0.3');
  check('PX-5 X-Forwarded-Proto=https from a NON-proxy peer is ignored (cookie not Secure)',
    r.status === 200 && r.cookie !== '' && !hasSecure(r.cookie),
    `${r.status} ${r.cookie.replace(/edu_session=[^;]*/, 'edu_session=<redacted>')}`);
}

// ------------------------------------------------------------------ PX-6 redirects stay relative
{
  const r = await send({ path: '/', headers: { Host: '160.30.252.66', 'X-Forwarded-Proto': 'https', 'X-Real-IP': rnd() } });
  const loc = r.headers.location || '';
  check('PX-6 behind the proxy the sign-in redirect is RELATIVE (/login?next=%2F), never an absolute http:// URL',
    r.status === 302 && loc === '/login?next=%2F', `${r.status} ${loc}`);
}

process.exit(failed ? 1 : 0);
