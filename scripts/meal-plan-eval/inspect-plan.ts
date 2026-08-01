/**
 * Prints the plan currently stored for a user: when it was generated, which
 * meals it contains, and whether any of them break the user's constraints.
 *
 * Answers "did the server actually make a new plan, or is the app showing me an
 * old one?" — which looks identical from the UI.
 *
 *   npx ts-node --transpile-only scripts/meal-plan-eval/inspect-plan.ts <email>
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import {
  resolveDietaryConstraints,
  findMealViolations,
} from "../../src/utils/dietary-constraints";

(async () => {
  const who = process.argv[2];
  if (!who) {
    console.error("usage: inspect-plan.ts <email>");
    process.exit(1);
  }

  const uri =
    process.env.MONGO_URL_PROD ||
    process.env.MONGO_URL ||
    process.env.MONGODB_URI ||
    process.env.MONGO_URL_LOCAL;
  if (!uri) {
    console.error("No Mongo URI in .env");
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: "habeat", authSource: "admin" });
  const conn = mongoose.connection;

  const user: any = await conn.collection("users").findOne({
    email: new RegExp(`^${who.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  });
  if (!user) {
    console.error(`No user ${who} in db "${conn.name}"`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const plans = await conn
    .collection("plans")
    .find({ userId: user._id })
    .sort({ generatedAt: -1 })
    .toArray();

  console.log(`\nuser ${user.email}  (${plans.length} plan document(s))`);

  const c = resolveDietaryConstraints(user);
  console.log(`restrictions: ${user.dietaryRestrictions?.join(", ") || "(none)"}`);
  console.log(`dislikes    : ${user.dislikes?.join(", ") || "(none)"}`);

  for (const plan of plans) {
    console.log(`\n─── plan ${plan._id} ─────────────────────────────`);
    console.log(`generatedAt     : ${plan.generatedAt}`);
    console.log(`createdAt       : ${plan.createdAt ?? "(n/a)"}`);
    console.log(`updatedAt       : ${plan.updatedAt ?? "(n/a)"}`);
    console.log(`generationStatus: ${plan.generationStatus ?? "(n/a)"}`);

    const weekly = (plan.weeklyPlan ?? {}) as Record<string, any>;
    const dateKeys = Object.keys(weekly).sort();
    console.log(`days            : ${dateKeys.length} (${dateKeys.join(", ")})`);

    let violations = 0;
    for (const key of dateKeys) {
      const day = weekly[key];
      const meals = day?.meals ?? day ?? {};
      const row = ["breakfast", "lunch", "dinner"]
        .map((slot) => {
          const meal = meals[slot];
          const name = meal?.name ?? "—";
          const bad = findMealViolations(meal, c);
          if (bad.length) violations++;
          return bad.length ? `${name} ⚠(${bad.join(",")})` : name;
        })
        .join("  |  ");
      console.log(`  ${key}  ${row}`);
    }

    console.log(
      violations > 0
        ? `\n  ⚠  ${violations} stored meal(s) violate this user's restrictions.`
        : `\n  ✓  no stored meal violates this user's restrictions.`,
    );
  }

  await mongoose.disconnect();
})();
