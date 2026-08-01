/**
 * Dietary constraints — the single source of truth for what a user may NOT eat.
 *
 * Why this exists: meal-plan prompts used to hand the model a hardcoded protein
 * rotation ("Chicken", "Beef", "Salmon"…) and meat-heavy example dishes while
 * burying the user's restrictions in a generic "AVOID:" line next to their
 * dislikes. When those two instructions conflict, the model follows the concrete
 * positive one — which is how a vegan user ended up with beef in their week.
 *
 * Everything here is derived from the user's own `dietaryRestrictions` +
 * `allergies` so the prompt can never instruct a forbidden ingredient, and so
 * generated output can be verified before it is ever persisted.
 */

export interface DietaryRule {
  id: string;
  label: string;
  /** Matches the free-text value the client stores in `dietaryRestrictions`. */
  match: RegExp;
  /** Ingredient / dish keywords that constitute a violation. */
  forbidden: string[];
  /** Proteins that remain valid under this rule (intersected across rules). */
  allowedProteins: string[];
  /** Explicit rule text injected into the prompt as a hard constraint. */
  promptRule: string;
}

const MEAT = [
  "meat", "beef", "steak", "veal", "pork", "bacon", "ham", "prosciutto",
  "pancetta", "sausage", "salami", "pepperoni", "chorizo", "lamb", "mutton",
  "venison", "rabbit", "goat", "brisket", "ribs", "meatball", "meatloaf",
  "burger patty", "ground beef", "mince beef", "lard", "tallow", "gelatin",
  "bone broth", "chicken broth", "beef broth", "liver", "pastrami", "jerky",
];

const POULTRY = ["chicken", "turkey", "duck", "goose", "quail", "poultry"];

const SEAFOOD = [
  "fish", "salmon", "tuna", "cod", "haddock", "halibut", "tilapia", "trout",
  "sardine", "anchovy", "anchovies", "mackerel", "herring", "bass", "snapper",
  "swordfish", "catfish", "eel", "seafood", "shrimp", "prawn", "crab",
  "lobster", "clam", "mussel", "oyster", "scallop", "squid", "calamari",
  "octopus", "caviar", "roe", "fish sauce", "worcestershire", "surimi",
];

const DAIRY = [
  "milk", "cheese", "butter", "yogurt", "yoghurt", "cream", "creme fraiche",
  "sour cream", "whey", "casein", "ghee", "custard", "mozzarella", "cheddar",
  "parmesan", "feta", "ricotta", "mascarpone", "halloumi", "brie", "gouda",
  "cottage cheese", "ice cream", "condensed milk", "buttermilk", "kefir",
];

const EGGS = ["egg", "eggs", "egg white", "egg yolk", "mayonnaise", "mayo", "meringue", "aioli"];

const GLUTEN = [
  "wheat", "barley", "rye", "spelt", "farro", "bulgur", "semolina", "couscous",
  "seitan", "bread", "breadcrumb", "panko", "pasta", "spaghetti", "penne",
  "macaroni", "noodle", "tortilla", "pita", "bagel", "croissant", "cracker",
  "flour", "soy sauce", "beer", "malt", "pastry", "pancake", "waffle", "muffin",
  "toast", "sandwich", "wrap", "bun", "baguette", "crouton", "granola",
  "cereal", "pretzel", "orzo", "gnocchi", "ravioli", "lasagna", "dumpling",
  "matzo", "pie crust", "batter", "biscuit",
];

const NUTS = [
  "peanut", "almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut",
  "macadamia", "brazil nut", "pine nut", "nut butter", "nutella", "praline", "marzipan",
];

const PORK = ["pork", "bacon", "ham", "prosciutto", "pancetta", "lard", "gelatin", "chorizo", "salami", "pepperoni"];

const SHELLFISH = [
  "shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster",
  "scallop", "squid", "calamari", "octopus", "crayfish", "shellfish",
];

const PLANT_PROTEINS = [
  "Tofu", "Lentils", "Chickpeas", "Black beans", "Tempeh", "Edamame", "Seitan",
];
const PLANT_PROTEINS_GF = [
  "Tofu", "Lentils", "Chickpeas", "Black beans", "Tempeh", "Edamame", "Quinoa",
];

