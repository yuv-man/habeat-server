/**
 * Canonical identity for a shopping-list ingredient.
 *
 * Every cart line is grouped by this key, so two spellings of the same product
 * must produce the same string or the user gets "tomato 2" and "tomatoes 300 g"
 * as separate rows. Two things used to break that:
 *
 *   1. Plurals were left alone, so "tomato" and "tomatoes" were two products.
 *   2. The key stripped every character outside [a-z0-9_], which erased
 *      non-Latin names entirely — a Hebrew plan produced one empty key per
 *      ingredient, collapsing the whole list into a single row.
 *
 * The singularisation below aims at a stable *stem*, not at real English. It
 * only has to map every spelling of one word to one stem; "olive" and "olives"
 * both becoming "oliv" is a correct outcome here.
 */

/** Plurals that no suffix rule gets right, mapped to the stem of the singular. */
const IRREGULAR: Record<string, string> = {
  leaves: "leaf",
  loaves: "loaf",
  halves: "half",
  calves: "calf",
  knives: "knife",
  children: "child",
  men: "man",
  women: "woman",
  geese: "goose",
  feet: "foot",
  teeth: "tooth",
  mice: "mouse",
  people: "person",
};

/** Plural endings where the whole "es" comes off, not just the "s". */
const ES_ENDINGS = ["sses", "shes", "ches", "xes", "zes", "oes", "ies", "ses"];

const stemWord = (word: string): string => {
  const irregular = IRREGULAR[word];
  let stem = irregular ?? word;

  if (!irregular && stem.length > 3) {
    if (ES_ENDINGS.some((ending) => stem.endsWith(ending))) {
      // "tomatoes" -> "tomato", "berries" -> "berri", "glasses" -> "glass"
      stem = stem.slice(0, -2);
    } else if (
      stem.endsWith("s") &&
      !stem.endsWith("ss") &&
      // "hummus", "couscous", "asparagus" are singular already.
      !stem.endsWith("us")
    ) {
      stem = stem.slice(0, -1);
    }
  }

  // "knife"/"knives" and "cookie"/"cookies" only line up once the singular
  // loses its trailing "e" too; "berry"/"berries" only once "y" becomes "i".
  if (stem.length > 3 && stem.endsWith("e")) stem = stem.slice(0, -1);
  if (stem.length > 3 && stem.endsWith("y")) stem = `${stem.slice(0, -1)}i`;

  return stem;
};

/**
 * Group key for an ingredient name. Case, punctuation, spacing and English
 * plurals are all folded away; letters in any script are kept.
 */
export const ingredientKey = (ingredientName: string): string => {
  const words = (ingredientName || "")
    .toLowerCase()
    // Keep letters and digits from every alphabet, drop punctuation.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(stemWord);

  return words.join("_");
};

/**
 * The key shape written before {@link ingredientKey} existed. Lists already in
 * the database still hold these, so every lookup by name has to accept one:
 * without it, ticking off an item on a pre-existing list stops finding it.
 */
export const legacyIngredientKey = (ingredientName: string): string =>
  (ingredientName || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

/** Both keys a stored ingredient may legitimately carry for this name. */
export const ingredientKeyCandidates = (ingredientName: string): string[] => {
  const current = ingredientKey(ingredientName);
  const legacy = legacyIngredientKey(ingredientName);
  return legacy && legacy !== current ? [current, legacy] : [current];
};
