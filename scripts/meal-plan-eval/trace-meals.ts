/**
 * Traces where a user's stored plan meals came from: are they freshly generated,
 * or pulled out of the shared `meals` collection / the user's favourites?
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";

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

  console.log("favoriteMeals on user:", JSON.stringify(user.favoriteMeals ?? null));
  console.log("isNewUser           :", user.isNewUser);
  console.log("path                :", user.path);

  const plan: any = await conn.collection("plans").findOne({ userId: user._id });
  const weekly = plan?.weeklyPlan ?? {};
  const firstKey = Object.keys(weekly).sort()[0];
  const breakfast = weekly[firstKey]?.meals?.breakfast;

  console.log("\n─── first stored breakfast, in full ───");
  console.log(JSON.stringify(breakfast, null, 2).slice(0, 1200));

  // Does this meal exist in the shared meals collection?
  const name = breakfast?.name;
  if (name) {
    const inMeals = await conn.collection("meals").find({ name }).toArray();
    console.log(`\n"${name}"`);
    console.log(`  found in meals collection: ${inMeals.length}`);
    for (const m of inMeals.slice(0, 3)) {
      console.log(`    _id=${m._id} category=${m.category} createdAt=${m.createdAt} timesGenerated=${m.analytics?.timesGenerated}`);
    }
  }

  const total = await conn.collection("meals").countDocuments();
  const steaky = await conn.collection("meals").countDocuments({ name: /steak|chicken|salmon|shrimp/i });
  console.log(`\nmeals collection: ${total} total, ${steaky} containing steak/chicken/salmon/shrimp`);

  await mongoose.disconnect();
})();