/**
 * Order matters: the first matching rule wins per keyword set, but ALL matching
 * rules are applied (a user can be both vegan and gluten-free).
 */
export const DIETARY_RULES: DietaryRule[] = [
  {
    id: "vegan",
    label: "Vegan",
    match: /\bvegan\b|plant[\s-]?based/i,
    forbidden: [...MEAT, ...POULTRY, ...SEAFOOD, ...DAIRY, ...EGGS, "honey", "gelatin", "lard"],
    allowedProteins: PLANT_PROTEINS,
    promptRule:
      "VEGAN — absolutely NO animal products of any kind: no meat, poultry, fish, " +
      "seafood, dairy (milk, cheese, butter, yogurt, cream, whey), eggs, honey, " +
      "gelatin, or animal broth/stock. Every protein must be plant-based " +
      "(tofu, tempeh, seitan, lentils, chickpeas, beans, edamame, nuts, seeds).",
  },
  {
    id: "vegetarian",
    label: "Vegetarian",
    match: /\bvegetarian\b|\bveggie\b/i,
    forbidden: [...MEAT, ...POULTRY, ...SEAFOOD, "gelatin", "lard"],
    allowedProteins: ["Eggs", "Greek yogurt", "Cottage cheese", "Tofu", "Lentils", "Chickpeas", "Black beans"],
    promptRule:
      "VEGETARIAN — NO meat, poultry, fish, seafood, gelatin, or meat-based broth. " +
      "Dairy and eggs are allowed.",
  },
  {
    id: "pescatarian",
    label: "Pescatarian",
    match: /pesc[ae]tarian/i,
    forbidden: [...MEAT, ...POULTRY],
    allowedProteins: ["Salmon", "Tuna", "Cod", "Shrimp", "Eggs", "Tofu", "Lentils"],
    promptRule: "PESCATARIAN — NO meat or poultry. Fish and seafood are allowed.",
  },
  {
    id: "halal",
    label: "Halal",
    match: /halal/i,
    forbidden: [...PORK, "alcohol", "wine", "beer", "rum", "vodka", "mirin", "cooking wine"],
    allowedProteins: ["Chicken", "Beef", "Lamb", "Eggs", "Salmon", "Tuna", "Lentils"],
    promptRule: "HALAL — NO pork or pork derivatives (bacon, ham, lard, gelatin) and NO alcohol in any form.",
  },
  {
    id: "kosher",
    label: "Kosher",
    match: /kosher/i,
    forbidden: [...PORK, ...SHELLFISH, "catfish", "eel"],
    allowedProteins: ["Chicken", "Beef", "Turkey", "Salmon", "Tuna", "Eggs", "Lentils"],
    promptRule:
      "KOSHER — NO pork or shellfish. Never combine meat and dairy in the same meal.",
  },
  {
    id: "gluten-free",
    label: "Gluten-free",
    match: /gluten|coeliac|celiac/i,
    forbidden: GLUTEN,
    allowedProteins: [],
    promptRule:
      "GLUTEN-FREE — NO wheat, barley, rye, bread, pasta, couscous, flour, soy sauce, " +
      "or breadcrumbs. Use rice, quinoa, potatoes, corn tortillas and tamari instead.",
  },
  {
    id: "dairy-free",
    label: "Dairy-free",
    match: /dairy[\s-]?free|lactose|no dairy|milk allerg/i,
    forbidden: DAIRY,
    allowedProteins: [],
    promptRule:
      "DAIRY-FREE — NO milk, cheese, butter, yogurt, cream, whey or casein. " +
      "Plant alternatives (oat milk, coconut yogurt) are fine.",
  },
  {
    id: "egg-free",
    label: "Egg-free",
    match: /egg[\s-]?free|egg allerg|no eggs?\b/i,
    forbidden: EGGS,
    allowedProteins: [],
    promptRule: "EGG-FREE — NO eggs or egg-based products (mayonnaise, meringue, aioli).",
  },
  {
    id: "nut-free",
    label: "Nut-free",
    match: /nut[\s-]?free|nut allerg|peanut/i,
    forbidden: NUTS,
    allowedProteins: [],
    promptRule: "NUT-FREE — NO peanuts, tree nuts, or nut butters of any kind.",
  },
  {
    id: "shellfish-free",
    label: "No shellfish",
    match: /shellfish/i,
    forbidden: SHELLFISH,
    allowedProteins: [],
    promptRule: "NO SHELLFISH — no shrimp, crab, lobster, clams, mussels, oysters, scallops or squid.",
  },
  {
    id: "pork-free",
    label: "No pork",
    match: /pork[\s-]?free|no pork/i,
    forbidden: PORK,
    allowedProteins: [],
    promptRule: "NO PORK — no pork, bacon, ham, lard or pork gelatin.",
  },
  {
    id: "red-meat-free",
    label: "No red meat",
    match: /red[\s-]?meat/i,
    forbidden: ["beef", "steak", "pork", "lamb", "veal", "mutton", "venison", "goat", "ground beef", "brisket"],
    allowedProteins: ["Chicken", "Turkey", "Eggs", "Salmon", "Tuna", "Tofu", "Lentils"],
    promptRule: "NO RED MEAT — no beef, pork, lamb, veal or game. Poultry and fish are allowed.",
  },
];

