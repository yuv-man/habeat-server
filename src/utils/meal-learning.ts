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

/** Why the user replaced a planned meal. Only "dont_like" is about the dish;
 *  the rest are about the day, and must never turn into "don't serve this". */
export const SWAP_REASONS = ["no_time", "missing_ingredients", "not_in_mood", "dont_like"] as const;
export type SwapReason = (typeof SWAP_REASONS)[number];

/** Unexplained swaps of the same dish before it is left out of future plans.
 *  One is a busy evening; it used to be enough to drop a dish for good. */
export const UNEXPLAINED_SWAPS_TO_AVOID = 2;

export type MealLearningEvent =
  /** Eaten: ticked off as done. */
  | { type: "complete"; name: string }
  /** Replaced away from the plan. */
  | { type: "swap"; name: string; reason?: SwapReason }
  /** Picked as the replacement — a choice, weaker than eating it. */
  | { type: "select"; name: string }
  /** Undo of a swap: the dish is back, so the swap never happened. */
  | { type: "unswap"; name: string }
  /** Undo of a selection. */
  | { type: "unselect"; name: string };

interface SwappedEntry {
  name: string;
  count: number;
  /** Swaps with "Don't like it". Absent on records written before reasons. */
  dislikes?: number;
  /** Swaps with no reason. Absent on old records, whose `count` is all unexplained. */
  unexplained?: number;
}

/** Dish names to keep out of future plans because of how the user swapped them. */
export const swapAvoidNames = (profile: { swappedMeals?: SwappedEntry[] } | undefined | null): string[] =>
  (profile?.swappedMeals ?? [])
    .filter(
      (m) =>
        (m.dislikes ?? 0) >= 1 || (m.unexplained ?? m.count ?? 0) >= UNEXPLAINED_SWAPS_TO_AVOID,
    )
    .map((m) => m.name);

const bump = (list: any[], name: string, extra: Record<string, unknown> = {}) => {
  const existing = list.find((m: any) => m.name === name);
  if (existing) {
    existing.count += 1;
    Object.assign(existing, extra);
    return existing;
  }
  const entry = { name, count: 1, ...extra };
  list.push(entry);
  return entry;
};

const unbump = (list: any[], name: string): any[] => {
  const existing = list.find((m: any) => m.name === name);
  if (existing) existing.count = Math.max(0, existing.count - 1);
  return list.filter((m: any) => m.count > 0);
};

