/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_CONTACT_EMAIL?: string;
  readonly VITE_CONTACT_PHONE?: string;
  readonly VITE_CONTACT_PHONE_E164?: string;
  readonly VITE_A11Y_STATEMENT_DATE?: string;
  readonly VITE_ROUTER?: 'memory' | 'path';
}
