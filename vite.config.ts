import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import he from './src/i18n/he';

const contact = JSON.parse(readFileSync('config/contact.json', 'utf8')) as { email: string; phone: string; phoneE164: string };
const base = process.env.BASE_PATH ?? '/';

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default defineConfig({
  base,
  publicDir: process.env.PUBLIC_DIR ?? 'public',
  plugins: [
    react(),
    {
      name: 'html-placeholders',
      transformIndexHtml(html) {
        return html
          .replace('%CSP%', CSP)
          .replace('%TITLE%', he.docTitle)
          .replace('%DESCRIPTION%', he.intro)
          .replace('%H1%', he.h1)
          .replace('%INTRO%', he.intro)
          .replace('%NOSCRIPT%', he.noscript)
          .replace('%OFFICIAL_LIST%', he.officialListLink)
          .replace('%OFFICIAL_INFO%', he.officialInfoLink);
      },
    },
  ],
  define: {
    'import.meta.env.VITE_CONTACT_EMAIL': JSON.stringify(contact.email),
    'import.meta.env.VITE_CONTACT_PHONE': JSON.stringify(contact.phone),
    'import.meta.env.VITE_CONTACT_PHONE_E164': JSON.stringify(contact.phoneE164),
    'import.meta.env.VITE_A11Y_STATEMENT_DATE': JSON.stringify(process.env.A11Y_STATEMENT_DATE ?? '2026-10-20'),
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
