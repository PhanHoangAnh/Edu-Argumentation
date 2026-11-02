import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Lab SPA build. Copied from app/frontend/vite.config.ts, with base '/lab/' because
// nginx serves this app under /lab/ and the backend mounts the built assets at
// /lab/assets. NOTHING is built on nn: dist/ is shipped by lab/deploy/deploy-lab.sh.
const EDU_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The study app's favicon, copied from its ONE source at build time (never duplicated). */
function favicon(): Plugin {
  let outDir = '';
  return {
    name: 'edu-lab-favicon',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(join(EDU_ROOT, 'aws-quiz-app', 'favicon.svg'), join(outDir, 'favicon.svg'));
    },
  };
}

export default defineConfig({
  plugins: [react(), favicon()],
  base: '/lab/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
  },
});
