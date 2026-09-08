#!/usr/bin/env node
/**
 * Merges duplicate meal-mood correlations down to one per (user, meal, date).
 *
 * Why this exists: the post-meal check-in used to POST a fresh correlation for
 * every answer — the eating-mode card wrote one, the mood modal wrote another —
 * so a single meal could end up as two or three partial rows. The check-in now
 * upserts, and `mealMoodCorrelationSchema` carries a unique index on
 * (userId, mealId, date) to keep it that way. That index cannot build while
 * the duplicates are still there, so run this once before deploying.
 *
 *   node scripts/dedupe-meal-mood-correlations.js            # report only
 *   node scripts/dedupe-meal-mood-correlations.js --apply    # merge + delete
 *
 * Merge rule: keep the oldest document, and fill each of its empty fields from
 * the newer siblings, newest first. Nothing set by the user is discarded.
 */

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const APPLY = process.argv.includes("--apply");

// Order matters only for readability; every one of these is merge-by-absence.
const MERGEABLE = [
  "moodBefore",
  "moodAfter",
  "eatingMode",
  "hungerLevelBefore",
  "satisfactionAfter",
  "notes",
  "biometrics",
];

const isEmpty = (value) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (typeof value === "object" && Object.keys(value).length === 0);

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("Set MONGODB_URI (or MONGO_URI) first.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const collection = mongoose.connection.collection("meal_mood_correlations");

  const groups = await collection
    .aggregate(
      [
        {
          $group: {
            _id: { userId: "$userId", mealId: "$mealId", date: "$date" },
            ids: { $push: "$_id" },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ],
      { allowDiskUse: true }
    )
    .toArray();

  if (groups.length === 0) {
    console.log("No duplicates. The unique index will build cleanly.");
    await mongoose.disconnect();
    return;
  }

  const extra = groups.reduce((sum, g) => sum + g.count - 1, 0);
  console.log(
    `${groups.length} meals have duplicate correlations (${extra} rows to remove).`
  );

  if (!APPLY) {
    console.log("Dry run. Re-run with --apply to merge them.");
    await mongoose.disconnect();
    return;
  }

  let merged = 0;
  for (const group of groups) {
    const docs = await collection
      .find({ _id: { $in: group.ids } })
      .sort({ createdAt: 1 })
      .toArray();

    const [keep, ...rest] = docs;
    const patch = {};

    // Newest first, so the most recent answer wins any field the keeper lacks.
    for (const doc of [...rest].reverse()) {
      for (const field of MERGEABLE) {
        if (isEmpty(keep[field]) && isEmpty(patch[field]) && !isEmpty(doc[field])) {
          patch[field] = doc[field];
        }
      }
      // A meal flagged emotional in any row stays flagged.
      if (doc.wasEmotionalEating) patch.wasEmotionalEating = true;
    }

    if (Object.keys(patch).length > 0) {
      await collection.updateOne({ _id: keep._id }, { $set: patch });
    }
    await collection.deleteMany({ _id: { $in: rest.map((d) => d._id) } });
    merged += rest.length;
  }

  console.log(`Merged and removed ${merged} duplicate rows.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
