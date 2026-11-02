// tokens copied from app/frontend/tailwind.config.js + src/styles/app.css (24-09-26)
//
// Lab must look like the study app (plan D7). The theme block below is a VERBATIM copy of
// app/frontend/tailwind.config.js `theme.extend` — gate T1-tokens diffs the two as JSON, so
// do not edit one without the other. Same CJS `module.exports` form as the app. No safelist:
// every class this app uses is written out in full in src/ (a build purges by scanning source).
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'sans-serif'] },
      colors: {
        brand: {
          50: '#fef2f2',
          100: '#fee2e2',
          400: '#f87171',
          500: '#ef4444',
          600: '#ef5b5b',
          900: '#222222',
          950: '#111111',
        },
      },
    },
  },
  plugins: [],
};
