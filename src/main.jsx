import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import 'react-phone-number-input/style.css';
import App from './App.jsx';
import { initPostHog } from './lib/posthog';
import { initKeyboardInsets } from './lib/keyboard';

initPostHog();
initKeyboardInsets();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
