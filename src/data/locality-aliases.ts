/** Common short forms people type for large localities (CBS locality codes). Matched exactly, never guessed. */
export const LOCALITY_ALIASES: Record<string, string[]> = {
  '5000': ['ת"א', 'תל אביב', 'תא"י', 'יפו'],
  '3000': ['י-ם', 'ירושלים עיר הבירה'],
  '7900': ['פ"ת', 'פתח תקוה'],
  '9000': ['ב"ש'],
  '8300': ['ראשל"צ', 'ראשון'],
  '1200': ['מודיעין', 'מכבים', 'רעות'],
  '2800': ['ק"ש'],
};
