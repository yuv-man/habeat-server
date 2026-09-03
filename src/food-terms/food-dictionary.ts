/**
 * Local dictionary of terms that are unambiguously food-related.
 *
 * This is the cheap first pass of term validation: if a user's custom allergy /
 * dislike / preference is in here, it is accepted instantly — no API call, no
 * latency, no cost, and no chance of a model hallucinating a real allergen out
 * of existence. Only terms that miss this list go to the LLM classifier.
 *
 * It does NOT need to be exhaustive. A miss is not a rejection — it is just a
 * question passed to the next stage. Bias the contents towards:
 *   - the preset chips the UI already offers (habeat-client kyc/types.tsx)
 *   - declarable allergens (EU 14 / US big 9) and their spelling variants
 *   - foods obscure enough that a classifier might get them wrong
 */

/** Lowercase, strip punctuation, collapse spaces, drop a trailing plural "s". */
export const canonicaliseTerm = (term: string): string => {
  const base = term
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  // "peanuts" -> "peanut", but never turn "hummus"/"couscous" into "hummu".
  return base.length > 3 && base.endsWith("s") && !base.endsWith("ss")
    ? base.slice(0, -1)
    : base;
};

/**
 * Declarable allergens and their variants. Kept separate because these are the
 * terms where a false rejection is a safety problem, not a cosmetic one.
 */
const ALLERGENS = [
  // EU 14
  "gluten", "wheat", "rye", "barley", "oats", "spelt", "kamut",
  "crustacean", "crustaceans", "prawn", "shrimp", "crab", "lobster",
  "egg", "eggs", "fish", "peanut", "peanuts", "groundnut",
  "soy", "soya", "soybean", "milk", "dairy", "lactose", "casein", "whey",
  "nuts", "tree nuts", "almond", "hazelnut", "walnut", "cashew", "pecan",
  "pistachio", "macadamia", "brazil nut", "chestnut",
  "celery", "celeriac", "mustard", "sesame", "tahini",
  "sulphites", "sulfites", "sulphur dioxide", "sulfur dioxide",
  "lupin", "lupine", "molluscs", "mollusks", "mussel", "oyster", "squid",
  "clam", "scallop", "snail",
  // Other common triggers
  "shellfish", "seafood", "corn", "maize", "gelatin", "gelatine",
  "carmine", "cochineal", "msg", "monosodium glutamate", "histamine",
  "nightshade", "nightshades", "fodmap", "fructose", "sorbitol",
  "yeast", "citrus", "kiwi", "banana", "avocado", "latex",
  "buckwheat", "quinoa", "sunflower seed", "poppy seed", "mahleb",
  "coriander", "cilantro", "paprika", "cinnamon", "vanilla",
];

