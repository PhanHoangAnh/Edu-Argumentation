// Boot gate for js/app.js.
//
// Why this exists: on 2026-09-14 a `const` was referenced ~100 lines above its
// declaration. That is a temporal-dead-zone ReferenceError thrown at top level,
// so every statement after it — including the DOMContentLoaded registration that
// loads the module — never ran. setAppState(true) was therefore never called and
// all three landing-page cards stayed `disabled`. `node --check` passes on that
// file, because it is valid syntax. Only executing the top level catches it.
//
// Run: node tools/check_app_boot.mjs
import { readFileSync } from 'node:fs';

const REQUIRED_ON_LOAD = ['loadBundledModule'];
const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const registered = [];

const stub = () => new Proxy({
  classList: { add() {}, remove() {}, toggle() {} },
  style: {}, addEventListener() {}, setAttribute() {}, appendChild() {},
  querySelector: () => stub(), content: { cloneNode: () => stub() },
}, { get: (target, key) => (key in target ? target[key] : (target[key] = undefined)) });

globalThis.document = {
  getElementById: () => stub(),
  addEventListener: (event, fn) => { if (event === 'DOMContentLoaded') registered.push(fn.name || 'anonymous'); },
  createElement: () => stub(),
  querySelectorAll: () => [],
};
globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {} }), addEventListener() {}, scrollTo() {} };
globalThis.history = { replaceState() {} };
globalThis.location = { hash: '' };
globalThis.fetch = () => Promise.resolve({ ok: true, json: () => ({}) });

try {
  new Function(source)();
} catch (error) {
  console.error(`FAIL: app.js threw while its top level ran — ${error.constructor.name}: ${error.message}`);
  console.error('Everything after the throwing line never executed. The landing cards will stay disabled.');
  process.exit(1);
}

const missing = REQUIRED_ON_LOAD.filter(name => !registered.includes(name));
if (missing.length) {
  console.error(`FAIL: not registered on DOMContentLoaded: ${missing.join(', ')}`);
  console.error(`registered: ${registered.join(', ') || '(none)'}`);
  process.exit(1);
}

console.log(`PASS: top level ran clean; DOMContentLoaded handlers: ${registered.join(', ')}`);
