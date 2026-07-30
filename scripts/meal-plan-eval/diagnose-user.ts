/**
 * Prints exactly what the meal generator sees for one user, and the prompt it
 * would build. Use this when a plan comes back wrong: it separates "the model
 * ignored us" from "the user's restrictions were never stored in the first
 * place", which look identical from the outside.
 *
 *   npx ts-node --transpile-only scripts/meal-plan-eval/diagnose-user.ts <email|userId> [--prompt]
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import { resolveDietaryConstraints } from "../../src/utils/dietary-constraints";
import {
  buildMenuSkeleton,
  buildWeeklyPlanPrompt,
  planSeed,
} from "../../src/generator/meal-plan-prompt";

const DAYS = [
  { dateStr: "2026-08-03", dayName: "monday", hasWorkout: true },
  { dateStr: "2026-08-04", dayName: "tuesday", hasWorkout: false },
];

(async () => {
  const who = process.argv[2];
  const showPrompt = process.argv.includes("--prompt");
  if (!who) {
    console.error("usage: diagnose-user.ts <email|userId> [--prompt]");
    process.exit(1);
  }

  // Same precedence the app uses (see app.module.ts), plus the local fallback.
  const uri =
    process.env.MONGO_URL_PROD ||
    process.env.MONGO_URL ||
    process.env.MONGODB_URI ||
    process.env.MONGO_URL_LOCAL;
  if (!uri) {
    console.error(
      "No Mongo URI in .env (looked for MONGO_URL_PROD / MONGO_URL / MONGODB_URI / MONGO_URL_LOCAL)",
    );
    process.exit(1);
  }

  await mongoose.connect(uri);
  const users = mongoose.connection.collection("users");

  const query = mongoose.Types.ObjectId.isValid(who)
    ? { _id: new mongoose.Types.ObjectId(who) }
    : { email: who };
  const user: any = await users.findOne(query);

  if (!user) {
    console.error(`No user matched ${who}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log("\n─── STORED ON THE USER ───────────────────────────────────");
  console.log("email             :", user.email);
  console.log("dietaryRestrictions:", JSON.stringify(user.dietaryRestrictions ?? null));
  console.log("allergies         :", JSON.stringify(user.allergies ?? null));
  console.log("foodPreferences   :", JSON.stringify(user.foodPreferences ?? null));
  console.log("dislikes          :", JSON.stringify(user.dislikes ?? null));

  const c = resolveDietaryConstraints(user);

  console.log("\n─── WHAT THE GENERATOR DERIVES ───────────────────────────");
  console.log("matched rules     :", c.rules.map((r) => r.label).join(", ") || "(none)");
  console.log("hasConstraints    :", c.hasConstraints);
  console.log("protein rotation  :", c.proteinRotation.join(", "));
  console.log("forbidden keywords:", c.forbiddenKeywords.length);

  if (!c.hasConstraints) {
    console.log(
      "\n  ⚠  NO CONSTRAINTS DERIVED. If this user should be vegan/gluten-free/etc,\n" +
        "     the restriction is not stored on the record — the generator is doing\n" +
        "     exactly what it was told. Fix the data, not the prompt.",
    );
  }

  const skeleton = buildMenuSkeleton(DAYS, c, 2000, planSeed(String(user._id), "2026-08-03"));

  console.log("\n─── PLANNED SLOTS (first 2 days) ─────────────────────────");
  for (const day of skeleton) {
    console.log(`  ${day.dayName}`);
    for (const m of day.meals) {
      console.log(`    ${m.slot.padEnd(9)} ${m.protein.padEnd(14)} ${m.archetype.slice(0, 54)}`);
    }
  }

  if (showPrompt) {
    console.log("\n─── PROMPT ───────────────────────────────────────────────\n");
    console.log(
      buildWeeklyPlanPrompt({
        userData: user,
        skeleton,
        constraints: c,
        targetCalories: 2000,
        macros: { protein: 120, carbs: 220, fat: 67 },
      }),
    );
  }

  await mongoose.disconnect();
})();
