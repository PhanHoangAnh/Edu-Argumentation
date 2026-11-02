import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// ⛔ A3c — THE ONE PATH THAT REACHES OUT OF THIS ROOT, AND WHY.
// reader/RichTextViewer.tsx side-effect-imports
//   ../../../../aws-quiz-app/js/rich-text-viewer.js
// so the REAL custom element is defined (gate A-G6 reads its SHADOW ROOT; a plain React
// component that renders the same markup passes a class-name check and fails A-G6).
// That file lives in the FROZEN aws-quiz-app/** tree and is sha256-PINNED at
//   1810c14a7ae16877df7fa93dd0b5770750e6f82d165b761e1f48e36d07331c70
// It is IMPORTED, never edited. `vite build` (rollup) resolves outside the root on its
// own; the DEV server refuses to serve it without this allow-list entry, and the failure
// is a 403 on a file that plainly exists — not an obvious symptom.
// The allowed root is Edu-Argumentation/ (this file's ../..), deliberately narrow: not
// the repo, not $HOME.
const EDU_ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Build output goes to dist/ and is shipped to nn:/srv/foxai/edu-study/web/ by
// deploy/deploy-study.sh. NOTHING is ever built on nn (plan B4): that box is at
// swap 4053/4095 and an OOM kill there takes a JVM (Trino/Polaris/Airflow) with it.
//
// base '/' and the default 'assets' asset dir are DELIBERATE and RECORDED (execute
// instruction E17 / concern C12): the SPA's hashed bundles are served from /assets/,
// which shares a prefix with the guarded per-module asset route Phase 3 adds at
// /assets/<moduleId>/<file>. They stay separate because the backend registers the
// guarded routes BEFORE the SPA static mount and Starlette matches in registration
// order — see app/md/explain.md.
/**
 * ⚑ PHASE 04 PARITY — ship the legacy's OWN book files and favicon into dist/.
 *
 * :8767 lists FIVE books; :8792 listed TWO, because the three legacy-shape books live in
 * aws-quiz-app/data/ and were never shipped here. They are copied from that ONE source at build
 * time (never duplicated into this tree), with EXACTLY deploy.sh's rule: `*.json` at the top of
 * data/, minus the `test_` fixtures (served but never listed) and minus the retired
 * geron_hands_on_ml_ch01_ch09.json (deploy.sh:54 excludes it; listing it adds a duplicate Géron).
 * The favicon is index.html:7's.
 */
const LEGACY_EXCLUDED = new Set(['geron_hands_on_ml_ch01_ch09.json']);
function legacyBooks(): Plugin {
  // ⚠ The RESOLVED outDir, never a hard-coded ./dist — a `--outDir` build (the fault-proof
  //   variants) otherwise shipped without the three books and read as a different library.
  let outDir = '';
  return {
    name: 'edu-legacy-books',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const source = join(EDU_ROOT, 'aws-quiz-app');
      const outData = join(outDir, 'data');
      mkdirSync(outData, { recursive: true });
      for (const name of readdirSync(join(source, 'data'))) {
        if (!name.endsWith('.json') || name.startsWith('test_') || LEGACY_EXCLUDED.has(name)) continue;
        copyFileSync(join(source, 'data', name), join(outData, name));
      }
      copyFileSync(join(source, 'favicon.svg'), join(outDir, 'favicon.svg'));
    },
  };
}

export default defineConfig({
  plugins: [react(), legacyBooks()],
  base: '/',
  server: {
    // See EDU_ROOT above. Dev-server read scope only; it does not widen the build.
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), EDU_ROOT] },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
  },
});