/** Default rotation used when the user has no protein-restricting rules. */
export const DEFAULT_PROTEIN_ROTATION = [
  "Chicken", "Beef", "Eggs", "Turkey", "Salmon", "Tuna", "Ground beef",
];

/**
 * Prefixes that neutralise an otherwise-forbidden keyword.
 * "almond milk" is not dairy; "vegan bacon" is not meat.
 */
const EXEMPT_PREFIXES: Record<string, string[]> = {
  milk: ["almond", "soy", "oat", "coconut", "cashew", "rice", "hemp", "pea", "flax", "plant"],
  butter: ["peanut", "almond", "cashew", "nut", "seed", "sunflower", "apple", "cocoa", "shea"],
  cream: ["coconut", "cashew", "oat", "soy", "non-dairy", "nondairy"],
  yogurt: ["coconut", "soy", "almond", "cashew", "oat", "plant"],
  yoghurt: ["coconut", "soy", "almond", "cashew", "oat", "plant"],
  cheese: ["vegan", "cashew", "nut"],
  bread: ["gluten-free", "gluten free"],
  pasta: ["gluten-free", "gluten free", "chickpea", "lentil"],
  flour: ["almond", "coconut", "chickpea", "rice", "oat", "gluten-free", "gluten free"],
  "soy sauce": ["tamari"],
  noodle: ["rice", "glass", "shirataki", "zucchini"],
  tortilla: ["corn"],
  wrap: ["lettuce", "collard", "rice paper", "cabbage"],
  cereal: ["gluten-free", "gluten free"],
  granola: ["gluten-free", "gluten free"],
};

/**
 * Prefixes that neutralise ANY keyword — imitation / meat-analogue products.
 *
 * The plant bases matter as much as the explicit "vegan"/"mock" markers: models
 * name analogue dishes "Tofu Steaks" or "Chickpea Tuna Salad", and flagging
 * those as violations sent perfectly compliant vegan plans into the repair loop,
 * burning scarce free-tier quota to regenerate food that was already correct.
 */
const UNIVERSAL_EXEMPT_PREFIXES = [
  "vegan", "vegetarian", "plant-based", "plant based", "meatless", "meat-free",
  "imitation", "mock", "faux", "vegan-style",
  "tofu", "tempeh", "seitan", "jackfruit", "chickpea", "lentil", "cauliflower",
  "mushroom", "aubergine", "eggplant", "banana blossom", "soy", "pea protein",
];

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Normalise a keyword to its singular form so a user-entered allergy of
 * "peanuts" still matches the ingredient "peanut". Matching re-adds the plural
 * suffix, so singular keywords catch both forms.
 */
