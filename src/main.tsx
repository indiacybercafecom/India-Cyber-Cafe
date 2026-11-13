import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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

  // Clear any leftover non-React markup cleanly before mounting SPA root
  if (rootElement.hasChildNodes()) {
    rootElement.innerHTML = '';
  }

  createRoot(rootElement).render(appElement);
}
