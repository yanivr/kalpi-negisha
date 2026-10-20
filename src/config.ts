/** Official destinations used by the "official route" (spec §7.4). Only official gov.il pages. */
export const OFFICIAL_LIST_URL = 'https://www.gov.il/he/pages/26elections-info?chapterIndex=2';
export const OFFICIAL_INFO_URL = 'https://www.gov.il/he/pages/26elections-info?chapterIndex=7';

/** Maintainer contact supplied by the product owner (config/contact.json), injected at build time. */
export const CONTACT = {
  email: import.meta.env.VITE_CONTACT_EMAIL as string | undefined,
  phone: import.meta.env.VITE_CONTACT_PHONE as string | undefined,
  phoneE164: import.meta.env.VITE_CONTACT_PHONE_E164 as string | undefined,
};

/** Date of the last accessibility review recorded in docs/accessibility-audit.md, injected at build time. */
export const A11Y_STATEMENT_DATE = import.meta.env.VITE_A11Y_STATEMENT_DATE as string | undefined;
