/**
 * Normalisation for user-supplied term lists (allergies, dislikes, food
 * preferences, dietary restrictions).
 *
 * These fields are free text in onboarding, and they are forwarded verbatim
 * into meal-generation prompts. Without normalisation a single list can carry
 * duplicates ("Nuts", "nuts", " Nuts "), 2,000-character paragraphs, control
 * characters and unbounded item counts — all of which reach the model, cost
 * tokens, and crowd out the actual instructions.
 *
 * Blocking is NOT this module's job: InputSanitizer (via @SafeLLMArray) rejects
 * malicious content. This tidies well-meant but messy input so a user is never
 * handed a 400 at the end of onboarding over a stray double space.
 */

/** Per-item character cap. "Sulphur dioxide and sulphites" is 29 chars. */
export const MAX_TERM_LENGTH = 50;

/** Per-list item cap. Beyond this the list is noise, not a preference. */
export const MAX_TERMS_PER_LIST = 30;

export interface NormaliseTermListOptions {
  maxItems?: number;
  maxLength?: number;
}

/** Matches ASCII control characters (including newlines and tabs). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Collapse a single term: strip control chars, collapse whitespace, trim, cap. */
export const normaliseTerm = (
  value: unknown,
  maxLength: number = MAX_TERM_LENGTH,
): string => {
  if (typeof value !== "string") return "";
  return value
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim(); // a mid-word cut can leave a trailing space
};

/**
 * Normalise a whole list: clean each term, drop empties, remove
 * case-insensitive duplicates (first spelling wins), cap the count.
 */
export const normaliseTermList = (
  value: unknown,
  options: NormaliseTermListOptions = {},
): unknown => {
  if (!Array.isArray(value)) return value; // let @IsArray report the type error
  const { maxItems = MAX_TERMS_PER_LIST, maxLength = MAX_TERM_LENGTH } = options;

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of value) {
    const term = normaliseTerm(raw, maxLength);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= maxItems) break;
  }

  return out;
};
