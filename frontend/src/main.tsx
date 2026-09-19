/* Import order is load-bearing (Plan §6): tokens define the CSS variables,
 * globals consume them, then the fonts that the tokens reference. */
import './styles/tokens.css';
import './styles/globals.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('IAMScope: #root element is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
