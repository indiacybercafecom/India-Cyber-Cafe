import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import App from './App.tsx';
import './index.css';
import { initializeConsoleHandler } from './utils/consoleHandler';

// Initialize console error handling
initializeConsoleHandler();

const rootElement = document.getElementById('root');

if (rootElement) {
  const appElement = (
    <StrictMode>
      <HelmetProvider>
        <App />
      </HelmetProvider>
    </StrictMode>
  );

  // If the server delivered server-rendered HTML inside #root, hydrate it smoothly
  if (rootElement.hasChildNodes() && rootElement.firstElementChild) {
    try {
      hydrateRoot(rootElement, appElement);
    } catch (hydrateErr) {
      console.warn('[Hydration] Falling back to client-side createRoot render:', hydrateErr);
      createRoot(rootElement).render(appElement);
    }
  } else {
    createRoot(rootElement).render(appElement);
  }
}
