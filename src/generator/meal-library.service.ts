import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Meal } from "../meal/meal.model";
import { computeMealLabels, MEAL_LABELS_VERSION } from "../meal/meal-labels";
import { LibraryMeal } from "./library-picks";
import { LibrarySupply } from "./generate.service";
import { MealSlot } from "./meal-plan-prompt";
import { scheduleDailyAt } from "../behavior/behavior.schedule";
import logger from "../utils/logger";

/** Labels are recomputed after the nightly analysis, when nothing is waiting. */
const LABEL_HOUR = 4;
const LABEL_BATCH = 500;
/** Candidates loaded per request; plenty to choose a week from. */
const CANDIDATE_LIMIT = 1200;

/**
 * The shared meal library as a source for plans: keeps every meal labelled
 * (meal-labels.ts), and hands the generator the meals a user could be served.
 * The choosing itself is library-picks.ts.
 */
@Injectable()
export class MealLibraryService implements OnModuleInit {
  constructor(@InjectModel(Meal.name) private mealModel: Model<any>) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") return;
    // Off the startup path: the server answers requests while this runs.
    setTimeout(() => {
      this.labelPending().catch((err) => logger.warn(`[MealLibrary] Labelling failed: ${err}`));
    }, 10_000);
    scheduleDailyAt(LABEL_HOUR, () => {
      this.labelPending().catch((err) => logger.warn(`[MealLibrary] Labelling failed: ${err}`));
    });
  }

  /** Label every meal whose labels are missing or from an older version. No model calls. */
  async labelPending(): Promise<number> {
    let labelled = 0;
    for (;;) {
      const batch = await this.mealModel
        .find({ "labels.version": { $ne: MEAL_LABELS_VERSION } })
        .select("name calories macros ingredients prepTime")
        .limit(LABEL_BATCH)
        .lean()
        .exec();
      if (!batch.length) break;
      await this.mealModel.bulkWrite(
        batch.map((meal: any) => ({
          updateOne: { filter: { _id: meal._id }, update: { $set: { labels: computeMealLabels(meal) } } },
        })),
      );
      labelled += batch.length;
      if (batch.length < LABEL_BATCH) break;
    }
    if (labelled) logger.info(`[MealLibrary] Labelled ${labelled} meal(s)`);
    return labelled;
  }

  /**
   * Meals that could fill this user's slots — labelled, in their slots, with
   * real numbers. Dietary fit, dislikes and calories are checked per slot by
   * the picker; this only narrows the query.
   */
  async supplyFor(
    user: { mealLearningProfile?: { swappedMeals?: { name: string }[] } },
    activeSlots: MealSlot[],
    recentMeals: string[] = [],
  ): Promise<LibrarySupply> {
    const candidates = (await this.mealModel
      .find({
        category: { $in: activeSlots },
        "labels.version": MEAL_LABELS_VERSION,
        calories: { $gt: 0 },
        "ingredients.1": { $exists: true },
      })
      .select("name category calories macros ingredients prepTime labels analytics.timesCompleted")
      .sort({ "analytics.timesCompleted": -1 })
      .limit(CANDIDATE_LIMIT)
      .lean()
      .exec()) as any[];

    const swapped = (user.mealLearningProfile?.swappedMeals ?? []).map((m) => m.name);
    return {
      candidates: candidates.map(
        (m): LibraryMeal => ({
          _id: String(m._id),
          name: m.name,
          category: m.category,
          calories: m.calories,
          macros: m.macros ?? { protein: 0, carbs: 0, fat: 0 },
          ingredients: m.ingredients ?? [],
          prepTime: m.prepTime,
          labels: m.labels,
          timesCompleted: m.analytics?.timesCompleted ?? 0,
        }),
      ),
      avoidNames: [...recentMeals, ...swapped],
    };
  }
}
