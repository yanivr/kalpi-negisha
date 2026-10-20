/**
 * Extracts the relevant excerpt of an official page between two literal anchors, after normalising whitespace
 * and stripping markup. A layout/style change outside the excerpt does not count as a change of law (spec §15.5);
 * failure to extract is reported as failure, never as success.
 */
export function normaliseText(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/[״“”]/g, '"')
    .replace(/[׳‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractRuleExcerpt(html: string, start: string, end: string): string | null {
  const text = normaliseText(html);
  const s = normaliseText(start);
  const e = normaliseText(end);
  const i = text.indexOf(s);
  if (i < 0) return null;
  const j = text.indexOf(e, i + s.length);
  if (j < 0) return null;
  return text.slice(i, j + e.length);
}