const singularize = (word: string): string => {
  if (/(ss|us|is)$/.test(word)) return word; // hummus, molasses, couscous
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`; // anchovies -> anchovy
  if (/(s|x|z|ch|sh|o)es$/.test(word)) return word.slice(0, -2); // tomatoes -> tomato
  if (/[^s]s$/.test(word)) return word.slice(0, -1); // peanuts -> peanut
  return word;
};

/**
 * True when `text` contains `keyword` as a standalone term that is not
 * neutralised by an exempting prefix (e.g. "almond milk" for `milk`).
 */
const containsForbidden = (rawText: string, keyword: string): boolean => {
  // Analogue dishes are written with scare quotes — Tofu "Chicken" Salad. The
  // quote sits between the plant base and the keyword and would otherwise hide
  // the exempting prefix from the match below, so strip quotes first.
  const text = rawText.replace(/['"`’“”]/g, "");

  const pattern = new RegExp(`(^|[^a-z])((?:[a-z-]+[ _-])?)${escapeRegex(keyword)}(s|es)?($|[^a-z])`, "gi");
  const exemptions = [...UNIVERSAL_EXEMPT_PREFIXES, ...(EXEMPT_PREFIXES[keyword] || [])];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const precedingWord = (match[2] || "").trim().replace(/[_-]/g, " ").toLowerCase();
    // The captured word may itself be part of a longer exemption ("gluten free").
    const windowStart = Math.max(0, match.index - 24);
    const window = text.slice(windowStart, match.index + match[0].length).toLowerCase();

    const exempt = exemptions.some(
      (prefix) => precedingWord === prefix || window.includes(`${prefix} ${keyword}`) || window.includes(`${prefix}-${keyword}`),
    );
    if (!exempt) return true;
  }
  return false;
};

export interface DietaryConstraints {
  /** Rules matched from the user's stored restrictions. */
  rules: DietaryRule[];
  /** Raw restriction strings the user actually configured. */
  rawRestrictions: string[];
  /** Raw allergy strings. */
  allergies: string[];
  /** Every keyword that must not appear in a generated meal. */
  forbiddenKeywords: string[];
  /** Protein rotation that is safe for this user. */
  proteinRotation: string[];
  /** True when the user has any hard dietary constraint at all. */
  hasConstraints: boolean;
}

/**
 * Resolve a user's restrictions + allergies into everything the generator needs.
 * Unrecognised restriction strings are still enforced verbatim as keywords, so a
 * custom entry like "no cilantro" is never silently dropped.
 */
export const resolveDietaryConstraints = (user: {
  dietaryRestrictions?: string[];
  allergies?: string[];
}): DietaryConstraints => {
  const rawRestrictions = (user.dietaryRestrictions || []).filter(Boolean).map(String);
  const allergies = (user.allergies || []).filter(Boolean).map(String);

  const rules = DIETARY_RULES.filter((rule) =>
    rawRestrictions.some((r) => rule.match.test(r)),
  );

  // Restriction strings that matched no known rule are still enforced literally.
  const unmatched = rawRestrictions.filter(
    (r) => !DIETARY_RULES.some((rule) => rule.match.test(r)),
  );

  const forbiddenKeywords = Array.from(
    new Set(
      [
        ...rules.flatMap((r) => r.forbidden),
        ...allergies,
        ...unmatched,
      ]
        .map((k) => k.toLowerCase().trim())
        // Strip leading "no "/"free of " so "no pork" enforces "pork".
        .map((k) => k.replace(/^(no|without|free of|avoid)\s+/, ""))
        // Trailing "-free"/" free" so "dairy free" enforces "dairy".
        .map((k) => k.replace(/[\s-]free$/, ""))
        .map(singularize)
        .filter((k) => k.length > 2),
    ),
  );

  // Intersect the allowed rotations of every protein-restricting rule.
  const restrictingRules = rules.filter((r) => r.allowedProteins.length > 0);
  let proteinRotation =
    restrictingRules.length === 0
      ? [...DEFAULT_PROTEIN_ROTATION]
      : restrictingRules.reduce<string[]>(
          (acc, rule) =>
            acc.length === 0
              ? [...rule.allowedProteins]
              : acc.filter((p) => rule.allowedProteins.includes(p)),
          [],
        );

  // Drop any remaining protein that trips a forbidden keyword (e.g. gluten-free
  // removes seitan; nut-free removes nut-based options).
  proteinRotation = proteinRotation.filter(
    (p) => !forbiddenKeywords.some((kw) => containsForbidden(p.toLowerCase(), kw)),
  );

  if (proteinRotation.length === 0) {
    // Last-resort rotation that survives essentially every combination.
    proteinRotation = ["Lentils", "Chickpeas", "Black beans", "Quinoa", "Tofu"].filter(
      (p) => !forbiddenKeywords.some((kw) => containsForbidden(p.toLowerCase(), kw)),
    );
  }
  if (proteinRotation.length === 0) proteinRotation = ["Lentils", "Chickpeas"];

  return {
    rules,
    rawRestrictions,
    allergies,
    forbiddenKeywords,
    proteinRotation,
    hasConstraints: forbiddenKeywords.length > 0,
  };
};