/** Apply events to a profile in memory. Pure; exported for tests. */
export const applyMealLearningEvents = (rawProfile: any, events: MealLearningEvent[]) => {
  const profile = rawProfile || {};
  profile.completedMeals = Array.isArray(profile.completedMeals) ? profile.completedMeals : [];
  profile.swappedMeals = Array.isArray(profile.swappedMeals) ? profile.swappedMeals : [];
  profile.selectedMeals = Array.isArray(profile.selectedMeals) ? profile.selectedMeals : [];
  profile.recentSwaps = Array.isArray(profile.recentSwaps) ? profile.recentSwaps : [];

  // Normalise cuisineScores to a plain object (Mongoose Map → plain obj)
  const scores: Record<string, number> =
    profile.cuisineScores instanceof Map
      ? Object.fromEntries(profile.cuisineScores)
      : { ...(profile.cuisineScores || {}) };

  for (const event of events) {
    if (!event.name) continue;
    const cuisine = inferCuisine(event.name);

    if (event.type === "complete") {
      const entry = bump(profile.completedMeals, event.name, { lastEaten: new Date() });
      // Bump cuisine score on second+ completion
      if (cuisine && entry.count >= 2) scores[cuisine] = Math.min(1.0, (scores[cuisine] || 0) + 0.1);
      if (profile.completedMeals.length > 30) profile.completedMeals = profile.completedMeals.slice(-30);
    } else if (event.type === "select") {
      bump(profile.selectedMeals, event.name, { lastSelected: new Date() });
      if (profile.selectedMeals.length > 30) profile.selectedMeals = profile.selectedMeals.slice(-30);
    } else if (event.type === "unselect") {
      profile.selectedMeals = unbump(profile.selectedMeals, event.name);
    } else if (event.type === "swap") {
      const existing: SwappedEntry | undefined = profile.swappedMeals.find((m: any) => m.name === event.name);
      // Records from before reasons existed: every swap so far was unexplained.
      if (existing && existing.unexplained === undefined) {
        existing.unexplained = existing.count;
        existing.dislikes = 0;
      }
      const entry = bump(profile.swappedMeals, event.name) as SwappedEntry;
      entry.dislikes = (entry.dislikes ?? 0) + (event.reason === "dont_like" ? 1 : 0);
      entry.unexplained = (entry.unexplained ?? 0) + (event.reason ? 0 : 1);

      // Dated, so "how often did they replace a planned meal this month" is
      // answerable. The running count above can only ever say "ever".
      profile.recentSwaps.push({ name: event.name, at: new Date(), ...(event.reason ? { reason: event.reason } : {}) });
      if (profile.recentSwaps.length > 60) profile.recentSwaps = profile.recentSwaps.slice(-60);

      // Only a swap about the dish says anything about the cuisine.
      if (cuisine && (event.reason === "dont_like" || !event.reason)) {
        scores[cuisine] = Math.max(0, (scores[cuisine] || 0) - 0.05);
      }
      if (profile.swappedMeals.length > 30) profile.swappedMeals = profile.swappedMeals.slice(-30);
    } else if (event.type === "unswap") {
      // Take back the most recent swap of this dish, reason and all.
      let reason: SwapReason | undefined;
      for (let i = profile.recentSwaps.length - 1; i >= 0; i--) {
        if (profile.recentSwaps[i].name === event.name) {
          reason = profile.recentSwaps[i].reason;
          profile.recentSwaps.splice(i, 1);
          break;
        }
      }
      const entry: SwappedEntry | undefined = profile.swappedMeals.find((m: any) => m.name === event.name);
      if (entry) {
        if (reason === "dont_like") entry.dislikes = Math.max(0, (entry.dislikes ?? 0) - 1);
        else if (!reason && entry.unexplained !== undefined) entry.unexplained = Math.max(0, entry.unexplained - 1);
        if (cuisine && (reason === "dont_like" || !reason)) {
          scores[cuisine] = Math.min(1.0, (scores[cuisine] || 0) + 0.05);
        }
      }
      profile.swappedMeals = unbump(profile.swappedMeals, event.name);
    }
  }

  profile.cuisineScores = scores;
  return profile;
};

/**
 * The user correcting something we inferred. "avoided": they do want the dish
 * after all, so its swap record goes (the dated history stays, it is still
 * what happened). "enjoyed": they don't particularly, so what made us think
 * so goes. Pure; exported for tests.
 */
export const forgetLearnedPreference = (rawProfile: any, kind: "enjoyed" | "avoided", name: string) => {
  const profile = applyMealLearningEvents(rawProfile, []);
  const same = (m: any) => String(m?.name ?? "").trim().toLowerCase() === name.trim().toLowerCase();
  if (kind === "avoided") {
    profile.swappedMeals = profile.swappedMeals.filter((m: any) => !same(m));
  } else {
    profile.completedMeals = profile.completedMeals.filter((m: any) => !same(m));
    profile.selectedMeals = profile.selectedMeals.filter((m: any) => !same(m));
  }
  return profile;
};

/** Record what the user did with meals, in one read-modify-write. Never throws. */
export async function recordMealLearning(
  userModel: Model<any>,
  userId: string,
  events: MealLearningEvent[],
): Promise<void> {
  if (!events.length) return;
  try {
    const user = await userModel.findById(userId);
    if (!user) return;
    (user as any).mealLearningProfile = applyMealLearningEvents((user as any).mealLearningProfile, events);
    user.markModified("mealLearningProfile");
    await user.save();
  } catch (err: any) {
    logger.warn(`[MealLearning] recordMealLearning failed silently: ${err?.message}`);
  }
}

/** Single-event form, kept for existing callers. */
export async function updateMealLearningProfile(
  userModel: Model<any>,
  userId: string,
  mealName: string,
  action: "complete" | "swap",
  reason?: SwapReason,
): Promise<void> {
  await recordMealLearning(userModel, userId, [
    action === "swap" ? { type: "swap", name: mealName, reason } : { type: "complete", name: mealName },
  ]);
}
