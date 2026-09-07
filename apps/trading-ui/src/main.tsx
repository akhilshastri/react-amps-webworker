// apps/trading-ui -- Vite app entry point.
//
// M2: bare-page vertical slice (plan §7). Full app shell (flexlayout tabs,
// shadcn, connection banner) lands in M3B/M4.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