/**
 * The hard-constraint block for a prompt. Deliberately placed FIRST and phrased
 * as non-negotiable — restrictions must never read as one preference among many.
 */
export const buildDietaryConstraintBlock = (
  c: DietaryConstraints,
  /**
   * Proteins to leave out of the "ONLY use these" line — normally the user's
   * dislikes. Without this the block can permit a protein in the same prompt
   * that tells the model never to include it, and a contradiction is exactly
   * what sends the model down the wrong path.
   */
  excludeProteins: string[] = [],
): string => {
  if (!c.hasConstraints) return "";

  const lines: string[] = [
    "════════ HARD DIETARY CONSTRAINTS — NON-NEGOTIABLE ════════",
    "These override EVERY other instruction in this prompt, including the",
    "suggested protein, cuisine style and example dishes. A plan that breaks any",
    "rule below is INVALID and will be rejected.",
    "",
  ];

  if (c.rawRestrictions.length) {
    lines.push(`USER RESTRICTIONS: ${c.rawRestrictions.join(", ")}`);
  }
  if (c.allergies.length) {
    lines.push(`ALLERGIES (medical — never include, not even trace amounts): ${c.allergies.join(", ")}`);
  }
  if (c.rules.length) {
    lines.push("");
    lines.push("RULES:");
    c.rules.forEach((r) => lines.push(`- ${r.promptRule}`));
  }

  lines.push("");
  lines.push(
    `FORBIDDEN INGREDIENTS (must not appear in any meal name or ingredient list): ${c.forbiddenKeywords.join(", ")}`,
  );
  const excluded = excludeProteins.map((p) => p.trim().toLowerCase()).filter(Boolean);
  const listedProteins = excluded.length
    ? c.proteinRotation.filter((p) => {
        const name = p.toLowerCase();
        return !excluded.some((e) => name === e || name.includes(e) || e.includes(name));
      })
    : c.proteinRotation;

  // Keep the full rotation if dislikes would empty the line — an empty "ONLY
  // use these proteins:" is worse than one listing something they dislike.
  lines.push(
    `ONLY use these proteins: ${(listedProteins.length ? listedProteins : c.proteinRotation).join(", ")}`,
  );
  lines.push("Before returning, re-read every meal and confirm it breaks none of the above.");
  lines.push("═══════════════════════════════════════════════════════════");

  return lines.join("\n");
};

const EXAMPLE_SETS: Record<string, string[]> = {
  vegan: [
    "oatmeal with banana", "tofu scramble with toast", "lentil soup with bread",
    "chickpea curry with rice", "black bean tacos", "pasta with tomato sauce and vegetables",
    "hummus veggie wrap", "stir-fried tofu with rice and broccoli",
    "peanut butter toast", "quinoa salad with roasted vegetables",
  ],
  vegetarian: [
    "scrambled eggs with toast", "Greek yogurt with granola", "vegetable omelette",
    "lentil soup", "chickpea curry with rice", "pasta with tomato sauce",
    "halloumi salad", "bean burrito", "oatmeal with banana",
  ],
  pescatarian: [
    "scrambled eggs with toast", "oatmeal with banana", "tuna sandwich",
    "grilled salmon with rice and vegetables", "shrimp stir-fry",
    "pasta with tomato sauce", "lentil soup",
  ],
  default: [
    "scrambled eggs with toast", "oatmeal with banana",
    "grilled chicken with rice and vegetables", "pasta with tomato sauce",
    "chicken soup", "beef stir-fry with rice", "tuna sandwich", "turkey wrap",
    "lentil soup", "vegetable stir-fry with rice",
  ],
};

/**
 * Restriction-appropriate example dishes for the "keep it simple" instruction.
 * Every candidate is run through the same violation check as generated output,
 * so an example can never contradict the constraint block above it.
 */
