import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans/latin-400.css';
import '@fontsource/noto-sans/latin-700.css';
import '@fontsource/noto-sans/cyrillic-400.css';
import '@fontsource/noto-sans/cyrillic-700.css';
import '@fontsource/noto-sans-hebrew/hebrew-400.css';
import '@fontsource/noto-sans-hebrew/hebrew-700.css';
import '@fontsource/noto-sans-arabic/arabic-400.css';
import '@fontsource/noto-sans-arabic/arabic-700.css';
import '@fontsource/noto-sans-ethiopic/ethiopic-400.css';
import '@fontsource/noto-sans-ethiopic/ethiopic-700.css';
import './styles.css';
import { App, parsePath } from './App';

const { locale, view } = parsePath(window.location.pathname);
const root = document.getElementById('root')!;
// The static page carries a no-JS fallback inside #root; React replaces it.
createRoot(root).render(
  <StrictMode>
    <App initialLocale={locale} initialView={view} />
  </StrictMode>,
);
