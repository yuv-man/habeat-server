/**
 * Does a meal contain something the user said they dislike?
 *
 * One matcher for every place that asks: the library picker, the prompt's
 * protein rotation, the check on a generated plan, quick meals and chat
 * proposals. Each used to do its own `text.includes(dislike)`, and the
 * onboarding chips are plural ("Mushrooms", "Tomatoes", "Bell Peppers") while
 * ingredients are singular ("mushroom") — so the commonest dislikes never
 * matched anything.
 *
 * Matching is on whole words after normalising both sides to singular,
 * lower-case, underscore-free text. Some dislikes name a family rather than an
 * ingredient ("Spicy Food") or have another common name ("Cilantro" is fresh
 * coriander), and some would over-match without an exception ("Olives" must not
 * reject every dish cooked in olive oil).
 *
 * Allergies and dietary restrictions are not handled here: they are hard
 * constraints with their own, stricter matcher (dietary-constraints.ts).
 */

/** "anchovies" → "anchovy", "tomatoes" → "tomato", "peanuts" → "peanut". */
export const singularize = (word: string): string => {
  if (word.length <= 3) return word;
  if (/(ss|us|is)$/.test(word)) return word; // hummus, couscous, molasses
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh|o)es$/.test(word)) return word.slice(0, -2);
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
};

/** Lower-case, singular, single-spaced words. "Bell_Peppers," → "bell pepper". */
export const normalizeIngredientText = (raw: string): string =>
  String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // jalapeño → jalapeno
    .replace(/[_/]/g, " ")
    .replace(/['"`’“”]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize)
    .join(" ");

interface DislikeRule {
  /** Phrases that count as this dislike, already normalised. */
  terms: string[];
  /** Phrases that contain a term but are not the disliked food. */
  except: string[];
}

/**
 * Dislikes that need more than their own name. Keys are normalised. Anything
 * not listed matches on its own name only.
 */
const SPECIAL: Record<string, Partial<DislikeRule>> = {
  "spicy food": {
    terms: [
      "spicy", "chili", "chilli", "chile", "jalapeno", "cayenne", "sriracha",
      "hot sauce", "habanero", "gochujang", "harissa", "chipotle",
      "red pepper flake", "chili flake", "chilli flake", "serrano", "sambal",
    ],
  },
  spicy: { terms: ["spicy", "chili", "chilli", "jalapeno", "cayenne", "sriracha", "hot sauce"] },
  cilantro: { terms: ["cilantro", "fresh coriander", "coriander leaf"] },
  coriander: { terms: ["coriander", "cilantro"] },
  eggplant: { terms: ["eggplant", "aubergine"] },
  aubergine: { terms: ["aubergine", "eggplant"] },
  zucchini: { terms: ["zucchini", "courgette"] },
  "bell pepper": { terms: ["bell pepper", "capsicum", "sweet pepper"] },
  olive: { except: ["olive oil"] },
  avocado: { except: ["avocado oil"] },
  coconut: { except: ["coconut oil"] },
  peanut: { except: ["peanut oil"] },
};

export const dislikeRule = (dislike: string): DislikeRule => {
  const key = normalizeIngredientText(dislike);
  const special = SPECIAL[key] ?? {};
  return {
    terms: (special.terms ?? [key]).map(normalizeIngredientText).filter(Boolean),
    except: (special.except ?? []).map(normalizeIngredientText),
  };
};

/** Name and ingredient names of a meal-shaped object, as one string. */
export const mealIngredientText = (meal: any): string => {
  if (!meal) return "";
  const parts: string[] = [String(meal.name ?? "")];
  for (const ing of meal.ingredients ?? []) {
    if (typeof ing === "string") parts.push(ing.split("|")[0]);
    else if (Array.isArray(ing)) parts.push(String(ing[0] ?? ""));
    else if (ing && typeof ing === "object") parts.push(String(ing.name ?? ""));
  }
  for (const name of meal.labels?.ingredientNames ?? []) parts.push(String(name));
  return parts.join(" | ");
};

/** The dislikes (as the user wrote them) that this text contains. */
export const findDislikesInText = (text: string, dislikes: readonly string[] = []): string[] => {
  if (!dislikes.length || !text) return [];
  // Each ingredient is its own segment, so a phrase can't span two of them
  // ("bell | pepper" is not a bell pepper).
  const segments = text.split("|").map((s) => ` ${normalizeIngredientText(s)} `);
  return dislikes.filter((dislike) => {
    if (!String(dislike ?? "").trim()) return false;
    const { terms, except } = dislikeRule(dislike);
    return segments.some((segment) => {
      let s = segment;
      for (const e of except) s = s.split(` ${e} `).join("  ");
      return terms.some((t) => s.includes(` ${t} `));
    });
  });
};

/** The dislikes this meal contains. */
export const findMealDislikes = (meal: any, dislikes: readonly string[] = []): string[] =>
  findDislikesInText(mealIngredientText(meal), dislikes);

/**
 * The user's own dishes are exempt. Someone who cooks their mother's onion soup
 * has told us they want it, whatever they said about onions at onboarding.
 * (Favourites need no exemption here: they are placed after this check runs.)
 */
export const isUserChosen = (meal: any): boolean => !!meal?.fromRepertoire;

export interface DislikeViolation {
  date?: string;
  mealType: string;
  mealName: string;
  matched: string[];
}

/** Every meal in a plan's days that contains a dislike, user-chosen meals excepted. */
export const findPlanDislikes = (days: any[], dislikes: readonly string[] = []): DislikeViolation[] => {
  if (!dislikes.length) return [];
  const out: DislikeViolation[] = [];
  for (const day of days ?? []) {
    const meals = day?.meals ?? {};
    const entries: Array<[string, any]> = [
      ["breakfast", meals.breakfast],
      ["lunch", meals.lunch],
      ["dinner", meals.dinner],
      ...((Array.isArray(meals.snacks) ? meals.snacks : []) as any[]).map(
        (s: any, i: number): [string, any] => [`snack[${i}]`, s],
      ),
    ];
    for (const [mealType, meal] of entries) {
      if (!meal || isUserChosen(meal)) continue;
      const matched = findMealDislikes(meal, dislikes);
      if (matched.length) out.push({ date: day?.date, mealType, mealName: meal.name ?? "(unnamed)", matched });
    }
  }
  return out;
};

export const describeDislikes = (violations: DislikeViolation[]): string =>
  violations
    .map((v) => `${v.date ?? "?"} ${v.mealType} "${v.mealName}" contains: ${v.matched.join(", ")}`)
    .join("; ");
