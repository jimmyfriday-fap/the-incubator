import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

// The server already redirected the launch token away; drop any stray query string too.
if (window.location.search) window.history.replaceState(null, '', window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
