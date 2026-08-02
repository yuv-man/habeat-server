/**
 * Resolves a mealId the way the recipe endpoint does, to show which lookup path
 * (shared `meals` collection, or embedded in the user's plan) actually finds it.
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";

(async () => {
  const [userId, mealId] = process.argv.slice(2);
  if (!userId || !mealId) {
    console.error("usage: check-meal-id.ts <userId> <mealId>");
    process.exit(1);
  }

  const uri =
    process.env.MONGO_URL_PROD || process.env.MONGO_URL ||
    process.env.MONGODB_URI || process.env.MONGO_URL_LOCAL;
  await mongoose.connect(uri!, { dbName: "habeat", authSource: "admin" });
  const conn = mongoose.connection;

  const valid = mongoose.Types.ObjectId.isValid(mealId);
  console.log(`mealId ${mealId}  (valid ObjectId: ${valid})`);

  const inMeals = valid
    ? await conn.collection("meals").findOne({ _id: new mongoose.Types.ObjectId(mealId) })
    : null;
  console.log(`  in "meals" collection : ${inMeals ? `YES — ${inMeals.name}` : "no"}`);

  const user = await conn.collection("users").findOne({
    _id: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : undefined as any,
  });
  console.log(`  userId resolves to    : ${user ? user.email : "NO SUCH USER"}`);

  const plan: any = await conn.collection("plans").findOne({ userId: user?._id });
  let found: any = null;
  let where = "";
  for (const [dateKey, day] of Object.entries((plan?.weeklyPlan ?? {}) as Record<string, any>)) {
    const meals = (day as any)?.meals ?? day ?? {};
    for (const [slot, meal] of [
      ["breakfast", meals.breakfast], ["lunch", meals.lunch], ["dinner", meals.dinner],
      ...(Array.isArray(meals.snacks) ? meals.snacks.map((s: any, i: number) => [`snack${i}`, s]) : []),
    ] as Array<[string, any]>) {
      if (meal && String(meal._id) === String(mealId)) {
        found = meal;
        where = `${dateKey} ${slot}`;
      }
    }
  }
  console.log(`  in user's plan        : ${found ? `YES — "${found.name}" (${where})` : "no"}`);

  if (plan) {
    const ids: string[] = [];
    for (const day of Object.values(plan.weeklyPlan ?? {}) as any[]) {
      const meals = day?.meals ?? day ?? {};
      for (const m of [meals.breakfast, meals.lunch, meals.dinner]) {
        if (m?._id) ids.push(String(m._id));
      }
    }
    const resolvable = await conn
      .collection("meals")
      .countDocuments({ _id: { $in: ids.filter((i) => mongoose.Types.ObjectId.isValid(i)).map((i) => new mongoose.Types.ObjectId(i)) } });
    console.log(`\nplan has ${ids.length} main meals; ${resolvable} of them exist in "meals".`);
    console.log(`→ ${ids.length - resolvable} would 404 without the plan-lookup fallback.`);
  }

  await mongoose.disconnect();
})();
