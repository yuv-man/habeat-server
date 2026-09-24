import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import mongoose, { Model } from "mongoose";

import { DailyProgress } from "../progress/progress.model";
import { IDailyProgress } from "../types/interfaces";
import { User } from "../user/user.model";
import { findMealViolations, resolveDietaryConstraints } from "../utils/dietary-constraints";
import { getEffectiveSubscriptionTier, hasFeatureAccess } from "../enums/enumSubscription";
import { toLocalDateKey } from "../utils/eating-episodes";
import logger from "../utils/logger";
import {
  CAPTURE_WINDOW_DAYS,
  ProgressDayLike,
  RepertoireCandidate,
  extractLoggedDishes,
  findCandidates,
  observeRhythm,
  LoggedDish,
} from "./repertoire.capture";

/** One dish as the user names it, from onboarding or the "my dishes" screen. */
export interface DishInput {
  name: string;
  slots?: RepertoireSlot[];
  /** How often they eat it, if they said. */
  usualPerMonth?: number;
}

export interface AddDishResult {
  dish: IRepertoireDish | null;
  status: "added" | "already-known" | "rejected";
  /** Why a dish is not plannable: unresolved, or against their own diet. */
  note?: string;
}
import {
  IRepertoireDish,
  RepertoireDish,
  RepertoireStatus,
} from "./repertoire-dish.schema";
import { DishTuner, TuneProposal } from "./repertoire.tuner";
import { dishArtFor } from "./dish-images";
import { DishResolver, ResolvedDish } from "./repertoire.resolver";
import { dishKey, RepertoireSlot } from "./repertoire.capture";
import {
  Level,
  TuneState,
  TuneStateError,
  acceptLevel,
  clampToAvailable,
  rejectLevel,
} from "./repertoire.tune-state";

export interface TuneResult {
  dish: IRepertoireDish;
  /** False when the cached tunes were still valid and no model call was made. */
  generated: boolean;
  /** Levels the validator refused, and why — surfaced so a missing level is
   *  explainable rather than mysterious. */
  dropped: TuneProposal["dropped"];
}

/** Statuses a user can move a dish between. `declined` is capture's own. */
export type UserSettableStatus = Extract<RepertoireStatus, "active" | "paused" | "retired">;

/**
 * The user's repertoire: the dishes they cook, and the ones capture has
 * noticed and is proposing. Nothing here generates plans — see
 * docs/the-repertoire.md §14 for when the plan starts reading from it.
 */
@Injectable()
export class RepertoireService {
  constructor(
    @InjectModel(RepertoireDish.name)
    private readonly dishModel: Model<IRepertoireDish>,
    // Read-only: capture observes what progress recorded.
    @InjectModel(DailyProgress.name)
    private readonly progressModel: Model<IDailyProgress>,
    // Read-only: diet path, restrictions and dislikes shape the tunes.
    @InjectModel(User.name)
    private readonly userModel: Model<any>,
    private readonly tuner: DishTuner,
    private readonly resolver: DishResolver,
  ) {}

  private oid(userId: string): mongoose.Types.ObjectId {
    return new mongoose.Types.ObjectId(userId);
  }

  private async loadLogs(userId: string, now = new Date()): Promise<LoggedDish[]> {
    const from = new Date(now);
    from.setDate(from.getDate() - CAPTURE_WINDOW_DAYS);

    const days = await this.progressModel
      .find({ userId: this.oid(userId), dateKey: { $gte: toLocalDateKey(from) } })
      .select("dateKey meals")
      .lean()
      .exec();

    return extractLoggedDishes(days as unknown as ProgressDayLike[]);
  }

