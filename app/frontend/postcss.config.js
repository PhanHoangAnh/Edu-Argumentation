/**
 * Vite runs PostCSS over every CSS entry it sees. This file is what turns the three
 * `@tailwind` directives in src/styles/tailwind.css into real CSS at BUILD time — the
 * replacement for https://cdn.tailwindcss.com, which did it in the browser.
 *
 * ⛔ Without this file the @tailwind directives pass through as literal at-rules, the
 *    build SUCCEEDS, and the app ships with zero utilities. That is exactly the failure
 *    state measured on :8792 before item A: a green build serving an unstyled app that
 *    only looked right because the CDN was still in index.html.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