/** Everyday foods, ingredients, dishes and cuisines. */
const FOODS = [
  // Proteins
  "chicken", "beef", "pork", "lamb", "veal", "turkey", "duck", "goose",
  "salmon", "tuna", "cod", "haddock", "sardine", "anchovy", "mackerel",
  "trout", "herring", "tilapia", "bass", "halibut", "octopus",
  "tofu", "tempeh", "seitan", "edamame", "chickpea", "lentil", "bean",
  "black bean", "kidney bean", "white bean", "fava bean", "pea", "hummus",
  // Dairy and eggs
  "cheese", "cheddar", "mozzarella", "feta", "parmesan", "goat cheese",
  "cottage cheese", "cream cheese", "yogurt", "yoghurt", "greek yogurt",
  "butter", "ghee", "cream", "ice cream", "kefir", "labneh",
  // Grains and starches
  "rice", "brown rice", "white rice", "pasta", "noodle", "spaghetti",
  "bread", "sourdough", "pita", "tortilla", "couscous", "bulgur", "farro",
  "barley", "millet", "polenta", "potato", "sweet potato", "yam", "cassava",
  "oat", "oatmeal", "porridge", "granola", "cereal", "cracker",
  // Vegetables
  "tomato", "onion", "garlic", "shallot", "leek", "carrot", "broccoli",
  "cauliflower", "cabbage", "kale", "spinach", "lettuce", "arugula", "rocket",
  "cucumber", "zucchini", "courgette", "eggplant", "aubergine", "pepper",
  "bell pepper", "chilli", "chili", "mushroom", "beetroot", "beet", "radish",
  "turnip", "parsnip", "pumpkin", "squash", "asparagus", "artichoke",
  "brussels sprout", "green bean", "okra", "corn on the cob", "olive",
  // Fruit
  "apple", "pear", "orange", "lemon", "lime", "grapefruit", "mandarin",
  "clementine", "grape", "strawberry", "raspberry", "blueberry", "blackberry",
  "cherry", "peach", "nectarine", "apricot", "plum", "mango", "pineapple",
  "papaya", "melon", "watermelon", "pomegranate", "fig", "date", "raisin",
  "cranberry", "coconut", "passion fruit", "lychee", "persimmon", "guava",
  // Fats, sauces, condiments
  "olive oil", "coconut oil", "sunflower oil", "vinegar", "balsamic",
  "mayonnaise", "ketchup", "mustard sauce", "soy sauce", "fish sauce",
  "pesto", "salsa", "guacamole", "tzatziki", "harissa", "sriracha",
  "honey", "maple syrup", "sugar", "molasses", "jam", "peanut butter",
  // Drinks
  "coffee", "tea", "green tea", "juice", "smoothie", "milkshake", "soda",
  "alcohol", "beer", "wine", "spirits", "kombucha",
  // Dishes
  "pizza", "burger", "sandwich", "wrap", "salad", "soup", "stew", "curry",
  "stir fry", "stir-fry", "sushi", "sashimi", "ramen", "pho", "taco",
  "burrito", "quesadilla", "enchilada", "lasagna", "lasagne", "risotto",
  "paella", "shakshuka", "falafel", "shawarma", "kebab", "schnitzel",
  "casserole", "chili con carne", "omelette", "omelet", "pancake", "waffle",
  "crepe", "quiche", "pie", "cake", "cookie", "biscuit", "brownie",
  "chocolate", "candy", "sweets", "dessert", "pastry", "croissant", "bagel",
  "muffin", "donut", "doughnut", "pretzel", "popcorn", "chips", "crisps",
  "fries", "nuggets", "meatball", "sausage", "bacon", "ham", "salami",
  "pepperoni", "prosciutto", "pastrami", "jerky", "steak", "roast", "brisket",
  // Cuisines and styles (valid "preferences")
  "italian", "mexican", "chinese", "japanese", "thai", "indian", "korean",
  "vietnamese", "greek", "turkish", "lebanese", "moroccan", "spanish",
  "french", "american", "mediterranean", "middle eastern", "asian",
  "ethiopian", "peruvian", "brazilian", "german", "british",
  // Diet descriptors
  "vegan", "vegetarian", "pescatarian", "flexitarian", "kosher", "halal",
  "keto", "ketogenic", "paleo", "low carb", "low-carb", "high protein",
  "high-protein", "gluten free", "gluten-free", "dairy free", "dairy-free",
  "sugar free", "sugar-free", "low fat", "low-fat", "low sodium",
  "whole food", "organic", "raw", "spicy", "spicy food", "mild", "savoury",
  "savory", "sweet", "salty", "fried", "grilled", "baked", "steamed",
  "processed food", "fast food", "junk food", "red meat", "white meat",
  "meat", "poultry", "vegetable", "vegetables", "fruit", "fruits", "grain",
  "grains", "legume", "legumes", "seed", "seeds", "herb", "herbs", "spice",
  "spices", "protein", "carbs", "carbohydrates", "fat", "fats", "fibre",
  "fiber", "salt", "caffeine",
];

/** Canonicalised lookup set, built once at module load. */
const KNOWN_TERMS: ReadonlySet<string> = new Set(
  [...ALLERGENS, ...FOODS].map(canonicaliseTerm),
);

/**
 * True when the term is recognisably food-related without asking a model.
 *
 * Also matches multi-word terms whose every word is a known food token
 * ("grilled chicken", "sweet potato fries"), which covers most of what users
 * actually type without needing the phrase itself in the list.
 */
export const isKnownFoodTerm = (term: string): boolean => {
  const canonical = canonicaliseTerm(term);
  if (!canonical) return false;
  if (KNOWN_TERMS.has(canonical)) return true;

  const words = canonical.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  // Every significant word must itself be a known food term.
  const significant = words.filter((w) => !FILLER_WORDS.has(w));
  return (
    significant.length > 0 &&
    significant.every((w) => KNOWN_TERMS.has(canonicaliseTerm(w)))
  );
};

/** Words that carry no meaning on their own when matching multi-word terms. */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  "and", "or", "with", "without", "of", "the", "a", "an", "in", "on",
  "free", "no", "not", "all", "any", "raw", "fresh", "dried", "cooked",
]);

/** Exposed for tests and diagnostics. */
export const knownTermCount = (): number => KNOWN_TERMS.size;