export const buildMealExamples = (c: DietaryConstraints): string => {
  const ruleIds = new Set(c.rules.map((r) => r.id));
  const key = ["vegan", "vegetarian", "pescatarian"].find((id) => ruleIds.has(id)) || "default";

  const safe = EXAMPLE_SETS[key].filter(
    (dish) => findMealViolations({ name: dish }, c).length === 0,
  );

  // Fall back to the plant-based set if the user's constraints eliminate the
  // whole list (e.g. a gluten-free, dairy-free, nut-free omnivore).
  const chosen = safe.length >= 4
    ? safe
    : EXAMPLE_SETS.vegan.filter((dish) => findMealViolations({ name: dish }, c).length === 0);

  return (chosen.length > 0 ? chosen : ["simple rice and vegetable bowls"]).join(", ");
};

export interface DietaryViolation {
  date?: string;
  mealType: string;
  mealName: string;
  matched: string[];
}

const collectMealText = (meal: any): string => {
  if (!meal) return "";
  const parts: string[] = [String(meal.name || "")];

  const ingredients = meal.ingredients || [];
  for (const ing of ingredients) {
    if (typeof ing === "string") parts.push(ing.split("|")[0] || ing);
    else if (Array.isArray(ing)) parts.push(String(ing[0] || ""));
    else if (ing && typeof ing === "object") parts.push(String(ing.name || ""));
  }

  return parts.join(" ").toLowerCase().replace(/_/g, " ");
};

/** Scan one meal for forbidden keywords. Returns the keywords that matched. */
export const findMealViolations = (meal: any, c: DietaryConstraints): string[] => {
  if (!c.hasConstraints) return [];
  const text = collectMealText(meal);
  if (!text.trim()) return [];
  return c.forbiddenKeywords.filter((kw) => containsForbidden(text, kw));
};

/**
 * Scan raw generated day objects (`{ date, meals: { breakfast, lunch, ... } }`)
 * for anything that violates the user's constraints.
 */
export const findPlanViolations = (
  days: any[],
  c: DietaryConstraints,
): DietaryViolation[] => {
  if (!c.hasConstraints) return [];

  const violations: DietaryViolation[] = [];

  for (const day of days || []) {
    const meals = day?.meals || {};
    const entries: Array<[string, any]> = [
      ["breakfast", meals.breakfast],
      ["lunch", meals.lunch],
      ["dinner", meals.dinner],
      ...(Array.isArray(meals.snacks)
        ? meals.snacks.map((s: any, i: number): [string, any] => [`snack[${i}]`, s])
        : []),
    ];

    for (const [mealType, meal] of entries) {
      const matched = findMealViolations(meal, c);
      if (matched.length > 0) {
        violations.push({
          date: day?.date,
          mealType,
          mealName: meal?.name || "(unnamed)",
          matched,
        });
      }
    }
  }

  return violations;
};

/** Human-readable summary used in logs and in the repair prompt. */
export const describeViolations = (violations: DietaryViolation[]): string =>
  violations
    .map((v) => `${v.date || "?"} ${v.mealType} "${v.mealName}" contains: ${v.matched.join(", ")}`)
    .join("; ");

export interface FoodPreferenceFilterResult {
  allowed: string[];
  removed: string[];
}

/**
 * Strip food preferences that conflict with the user's hard dietary constraints
 * (e.g. "Sirloin Steak" for a vegan user) before they ever reach a prompt. Without
 * this, the prompt would tell the model to treat a forbidden ingredient as
 * inspiration in the same breath as forbidding it, which is exactly the kind of
 * contradiction the model is most likely to resolve the wrong way.
 */
export const filterFoodPreferences = (
  preferences: string[],
  c: DietaryConstraints,
): FoodPreferenceFilterResult => {
  if (!c.hasConstraints) return { allowed: preferences, removed: [] };

  const allowed: string[] = [];
  const removed: string[] = [];

  for (const pref of preferences) {
    const text = pref.toLowerCase();
    const violates = c.forbiddenKeywords.some((kw) => containsForbidden(text, kw));
    (violates ? removed : allowed).push(pref);
  }

  return { allowed, removed };
};
