/**
 * A picture for a dish, or failing that an icon.
 *
 * The my-meals screen is a list of the food someone actually eats; as plain
 * text it reads like a spreadsheet. Pictures exist only for the dishes the
 * onboarding screen offers (a fixed set we can ship images for). Everything
 * else — "mum's chicken soup" — falls back to an icon picked from the name, so
 * a typed dish never looks broken next to a stocked one.
 */

/** File name for a known dish, e.g. "Pasta with tomato sauce" → "pasta-with-tomato-sauce". */
export const dishSlug = (name: string): string =>
  (name || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Dishes with a shipped image. Kept in step with `commonDishes` in the client
 * (src/components/kyc/types.tsx): every dish offered at onboarding has one.
 */
export const DISHES_WITH_IMAGES = [
  "Pasta with tomato sauce",
  "Chicken and rice",
  "Scrambled eggs on toast",
  "Omelette with vegetables",
  "Shakshuka",
  "Greek yogurt with granola",
  "Porridge with fruit",
  "Tuna sandwich",
  "Chicken salad",
  "Vegetable soup",
  "Lentil soup",
  "Roast chicken and potatoes",
  "Salmon and vegetables",
  "Beef stir-fry",
  "Spaghetti bolognese",
  "Chicken schnitzel",
  "Rice and beans",
  "Couscous with vegetables",
  "Hummus and pita",
  "Grilled cheese sandwich",
  "Pizza (homemade)",
  "Stuffed vegetables",
  "Curry with rice",
  "Baked pasta",
];

const IMAGE_SLUGS = new Set(DISHES_WITH_IMAGES.map(dishSlug));

/** Where the client serves dish pictures from. */
export const DISH_IMAGE_PATH = "/images/dishes";

/** Longest first, so "vegetable-soup" wins over "soup" for a soup picture. */
const IMAGE_SLUGS_BY_LENGTH = [...IMAGE_SLUGS].sort((a, b) => b.length - a.length);

/**
 * People type their own version of a name: "Vegetable soup with lentils" is
 * the stocked "Vegetable soup" with a note on the end. An exact match wins; a
 * stocked dish contained in what they typed (on word boundaries) is close
 * enough to show its picture.
 */
export const dishImageFor = (name: string): string | undefined => {
  const slug = dishSlug(name);
  if (!slug) return undefined;
  if (IMAGE_SLUGS.has(slug)) return `${DISH_IMAGE_PATH}/${slug}.webp`;

  const padded = `-${slug}-`;
  const near = IMAGE_SLUGS_BY_LENGTH.find(
    (candidate) => candidate.includes("-") && padded.includes(`-${candidate}-`),
  );
  return near ? `${DISH_IMAGE_PATH}/${near}.webp` : undefined;
};

/** Ordered: first match wins, so "chicken soup" is soup rather than chicken. */
const ICONS: [RegExp, string][] = [
  [/soup|broth|minestrone/i, "🍲"],
  [/salad|greens|caprese|tabbouleh/i, "🥗"],
  [/pasta|spaghetti|noodle|lasagne|lasagna|penne|bolognese|carbonara/i, "🍝"],
  [/pizza|focaccia/i, "🍕"],
  [/sandwich|toast|bagel|burger|wrap|pita|baguette/i, "🥪"],
  [/sushi|sashimi|maki/i, "🍣"],
  [/rice|risotto|paella|biryani|couscous/i, "🍚"],
  [/curry|tikka|masala|dahl|dal/i, "🍛"],
  [/egg|shakshuka|omelette|omelet|frittata|scramble/i, "🍳"],
  [/yogurt|yoghurt|granola|porridge|oat|muesli|cereal/i, "🥣"],
  [/fish|salmon|tuna|cod|shrimp|prawn|seafood/i, "🐟"],
  [/chicken|schnitzel|turkey|poultry/i, "🍗"],
  [/beef|steak|lamb|pork|meatball|kebab|stew|roast/i, "🥩"],
  [/taco|burrito|quesadilla|nacho/i, "🌮"],
  [/pancake|waffle|crepe|french toast/i, "🥞"],
  [/hummus|falafel|chickpea|lentil|bean|tofu|veggie|vegetable/i, "🥙"],
  [/fruit|banana|apple|berry|smoothie/i, "🍓"],
  [/cheese|dairy|burrata|mozzarella/i, "🧀"],
  [/potato|chips|fries/i, "🥔"],
];

export const dishIconFor = (name: string): string => {
  for (const [pattern, icon] of ICONS) if (pattern.test(name || "")) return icon;
  return "🍽️";
};

/** Both, for storing on a dish as it is created. */
export const dishArtFor = (name: string): { imageUrl?: string; icon: string } => ({
  ...(dishImageFor(name) ? { imageUrl: dishImageFor(name) } : {}),
  icon: dishIconFor(name),
});
