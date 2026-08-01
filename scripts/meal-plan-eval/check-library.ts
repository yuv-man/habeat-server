/**
 * Replays the library-matching filter against the real `meals` collection for a
 * given user, to confirm nothing that violates their restrictions can be
 * substituted into a plan.
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
  const uri =
    process.env.MONGO_URL_PROD || process.env.MONGO_URL ||
    process.env.MONGODB_URI || process.env.MONGO_URL_LOCAL;

  await mongoose.connect(uri!, { dbName: "habeat", authSource: "admin" });
  const conn = mongoose.connection;

  const user: any = await conn.collection("users").findOne({
    email: new RegExp(`^${who}$`, "i"),
  });
  const c = resolveDietaryConstraints(user);

  const all = await conn.collection("meals").find({}).toArray();
  const bad = all.filter((m: any) => findMealViolations(m, c).length > 0);

  console.log(`\nuser: ${user.email}  restrictions: ${user.dietaryRestrictions?.join(", ")}`);
  console.log(`meals library: ${all.length} total`);
  console.log(`  would violate this user's restrictions: ${bad.length}`);
  console.log(`  safe to substitute                    : ${all.length - bad.length}`);

  console.log(`\nExamples now excluded:`);
  for (const m of bad.slice(0, 6)) {
    console.log(`  - ${String(m.name).slice(0, 62)}  →  ${findMealViolations(m, c).slice(0, 3).join(", ")}`);
  }

  const byCat: Record<string, number> = {};
  for (const m of all) {
    if (findMealViolations(m, c).length === 0) {
      byCat[m.category] = (byCat[m.category] ?? 0) + 1;
    }
  }
  console.log(`\nSafe fallbacks remaining per slot:`, JSON.stringify(byCat));

  await mongoose.disconnect();
})();
