// T13 — Agent-Probe, NOT an assertion. Records the PRE-EXISTING #chapter=1&block=8
// deep-link defect so the Phase 3 rewrite is not blamed for it. This cannot fail.
import { chromium } from 'playwright';
const BASE = process.env.GATE_BASE || 'http://127.0.0.1:8791';
const b = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
await p.goto(`${BASE}/#chapter=1&block=8`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const snap = async label => console.log(label, JSON.stringify(await p.evaluate(() => {
  const vis = id => { const e = document.getElementById(id); if (!e) return `${id}=ABSENT`;
    const r = e.getBoundingClientRect(); return `${id}=${Math.round(r.width)}x${Math.round(r.height)}`; };
  const shown = [...document.querySelectorAll('[id$="-screen"], #home-screen')]
    .filter(e => !e.classList.contains('hidden-view')).map(e => e.id);
  return { visibleScreens: shown, hash: location.hash,
           controls: ['quiz-screen','result-screen','tutorial-content','next-btn','restart-btn','result-retry-wrong-btn','score-tracker'].map(vis) };
}), null, 1));
await snap('BEFORE any click:');
const learn = p.locator('#read-tutorial-btn');
if (await learn.count() && await learn.isVisible()) { await learn.click(); await p.waitForTimeout(1400); await snap('AFTER clicking LEARN:'); }
else console.log('AFTER clicking LEARN: #read-tutorial-btn not visible');
await b.close();
