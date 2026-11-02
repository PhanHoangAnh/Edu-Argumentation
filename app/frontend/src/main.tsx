import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { DialogHost } from './shell/dialog';
// ⛔ THE TWO STYLESHEETS, AND THEIR ORDER IS LOAD-BEARING. DO NOT SWAP THEM.
//    tailwind.css is the three @tailwind layers (item A, 22-09-26 — it replaced the runtime
//    Tailwind CDN <script> that used to sit in index.html). app.css is the hand-written
//    block ported rule-for-rule from the legacy app, whose body / scrollbar / print /
//    `#tutorial-content.prose` rules must WIN over Tailwind's utilities — exactly as the
//    legacy <style> block wins by sitting after the Tailwind block.
//    ⚠ Under the CDN that ordering was ACCIDENTAL: the CDN injected at runtime, so a static
//      sheet beat it whatever the import order. With a real build both are static CSS in one
//      emitted file and SOURCE ORDER DECIDES. Vite concatenates a single entry's CSS in
//      import order; measured in the built sheet, .px-6 @23860 < .hidden-view @34669 <
//      #tutorial-content.prose @35485 < @media print @36314.
//    ⛔ Slice A4/B added app.css; before that the React app shipped NO CSS at all, so
//      .hidden-view, the B1 reveal, the B2 KaTeX radical fix and the B3 reader-mode height
//      chain were all simply ABSENT while the tree typechecked cleanly.
import './styles/tailwind.css';
import './styles/app.css';
import { initOverlayScrollbars } from './overlayScrollbars';

initOverlayScrollbars();

// NO STATE LIBRARY (plan B2). Verified against the house reference: the CoreX console
// ships zero of zustand/redux/jotai/mobx/recoil/valtio. Server state lives in TanStack
// Query; anything genuinely client-side becomes a React context. Adding a store later is
// a decision, not a default.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {/* 30-09-26: the ONE in-app dialog (shell/dialog.tsx) — the browser's native popups are banned. */}
      <DialogHost />
    </QueryClientProvider>
  </StrictMode>,
);
