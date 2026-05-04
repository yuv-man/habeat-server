import { Model } from "mongoose";
import logger from "./logger";

const CUISINE_KEYWORDS: Record<string, string[]> = {
  Japanese: ["ramen", "sushi", "teriyaki", "miso", "udon", "edamame", "tempura", "tonkatsu", "onigiri", "yakitori"],
  Italian: ["pasta", "risotto", "pizza", "gnocchi", "lasagna", "carbonara", "fettuccine", "ravioli", "pesto"],
  Mexican: ["tacos", "burrito", "quesadilla", "enchilada", "guacamole", "fajita", "salsa", "nachos", "tamale"],
  Mediterranean: ["hummus", "falafel", "shawarma", "tabbouleh", "pita", "tzatziki", "dolma", "kebab", "moussaka"],
  American: ["burger", "sandwich", "wrap", "bbq", "mac and cheese", "hot dog", "pancake", "waffle", "meatloaf"],
  Indian: ["curry", "dal", "tikka", "biryani", "naan", "samosa", "masala", "paneer", "chutney", "tandoori"],
  Chinese: ["stir-fry", "dumpling", "fried rice", "noodles", "dim sum", "wonton", "chow mein", "spring roll"],
  Thai: ["pad thai", "tom yum", "green curry", "satay", "larb", "som tum", "thai fried rice"],
  Greek: ["gyro", "souvlaki", "spanakopita", "baklava", "greek salad", "feta"],
  French: ["quiche", "crepe", "ratatouille", "croissant", "boeuf", "coq au vin"],
  Korean: ["bibimbap", "kimchi", "bulgogi", "tteokbokki", "japchae", "galbi"],
  "Middle Eastern": ["fattoush", "baba ganoush", "kafta", "manakish"],
  Spanish: ["paella", "tapas", "gazpacho", "churros", "empanada", "patatas bravas"],
  Vietnamese: ["pho", "banh mi", "bun bo", "goi cuon", "com tam", "bun cha"],
};

export function inferCuisine(mealName: string): string | null {
  const lower = mealName.toLowerCase();
  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return cuisine;
  }
  return null;
}

export async function updateMealLearningProfile(
  userModel: Model<any>,
  userId: string,
  mealName: string,
  action: "complete" | "swap"
): Promise<void> {
  try {
    const user = await userModel.findById(userId);
    if (!user) return;

    const profile = (user as any).mealLearningProfile || {
      completedMeals: [],
      swappedMeals: [],
      cuisineScores: {},
    };

    // Normalise cuisineScores to a plain object (Mongoose Map → plain obj)
    const scores: Record<string, number> =
      profile.cuisineScores instanceof Map
        ? Object.fromEntries(profile.cuisineScores)
        : { ...profile.cuisineScores };

    const cuisine = inferCuisine(mealName);

    if (action === "complete") {
      const existing = profile.completedMeals.find((m: any) => m.name === mealName);
      if (existing) {
        existing.count += 1;
        existing.lastEaten = new Date();
      } else {
        profile.completedMeals.push({ name: mealName, count: 1, lastEaten: new Date() });
      }

      // Bump cuisine score on second+ completion
      const entry = profile.completedMeals.find((m: any) => m.name === mealName);
      if (cuisine && entry && entry.count >= 2) {
        scores[cuisine] = Math.min(1.0, (scores[cuisine] || 0) + 0.1);
      }

      if (profile.completedMeals.length > 30) {
        profile.completedMeals = profile.completedMeals.slice(-30);
      }
    } else {
      const existing = profile.swappedMeals.find((m: any) => m.name === mealName);
      if (existing) {
        existing.count += 1;
      } else {
        profile.swappedMeals.push({ name: mealName, count: 1 });
      }

      if (cuisine) {
        scores[cuisine] = Math.max(0, (scores[cuisine] || 0) - 0.05);
      }

      if (profile.swappedMeals.length > 30) {
        profile.swappedMeals = profile.swappedMeals.slice(-30);
      }
    }

    profile.cuisineScores = scores;
    (user as any).mealLearningProfile = profile;
    user.markModified("mealLearningProfile");
    await user.save();
  } catch (err: any) {
    logger.warn(`[MealLearning] updateMealLearningProfile failed silently: ${err?.message}`);
  }
}
