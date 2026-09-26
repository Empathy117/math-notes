import 'katex/dist/katex.min.css';
import 'mathlive/fonts.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configureMathLive } from '@math-notes/core';
import { App } from './App';

// Fonts come from `mathlive/fonts.css`, bundled by Vite; stop MathLive from injecting its own @font-face.
configureMathLive({ fontsDirectory: null });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