  /** Active and paused dishes, with their observed rhythm refreshed. */
  async list(userId: string): Promise<IRepertoireDish[]> {
    const [dishes, logs] = await Promise.all([
      this.dishModel
        .find({ userId: this.oid(userId), status: { $in: ["active", "paused"] } })
        .sort({ name: 1 })
        .lean()
        .exec(),
      this.loadLogs(userId),
    ]);

    const rhythm = observeRhythm(
      logs,
      dishes.map((d) => d.canonicalKey),
    );

    const writes = dishes.flatMap((d) => {
      const r = rhythm.get(d.canonicalKey);
      if (!r) return [];
      const changed =
        d.rhythm?.observedPerMonth !== r.observedPerMonth ||
        (r.lastCookedOn !== null && d.rhythm?.lastCookedOn !== r.lastCookedOn);
      if (!changed) return [];
      // Keep the last known cook date when it has aged out of the window.
      const lastCookedOn = r.lastCookedOn ?? d.rhythm?.lastCookedOn ?? null;
      d.rhythm = { ...d.rhythm, observedPerMonth: r.observedPerMonth, lastCookedOn };
      return [
        {
          updateOne: {
            filter: { _id: (d as any)._id },
            update: {
              $set: {
                "rhythm.observedPerMonth": r.observedPerMonth,
                "rhythm.lastCookedOn": lastCookedOn,
              },
            },
          },
        },
      ];
    });

    if (writes.length) {
      // A failed refresh leaves yesterday's numbers; it must not fail the read.
      await this.dishModel.bulkWrite(writes as any).catch((err) =>
        logger.warn(`[Repertoire] Rhythm refresh failed for ${userId}: ${err?.message || err}`),
      );
    }

    return dishes as IRepertoireDish[];
  }

  /** Dishes capture would propose right now. */
  async candidates(userId: string): Promise<RepertoireCandidate[]> {
    const [logs, known] = await Promise.all([
      this.loadLogs(userId),
      this.dishModel.distinct("canonicalKey", { userId: this.oid(userId) }).exec(),
    ]);
    return findCandidates(logs, new Set(known as string[]));
  }

  /**
   * Recomputed server-side rather than taken from the client, so a dish can
   * only enter the repertoire on the evidence capture itself accepts.
   */
  private async candidateOrThrow(userId: string, key: string): Promise<RepertoireCandidate> {
    const found = (await this.candidates(userId)).find((c) => c.key === key);
    if (!found) throw new NotFoundException("No such dish is being proposed");
    return found;
  }

