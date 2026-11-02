import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tailwind.css';
import './styles/app.css';
import { initOverlayScrollbars } from './overlayScrollbars';
import { EMBEDDED } from './components/Header';

if (EMBEDDED) document.body.classList.add('lab-fill');

initOverlayScrollbars();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
