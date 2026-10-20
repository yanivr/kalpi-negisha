/** Common short forms people type for large localities (CBS locality codes). Matched exactly, never guessed. */
export const LOCALITY_ALIASES: Record<string, string[]> = {
  '5000': ['ת"א', 'תל אביב', 'תא"י', 'יפו', 'Jaffa', 'Tel Aviv'],
  '3000': ['י-ם', 'ירושלים עיר הבירה'],
  '7900': ['פ"ת', 'פתח תקוה'],
  '9000': ['ב"ש', 'Beersheba', 'Beer Sheva'],
  '8300': ['ראשל"צ', 'ראשון', 'Rishon LeZion'],
  '1200': ['מודיעין', 'מכבים', 'רעות'],
  '2800': ['ק"ש'],
  '6100': ['ב"ב', 'Bnei Brak'],
  '6400': ['Herzliya'],
  '7600': ['Acre'],
};