  /**
   * The user said yes. For an `ask-source` candidate, yes *is* the answer to
   * "do you make this at home?", so both kinds land the same way.
   */
  async accept(userId: string, key: string): Promise<IRepertoireDish> {
    const c = await this.candidateOrThrow(userId, key);
    const rhythm = observeRhythm(await this.loadLogs(userId), [key]).get(key)!;

    const dish = await this.dishModel
      .findOneAndUpdate(
        { userId: this.oid(userId), canonicalKey: c.key },
        {
          $setOnInsert: { userId: this.oid(userId), canonicalKey: c.key },
          $set: {
            ...dishArtFor(c.name),
            name: c.name,
            slots: c.slots,
            source: "logged",
            status: "active",
            "usual.prepMinutes": c.prepMinutes,
            "usual.nutritionPerServing": c.nutritionPerServing,
            "usual.nutritionConfidence": "logged",
            "rhythm.observedPerMonth": rhythm.observedPerMonth,
            "rhythm.lastCookedOn": rhythm.lastCookedOn,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    logger.info(`[Repertoire] ${userId} added "${c.name}" (${c.kind})`);
    return dish as IRepertoireDish;
  }

  /** The user said no. Recorded so the same dish is never proposed again. */
  async decline(userId: string, key: string): Promise<void> {
    const c = await this.candidateOrThrow(userId, key);
    await this.dishModel
      .updateOne(
        { userId: this.oid(userId), canonicalKey: c.key },
        {
          $setOnInsert: {
            userId: this.oid(userId),
            canonicalKey: c.key,
            name: c.name,
            source: "logged",
          },
          $set: { status: "declined" },
        },
        { upsert: true },
      )
      .exec();
  }

  async setStatus(
    userId: string,
    dishId: string,
    status: UserSettableStatus,
  ): Promise<IRepertoireDish> {
    if (!mongoose.Types.ObjectId.isValid(dishId)) {
      throw new NotFoundException("Dish not found");
    }
    const dish = await this.dishModel
      .findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(dishId),
          userId: this.oid(userId),
          status: { $ne: "declined" },
        },
        { $set: { status } },
        { new: true },
      )
      .lean()
      .exec();
    if (!dish) throw new NotFoundException("Dish not found");
    return dish as IRepertoireDish;
  }

  private async findDish(userId: string, dishId: string): Promise<IRepertoireDish & { _id: any }> {
    if (!mongoose.Types.ObjectId.isValid(dishId)) throw new NotFoundException("Dish not found");
    const dish = await this.dishModel
      .findOne({
        _id: new mongoose.Types.ObjectId(dishId),
        userId: this.oid(userId),
        status: { $in: ["active", "paused"] },
      })
      .lean()
      .exec();
    if (!dish) throw new NotFoundException("Dish not found");
    return dish as any;
  }

  /**
   * Generate tuned versions of a dish, once. Cached tunes are returned as they
   * are unless the user's diet path changed since they were written, or
   * `force` is set.
   */
  async tune(userId: string, dishId: string, force = false): Promise<TuneResult> {
    const dish = await this.findDish(userId, dishId);
    const user = (await this.userModel
      .findById(this.oid(userId))
      .select("path dietaryRestrictions allergies dislikes")
      .lean()
      .exec()) as {
      path?: string;
      dietaryRestrictions?: string[];
      allergies?: string[];
      dislikes?: string[];
    } | null;
    const path: string | null = user?.path ?? null;

    if (!force && dish.tunes?.length && dish.tunedForPath === path) {
      return { dish, generated: false, dropped: [] };
    }
    // Already tried for this path and nothing survived: the answer won't
    // change by asking again, and every ask is billed. Only `force` retries.
    if (!force && !dish.tunes?.length && dish.tuneAttemptedForPath === path && dish.tuneAttemptedAt) {
      return { dish, generated: false, dropped: [] };
    }

    const proposal = await this.tuner.tune(
      dish,
      path,
      resolveDietaryConstraints(user ?? {}),
      user?.dislikes ?? [],
    );
    if (!proposal) {
      throw new ServiceUnavailableException("Dish tuning is unavailable right now");
    }
    const attempted = { tuneAttemptedForPath: path, tuneAttemptedAt: new Date() };
    // Nothing survived validation. Keep what the dish had — a failed re-tune
    // must not wipe tunes the user has already accepted — but remember the
    // attempt, so the next plan does not pay for the same answer again.
    if (!proposal.tunes.length) {
      const marked = await this.dishModel
        .findOneAndUpdate({ _id: dish._id, userId: this.oid(userId) }, { $set: attempted }, { new: true })
        .lean()
        .exec();
      return { dish: (marked ?? dish) as IRepertoireDish, generated: true, dropped: proposal.dropped };
    }

    const $set: Record<string, unknown> = {
      tunes: proposal.tunes.map((t) => ({ ...t, rejections: 0 })),
      currentTuneLevel: clampToAvailable(dish.currentTuneLevel ?? 0, proposal.tunes),
      tunedForPath: path,
      tunedAt: new Date(),
      ...attempted,
    };
    if (proposal.usual) {
      $set["usual.ingredients"] = proposal.usual.ingredients;
      // Logged nutrition is evidence; the model's estimate only fills a gap.
      if (!dish.usual?.nutritionPerServing) {
        $set["usual.nutritionPerServing"] = proposal.usual.nutritionPerServing;
        $set["usual.nutritionConfidence"] = "estimated";
      }
    }

    const updated = await this.dishModel
      .findOneAndUpdate({ _id: dish._id, userId: this.oid(userId) }, { $set }, { new: true })
      .lean()
      .exec();

    logger.info(
      `[Repertoire] Tuned "${dish.name}" for ${userId}: levels ${proposal.tunes
        .map((t) => t.level)
        .join(",")}`,
    );
    return { dish: updated as IRepertoireDish, generated: true, dropped: proposal.dropped };
  }

  private async saveTuneState(
    userId: string,
    dish: { _id: any },
    state: TuneState,
  ): Promise<IRepertoireDish> {
    const updated = await this.dishModel
      .findOneAndUpdate(
        { _id: dish._id, userId: this.oid(userId) },
        {
          $set: {
            tunes: state.tunes,
            currentTuneLevel: state.currentTuneLevel,
            tuneCeiling: state.tuneCeiling,
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    return updated as IRepertoireDish;
  }

  private applyOrBadRequest(fn: () => TuneState): TuneState {
    try {
      return fn();
    } catch (err) {
      if (err instanceof TuneStateError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  async acceptTune(userId: string, dishId: string, level: Level): Promise<IRepertoireDish> {
    const dish = await this.findDish(userId, dishId);
    const state = this.applyOrBadRequest(() => acceptLevel(dish, level));
    return this.saveTuneState(userId, dish, state);
  }

  async rejectTune(userId: string, dishId: string, level: 1 | 2 | 3): Promise<IRepertoireDish> {
    const dish = await this.findDish(userId, dishId);
    const state = this.applyOrBadRequest(() => rejectLevel(dish, level));
    return this.saveTuneState(userId, dish, state);
  }

  private async constraintsFor(userId: string) {
    const user = (await this.userModel
      .findById(this.oid(userId))
      .select("dietaryRestrictions allergies")
      .lean()
      .exec()) as { dietaryRestrictions?: string[]; allergies?: string[] } | null;
    return resolveDietaryConstraints(user ?? {});
  }

  /**
   * Add a dish the user told us they cook — onboarding's "what do you eat most
   * weeks?", or the my-dishes screen. The name is theirs; the recipe and
   * nutrition are resolved (repertoire.resolver.ts) so the planner can use it.
   *
   * A dish that cannot be resolved is still stored, with its name and nothing
   * else: asking someone to re-type it because a model was unavailable is the
   * wrong trade. It is paused, so it is never planned on a blank estimate.
   */
  async addDish(
    userId: string,
    input: DishInput,
    source: "onboarding" | "manual" = "manual",
    constraints?: Awaited<ReturnType<RepertoireService["constraintsFor"]>>,
  ): Promise<AddDishResult> {
    const name = (input.name ?? "").trim().slice(0, 200);
    const key = dishKey(name);
    if (!name || !key) return { dish: null, status: "rejected", note: "not a dish name" };

    const existing = await this.dishModel
      .findOne({ userId: this.oid(userId), canonicalKey: key })
      .lean()
      .exec();
    if (existing && existing.status !== "declined") {
      return { dish: existing as IRepertoireDish, status: "already-known" };
    }

    const userConstraints = constraints ?? (await this.constraintsFor(userId));
    const resolved =
      (await this.resolvedElsewhere(key, name, userConstraints, input.slots)) ??
      (await this.resolver.resolve(name, userConstraints, input.slots));

    const note = !resolved
      ? "could not work out how this dish is made — add the details later"
      : resolved.violations.length
        ? `paused: contains ${resolved.violations.join(", ")}, which your restrictions rule out`
        : undefined;

    const dish = await this.dishModel
      .findOneAndUpdate(
        { userId: this.oid(userId), canonicalKey: key },
        {
          $setOnInsert: { userId: this.oid(userId), canonicalKey: key },
          $set: {
            ...dishArtFor(name),
            name,
            source,
            status: resolved && !resolved.violations.length ? "active" : "paused",
            slots: resolved?.slots ?? input.slots ?? ["lunch", "dinner"],
            "usual.ingredients": resolved?.ingredients ?? [],
            "usual.prepMinutes": resolved?.prepMinutes ?? null,
            "usual.nutritionPerServing": resolved?.nutritionPerServing ?? null,
            "usual.nutritionConfidence": "estimated",
            "rhythm.usualPerMonth": input.usualPerMonth ?? null,
            "rhythm.leftoversFriendly": resolved?.leftoversFriendly ?? false,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    logger.info(`[Repertoire] ${userId} added "${name}" (${source})${note ? ` — ${note}` : ""}`);
    return { dish: dish as IRepertoireDish, status: "added", note };
  }

  /**
   * The same dish as another user already has, resolved: its ingredients,
   * nutrition and slots. How a schnitzel is made does not depend on who asks,
   * and resolving it was a paid model call per user. This user's own
   * restrictions are checked afresh — the other user's are not theirs.
   * Only estimates are shared; nutrition someone logged is their own record.
   */
  private async resolvedElsewhere(
    key: string,
    name: string,
    constraints: Awaited<ReturnType<RepertoireService["constraintsFor"]>>,
    slotHint?: RepertoireSlot[],
  ): Promise<ResolvedDish | null> {
    const other = (await this.dishModel
      .findOne({
        canonicalKey: key,
        "usual.nutritionPerServing": { $ne: null },
        "usual.nutritionConfidence": "estimated",
        "usual.ingredients.1": { $exists: true },
      })
      .select("usual slots rhythm.leftoversFriendly")
      .lean()
      .exec()) as any;
    if (!other) return null;

    const ingredients = (other.usual.ingredients ?? []).map((i: any) => ({
      name: String(i.name),
      amount: String(i.amount ?? ""),
    }));
    logger.info(`[Repertoire] Reused the resolution of "${name}" (${key}) — no model call`);
    return {
      ingredients,
      nutritionPerServing: other.usual.nutritionPerServing,
      prepMinutes: other.usual.prepMinutes ?? 20,
      slots: slotHint?.length ? slotHint : other.slots?.length ? other.slots : ["lunch", "dinner"],
      leftoversFriendly: other.rhythm?.leftoversFriendly ?? false,
      violations: findMealViolations({ name, ingredients }, constraints),
    };
  }

  /**
   * Onboarding sends the whole screen at once. Resolved a few at a time: each
   * dish is its own model call, and onboarding is waiting on all of them.
   */
  async addDishes(
    userId: string,
    inputs: DishInput[],
    source: "onboarding" | "manual" = "onboarding",
  ): Promise<AddDishResult[]> {
    const constraints = await this.constraintsFor(userId);
    const results: AddDishResult[] = [];
    const CONCURRENCY = 4;

    for (let i = 0; i < inputs.length; i += CONCURRENCY) {
      results.push(
        ...(await Promise.all(
          inputs
            .slice(i, i + CONCURRENCY)
            .map((input) =>
              this.addDish(userId, input, source, constraints).catch((err) => {
                logger.error(`[Repertoire] "${input?.name}" failed: ${err?.message || err}`);
                return { dish: null, status: "rejected" as const, note: "could not be added" };
              }),
            ),
        )),
      );
    }

    // Their dishes are better versions of themselves by the time the first
    // plan is built, if the models are quick enough; if not, the plan uses
    // them as they are and picks the tunes up next week.
    void this.tunePending(userId, inputs.length).catch(() => undefined);

    return results;
  }

  /**
   * Hearting a meal in the plan adds it to "my meals"; un-hearting takes it
   * back out.
   *
   * Favourites and the dishes someone cooks were two separate lists of the
   * same thing — food this person wants to eat again. They are one list now,
   * and the planner builds around all of it. A hearted meal needs no resolving:
   * the plan already holds its ingredients, portion and nutrition.
   */
  async setFavourite(
    userId: string,
    meal: {
      _id?: unknown;
      name?: string;
      category?: string;
      calories?: number;
      macros?: { protein?: number; carbs?: number; fat?: number };
      ingredients?: unknown[];
      prepTime?: number;
    },
    favourite: boolean,
  ): Promise<IRepertoireDish | null> {
    const name = (meal?.name ?? "").trim();
    const key = dishKey(name);
    if (!name || !key) return null;

    const existing = await this.dishModel
      .findOne({ userId: this.oid(userId), canonicalKey: key })
      .lean()
      .exec();

    if (!favourite) {
      if (!existing) return null;
      // A dish that is only here because it was hearted goes when the heart
      // does. One they cook — from onboarding, or from their own logs — stays:
      // un-hearting is not "I never eat this".
      const status = existing.source === "favourite" ? "retired" : existing.status;
      const updated = await this.dishModel
        .findOneAndUpdate(
          { _id: (existing as any)._id },
          { $set: { favourite: false, status } },
          { new: true },
        )
        .lean()
        .exec();
      return updated as IRepertoireDish;
    }

    const ingredients = (Array.isArray(meal.ingredients) ? meal.ingredients : [])
      .map((i: any) =>
        Array.isArray(i)
          ? { name: String(i[0] ?? ""), amount: String(i[1] ?? "") }
          : { name: String(i?.name ?? ""), amount: String(i?.amount ?? "") },
      )
      .filter((i) => i.name);

    const nutrition =
      typeof meal.calories === "number" && meal.calories > 0
        ? {
            calories: Math.round(meal.calories),
            protein: Math.round(meal.macros?.protein ?? 0),
            carbs: Math.round(meal.macros?.carbs ?? 0),
            fat: Math.round(meal.macros?.fat ?? 0),
          }
        : null;

    const slots = meal.category ? [meal.category] : existing?.slots ?? ["lunch", "dinner"];

    const dish = await this.dishModel
      .findOneAndUpdate(
        { userId: this.oid(userId), canonicalKey: key },
        {
          $setOnInsert: {
            userId: this.oid(userId),
            canonicalKey: key,
            source: "favourite",
          },
          $set: {
            ...dishArtFor(name),
            name,
            favourite: true,
            // Back from retired, whatever took it out before.
            status: "active",
            slots,
            ...(meal._id ? { mealId: String(meal._id) } : {}),
            // Never overwrite a better record with a thinner one.
            ...(ingredients.length && !existing?.usual?.ingredients?.length
              ? { "usual.ingredients": ingredients }
              : {}),
            ...(nutrition && !existing?.usual?.nutritionPerServing
              ? {
                  "usual.nutritionPerServing": nutrition,
                  "usual.nutritionConfidence": "user-confirmed",
                }
              : {}),
            ...(typeof meal.prepTime === "number" && existing?.usual?.prepMinutes == null
              ? { "usual.prepMinutes": meal.prepTime }
              : {}),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    logger.info(`[Repertoire] ${userId} hearted "${name}" — now one of their meals`);
    return dish as IRepertoireDish;
  }

  /**
   * Work out the better versions of dishes that do not have them yet.
   *
   * Runs in the background, one dish at a time: each is a model call, and
   * nobody should wait on it. Until a dish is tuned it is simply planned as
   * they make it, which is a fine answer — it is their food either way.
   */
  async tunePending(userId: string, limit = 6): Promise<number> {
    // Both generation phases ask for this seconds apart; two runs at once both
    // saw the same untuned dishes and paid for each of them twice.
    if (this.tuningUsers.has(userId)) return 0;
    this.tuningUsers.add(userId);
    try {
      return await this.tunePendingNow(userId, limit);
    } finally {
      this.tuningUsers.delete(userId);
    }
  }

  /** Users with a tuning run in progress, in this process. */
  private readonly tuningUsers = new Set<string>();

  private async tunePendingNow(userId: string, limit: number): Promise<number> {
    const user = (await this.userModel
      .findById(this.oid(userId))
      .select("path subscriptionTier role")
      .lean()
      .exec()) as { path?: string; subscriptionTier?: string; role?: string } | null;
    const path: string | null = user?.path ?? null;
    // Healthier versions of their dishes are a Plus feature: each is a model
    // call per dish. Free users are planned their dishes as they make them.
    if (!hasFeatureAccess(getEffectiveSubscriptionTier(user?.subscriptionTier, user?.role), "dishTuning")) {
      return 0;
    }

    const pending = await this.dishModel
      .find({
        userId: this.oid(userId),
        status: "active",
        $and: [
          {
            $or: [
              { tunes: { $size: 0 } },
              { tunes: { $exists: false } },
              // Stored before versions had names of their own: unusable, because a
              // swap the user cannot see is not a swap.
              { "tunes.0.name": { $exists: false } },
            ],
          },
          {
            // Tried for this path already and nothing survived: not pending. This
            // ran after every plan, re-buying the same rejected answers each week.
            $or: [{ tuneAttemptedAt: null }, { tuneAttemptedForPath: { $ne: path } }],
          },
        ],
      })
      .select("_id name")
      .limit(limit)
      .lean()
      .exec();

    let tuned = 0;
    for (const dish of pending) {
      try {
        const result = await this.tune(userId, String((dish as any)._id));
        if (result.dish?.tunes?.length) tuned++;
      } catch (err: any) {
        logger.warn(`[Repertoire] Could not tune "${dish.name}": ${err?.message || err}`);
      }
    }
    if (tuned) logger.info(`[Repertoire] Tuned ${tuned} dish(es) for ${userId}`);
    return tuned;
  }

  /**
   * Dish names to build the plan around — what the user actually cooks.
   * Read by the meal generator; paused, retired and declined dishes are out.
   */
  async plannableDishes(userId: string, limit = 12): Promise<IRepertoireDish[]> {
    const dishes = await this.dishModel
      .find({ userId: this.oid(userId), status: "active" })
      // tunes and tuneCeiling included: without them the planner has no better
      // version to serve and every dish goes in exactly as it is.
      .select("name slots usual rhythm tunes tuneCeiling")
      .sort({ "rhythm.lastCookedOn": 1 })
      .limit(limit)
      .lean()
      .exec();
    return dishes as IRepertoireDish[];
  }

  async plannableDishNames(userId: string, limit = 12): Promise<string[]> {
    return (await this.plannableDishes(userId, limit)).map((d) => d.name).filter(Boolean);
  }
}
