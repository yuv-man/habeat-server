import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import mongoose from "mongoose";

import { RepertoireService } from "../../../src/repertoire/repertoire.service";
import { dishKey } from "../../../src/repertoire/repertoire.capture";
import { DishTuner } from "../../../src/repertoire/repertoire.tuner";
import { DishResolver } from "../../../src/repertoire/repertoire.resolver";

const USER_ID = new mongoose.Types.ObjectId().toString();

const today = new Date();
const daysAgo = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

const cooked = (name: string) => ({
  name,
  done: true,
  source: "cooked",
  calories: 600,
  macros: { protein: 35, carbs: 60, fat: 20 },
  prepTime: 25,
});

const chain = (value: any) => ({
  select: () => chain(value),
  sort: () => chain(value),
  limit: () => chain(value),
  lean: () => chain(value),
  exec: async () => value,
});

const build = async (
  opts: {
    progress?: any[];
    dishes?: any[];
    knownKeys?: string[];
    dish?: any;
    user?: any;
    proposal?: any;
    resolved?: any;
  } = {},
) => {
  const progressModel = { find: jest.fn(() => chain(opts.progress ?? [])) };
  const userModel = { findById: jest.fn(() => chain(opts.user ?? null)) };
  const tuner = { tune: jest.fn(async () => opts.proposal ?? null) };
  const resolver = { resolve: jest.fn(async () => opts.resolved ?? null) };
  const dishModel = {
    findOne: jest.fn(() => chain(opts.dish ?? null)),
    find: jest.fn(() => chain(opts.dishes ?? [])),
    distinct: jest.fn(() => chain(opts.knownKeys ?? [])),
    findOneAndUpdate: jest.fn((_f: any, update: any) => chain({ _id: "d1", ...update.$set })),
    updateOne: jest.fn(() => chain({})),
    bulkWrite: jest.fn().mockResolvedValue({}),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      RepertoireService,
      { provide: getModelToken("RepertoireDish"), useValue: dishModel },
      { provide: getModelToken("DailyProgress"), useValue: progressModel },
      { provide: getModelToken("User"), useValue: userModel },
      { provide: DishTuner, useValue: tuner },
      { provide: DishResolver, useValue: resolver },
    ],
  }).compile();

  return { service: moduleRef.get(RepertoireService), dishModel, progressModel, tuner, resolver };
};

const twiceCookedCurry = [
  { dateKey: daysAgo(3), meals: { dinner: cooked("Chicken Curry") } },
  { dateKey: daysAgo(10), meals: { dinner: cooked("Chicken Curry") } },
];

describe("RepertoireService", () => {
  it("only reads progress inside the capture window", async () => {
    const { service, progressModel } = await build();
    await service.candidates(USER_ID);

    const filter = (progressModel.find.mock.calls[0] as any[])[0];
    expect(filter.dateKey.$gte).toBe(daysAgo(30));
  });

  it("adds an accepted candidate as an active, logged dish", async () => {
    const { service, dishModel } = await build({ progress: twiceCookedCurry });
    await service.accept(USER_ID, dishKey("Chicken Curry"));

    const [filter, update, options] = dishModel.findOneAndUpdate.mock.calls[0] as any[];
    expect(filter.canonicalKey).toBe(dishKey("Chicken Curry"));
    expect(update.$set).toMatchObject({
      name: "Chicken Curry",
      slots: ["dinner"],
      source: "logged",
      status: "active",
      "usual.nutritionConfidence": "logged",
      "usual.nutritionPerServing": { calories: 600, protein: 35, carbs: 60, fat: 20 },
      "rhythm.lastCookedOn": daysAgo(3),
    });
    expect(options.upsert).toBe(true);
  });

  it("refuses to add a dish capture is not proposing", async () => {
    const { service, dishModel } = await build({ progress: twiceCookedCurry });
    await expect(service.accept(USER_ID, dishKey("Pizza"))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(dishModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("records a decline so the dish is never proposed again", async () => {
    const { service, dishModel } = await build({ progress: twiceCookedCurry });
    await service.decline(USER_ID, dishKey("Chicken Curry"));

    const [, update, options] = dishModel.updateOne.mock.calls[0] as any[];
    expect(update.$set).toEqual({ status: "declined" });
    expect(update.$setOnInsert.name).toBe("Chicken Curry");
    expect(options).toEqual({ upsert: true });
  });

  it("does not propose dishes already in the repertoire", async () => {
    const { service } = await build({
      progress: twiceCookedCurry,
      knownKeys: [dishKey("Chicken Curry")],
    });
    expect(await service.candidates(USER_ID)).toEqual([]);
  });

  it("refreshes observed rhythm on read, and only writes what changed", async () => {
    const key = dishKey("Chicken Curry");
    const { service, dishModel } = await build({
      progress: twiceCookedCurry,
      dishes: [
        { _id: "a", canonicalKey: key, rhythm: { observedPerMonth: 0, lastCookedOn: null } },
        { _id: "b", canonicalKey: dishKey("Soup"), rhythm: { observedPerMonth: 0, lastCookedOn: null } },
      ],
    });

    const dishes = await service.list(USER_ID);

    const writes = dishModel.bulkWrite.mock.calls[0][0] as any[];
    expect(writes).toHaveLength(1);
    expect(writes[0].updateOne.filter).toEqual({ _id: "a" });
    expect(dishes[0].rhythm).toMatchObject({ observedPerMonth: 2, lastCookedOn: daysAgo(3) });
  });

  it("rejects a status change on an invalid id", async () => {
    const { service } = await build();
    await expect(service.setStatus(USER_ID, "nope", "paused")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe("tuning", () => {
    const DISH_ID = new mongoose.Types.ObjectId().toString();
    const nutrition = { calories: 600, protein: 35, carbs: 60, fat: 20 };
    const proposedTune = (level: 1 | 2 | 3) => ({
      level,
      changes: ["less rice"],
      ingredients: [{ name: "rice", amount: "80 g" }],
      nutritionPerServing: nutrition,
    });
    const capturedDish = (over: any = {}) => ({
      _id: DISH_ID,
      name: "Chicken Curry",
      slots: ["dinner"],
      usual: { ingredients: [], nutritionPerServing: nutrition, nutritionConfidence: "logged" },
      tunes: [],
      currentTuneLevel: 0,
      tuneCeiling: 3,
      tunedForPath: null,
      ...over,
    });

    it("returns cached tunes without calling the model while the path is unchanged", async () => {
      const { service, tuner } = await build({
        dish: capturedDish({ tunes: [proposedTune(1)], tunedForPath: "lose-weight" }),
        user: { path: "lose-weight" },
      });
      const r = await service.tune(USER_ID, DISH_ID);
      expect(r.generated).toBe(false);
      expect(tuner.tune).not.toHaveBeenCalled();
    });

    it("re-tunes when the diet path changed", async () => {
      const { service, tuner } = await build({
        dish: capturedDish({ tunes: [proposedTune(1)], tunedForPath: "lose-weight" }),
        user: { path: "gain-muscle" },
        proposal: { usual: null, tunes: [proposedTune(1)], dropped: [] },
      });
      const r = await service.tune(USER_ID, DISH_ID);
      expect(r.generated).toBe(true);
      expect(tuner.tune).toHaveBeenCalled();
    });

    it("stores the reconstructed recipe but keeps the logged nutrition", async () => {
      const { service, dishModel } = await build({
        dish: capturedDish(),
        user: { path: "lose-weight", dietaryRestrictions: ["vegan"], dislikes: ["okra"] },
        proposal: {
          usual: { ingredients: [{ name: "rice", amount: "120 g" }], nutritionPerServing: { ...nutrition, calories: 650 } },
          tunes: [proposedTune(1), proposedTune(2)],
          dropped: [{ level: 3, reason: "lower level missing" }],
        },
      });

      const r = await service.tune(USER_ID, DISH_ID);
      const $set = (dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set;

      expect($set["usual.ingredients"]).toEqual([{ name: "rice", amount: "120 g" }]);
      expect($set).not.toHaveProperty("usual.nutritionPerServing");
      expect($set.tunes.map((t: any) => [t.level, t.rejections])).toEqual([[1, 0], [2, 0]]);
      expect($set.tunedForPath).toBe("lose-weight");
      expect(r.dropped).toHaveLength(1);
    });

    it("passes the user's constraints and dislikes to the tuner", async () => {
      const { service, tuner } = await build({
        dish: capturedDish(),
        user: { path: null, dietaryRestrictions: ["vegan"], dislikes: ["okra"] },
        proposal: { usual: null, tunes: [proposedTune(1)], dropped: [] },
      });
      await service.tune(USER_ID, DISH_ID);
      const [, , constraints, dislikes] = (tuner.tune.mock.calls[0] as unknown) as any[];
      expect(constraints.hasConstraints).toBe(true);
      expect(dislikes).toEqual(["okra"]);
    });

    it("keeps existing tunes when a re-tune produces nothing usable", async () => {
      const { service, dishModel } = await build({
        dish: capturedDish({ tunes: [proposedTune(1)], tunedForPath: "keto" }),
        user: { path: "lose-weight" },
        proposal: { usual: null, tunes: [], dropped: [{ level: 0, reason: "no usable baseline" }] },
      });
      await service.tune(USER_ID, DISH_ID);
      // Only the attempt is recorded — the tunes the user has are left alone.
      const $set = (dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set;
      expect(Object.keys($set).sort()).toEqual(["tuneAttemptedAt", "tuneAttemptedForPath"]);
      expect($set.tuneAttemptedForPath).toBe("lose-weight");
    });

    it("does not pay again for a dish that could not be improved on this path", async () => {
      const { service, tuner } = await build({
        dish: capturedDish({ tuneAttemptedForPath: "lose-weight", tuneAttemptedAt: new Date() }),
        user: { path: "lose-weight" },
        proposal: { usual: null, tunes: [proposedTune(1)], dropped: [] },
      });
      const r = await service.tune(USER_ID, DISH_ID);
      expect(r.generated).toBe(false);
      expect(tuner.tune).not.toHaveBeenCalled();
    });

    it("tries again when the path changes, or when forced", async () => {
      const attempted = { tuneAttemptedForPath: "lose-weight", tuneAttemptedAt: new Date() };
      const changed = await build({
        dish: capturedDish(attempted),
        user: { path: "gain-muscle" },
        proposal: { usual: null, tunes: [proposedTune(1)], dropped: [] },
      });
      await changed.service.tune(USER_ID, DISH_ID);
      expect(changed.tuner.tune).toHaveBeenCalled();

      const forced = await build({
        dish: capturedDish(attempted),
        user: { path: "lose-weight" },
        proposal: { usual: null, tunes: [proposedTune(1)], dropped: [] },
      });
      await forced.service.tune(USER_ID, DISH_ID, true);
      expect(forced.tuner.tune).toHaveBeenCalled();
    });

    it("does not tune dishes for a free user", async () => {
      const { service, dishModel, tuner } = await build({ user: { path: "lose-weight", subscriptionTier: "free" } });
      expect(await service.tunePending(USER_ID)).toBe(0);
      expect(dishModel.find).not.toHaveBeenCalled();
      expect(tuner.tune).not.toHaveBeenCalled();
    });

    it("runs one tuning pass per user at a time", async () => {
      const { service, dishModel } = await build({ user: { path: "lose-weight", subscriptionTier: "plus" }, dishes: [] });
      await Promise.all([service.tunePending(USER_ID), service.tunePending(USER_ID)]);
      // The second call found a run in progress and left it to finish.
      expect(dishModel.find).toHaveBeenCalledTimes(1);
      // ...and once it has, the next plan can tune again.
      await service.tunePending(USER_ID);
      expect(dishModel.find).toHaveBeenCalledTimes(2);
    });

    it("leaves dishes already tried on this path out of the pending list", async () => {
      const { service, dishModel } = await build({ user: { path: "lose-weight", subscriptionTier: "plus" }, dishes: [] });
      await service.tunePending(USER_ID);
      const filter = (dishModel.find.mock.calls[0] as any[])[0];
      expect(filter.$and[1].$or).toEqual([
        { tuneAttemptedAt: null },
        { tuneAttemptedForPath: { $ne: "lose-weight" } },
      ]);
    });

    it("reports the model being unavailable", async () => {
      const { service } = await build({ dish: capturedDish(), user: {} });
      await expect(service.tune(USER_ID, DISH_ID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("persists an accepted level and refuses one that does not exist", async () => {
      const { service, dishModel } = await build({
        dish: capturedDish({ tunes: [proposedTune(1)] }),
      });
      await service.acceptTune(USER_ID, DISH_ID, 1);
      const $set = (dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set;
      expect($set.currentTuneLevel).toBe(1);

      await expect(service.acceptTune(USER_ID, DISH_ID, 3)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("persists a rejection", async () => {
      const { service, dishModel } = await build({
        dish: capturedDish({ tunes: [proposedTune(1), proposedTune(2)].map((t) => ({ ...t, rejections: 1 })), currentTuneLevel: 2 }),
      });
      await service.rejectTune(USER_ID, DISH_ID, 2);
      const $set = (dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set;
      expect($set.currentTuneLevel).toBe(1);
      expect($set.tuneCeiling).toBe(1); // second rejection pins it
    });
  });

  describe("dishes the user tells us about", () => {
    const soup = {
      ingredients: [{ name: "chicken", amount: "120 g" }, { name: "noodles", amount: "50 g" }],
      nutritionPerServing: { calories: 404, protein: 35, carbs: 30, fat: 16 },
      prepMinutes: 45,
      slots: ["lunch", "dinner"],
      leftoversFriendly: true,
      violations: [],
    };

    it("stores a dish the user named, resolved and plannable", async () => {
      const { service, dishModel, resolver } = await build({ resolved: soup, user: {} });
      const r = await service.addDish(USER_ID, { name: "  Chicken soup  ", usualPerMonth: 4 }, "onboarding");

      expect(r.status).toBe("added");
      const $set = (dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set;
      expect($set).toMatchObject({
        name: "Chicken soup",
        source: "onboarding",
        status: "active",
        slots: ["lunch", "dinner"],
        "usual.nutritionConfidence": "estimated",
        "rhythm.usualPerMonth": 4,
        "rhythm.leftoversFriendly": true,
      });
      expect(resolver.resolve).toHaveBeenCalled();
    });

    it("reuses another user's resolution of the same dish instead of calling the model", async () => {
      const { service, dishModel, resolver } = await build({ user: {} });
      const elsewhere = {
        usual: {
          ingredients: [{ name: "chicken", amount: "200 g" }, { name: "carrot", amount: "80 g" }],
          nutritionPerServing: { calories: 420, protein: 38, carbs: 20, fat: 18 },
          prepMinutes: 40,
          nutritionConfidence: "estimated",
        },
        slots: ["lunch", "dinner"],
        rhythm: { leftoversFriendly: true },
      };
      dishModel.findOne
        .mockImplementationOnce(() => chain(null)) // not in this user's list yet
        .mockImplementationOnce(() => chain(elsewhere)); // someone else has it
      await service.addDish(USER_ID, { name: "Chicken soup" });

      expect(resolver.resolve).not.toHaveBeenCalled();
      const $set = (dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set;
      expect($set["usual.nutritionPerServing"]).toEqual(elsewhere.usual.nutritionPerServing);
      expect($set.status).toBe("active");
    });

    it("checks a shared dish against this user's own restrictions", async () => {
      const { service, dishModel } = await build({ user: { dietaryRestrictions: ["vegetarian"] } });
      dishModel.findOne
        .mockImplementationOnce(() => chain(null))
        .mockImplementationOnce(() =>
          chain({
            usual: {
              ingredients: [{ name: "chicken", amount: "200 g" }, { name: "carrot", amount: "80 g" }],
              nutritionPerServing: { calories: 420, protein: 38, carbs: 20, fat: 18 },
              nutritionConfidence: "estimated",
            },
          }),
        );
      await service.addDish(USER_ID, { name: "Chicken soup" });
      const $set = (dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set;
      // Fine for whoever resolved it; not for a vegetarian.
      expect($set.status).toBe("paused");
    });

    it("keeps a dish it could not work out, but never plans it", async () => {
      const { service, dishModel } = await build({ resolved: null, user: {} });
      const r = await service.addDish(USER_ID, { name: "grandma's stew" });

      expect(r.status).toBe("added");
      expect(r.note).toMatch(/could not work out/);
      expect((dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set.status).toBe("paused");
    });

    it("pauses a dish that breaks the user's own restrictions, and says why", async () => {
      const { service, dishModel } = await build({
        resolved: { ...soup, violations: ["chicken"] },
        user: { dietaryRestrictions: ["vegan"] },
      });
      const r = await service.addDish(USER_ID, { name: "Chicken soup" });

      expect(r.note).toMatch(/paused: contains chicken/);
      expect((dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set.status).toBe("paused");
    });

    it("does not add the same dish twice", async () => {
      const { service, dishModel, resolver } = await build({
        dish: { _id: "d1", name: "Chicken Soup", status: "active" },
        resolved: soup,
      });
      dishModel.findOne = jest.fn(() => chain({ _id: "d1", name: "Chicken Soup", status: "active" }));
      const r = await service.addDish(USER_ID, { name: "chicken soups" });

      expect(r.status).toBe("already-known");
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it("rejects something that is not a name", async () => {
      const { service } = await build({});
      expect((await service.addDish(USER_ID, { name: "   " })).status).toBe("rejected");
    });

    it("takes the whole onboarding screen in one call, and survives one bad dish", async () => {
      const { service, resolver } = await build({ resolved: soup, user: {} });
      resolver.resolve
        .mockImplementationOnce(async () => soup)
        .mockImplementationOnce(async () => { throw new Error("model down"); })
        .mockImplementationOnce(async () => soup);

      const results = await service.addDishes(USER_ID, [
        { name: "Chicken soup" }, { name: "Shakshuka" }, { name: "Pasta bolognese" },
      ]);
      expect(results).toHaveLength(3);
      expect(results.filter((r) => r.status === "added").length).toBeGreaterThanOrEqual(2);
    });

    it("hands the planner only active dishes, least recently cooked first", async () => {
      const { service, dishModel } = await build({
        dishes: [{ name: "Chicken soup" }, { name: "Shakshuka" }],
      });
      expect(await service.plannableDishNames(USER_ID)).toEqual(["Chicken soup", "Shakshuka"]);
      expect((dishModel.find.mock.calls[0] as any[])[0]).toMatchObject({ status: "active" });
    });

    it("hands the planner the better versions too", async () => {
      // Left out of the projection, every dish is planned exactly as it is and
      // the tuning never reaches anyone — silently, because a dish without
      // tunes is a legitimate state.
      const selects: string[] = [];
      const { service, dishModel } = await build({ dishes: [] });
      dishModel.find = jest.fn(() => {
        const c: any = {
          select: (fields: string) => {
            selects.push(fields);
            return c;
          },
          sort: () => c,
          limit: () => c,
          lean: () => c,
          exec: async () => [],
        };
        return c;
      });

      await service.plannableDishes(USER_ID);
      expect(selects[0]).toContain("tunes");
      expect(selects[0]).toContain("tuneCeiling");
    });
  });

  describe("favourites and my meals are one list", () => {
    const planMeal = {
      _id: "meal-1",
      name: "Coconut Curry Chicken Bake",
      category: "dinner",
      calories: 660,
      macros: { protein: 42, carbs: 55, fat: 28 },
      ingredients: [["chicken thigh", "150 g"], ["coconut milk", "100 ml"]],
      prepTime: 35,
    };

    it("files a hearted meal under the user's own meals, with what the plan knows", async () => {
      const { service, dishModel, resolver } = await build({});
      await service.setFavourite(USER_ID, planMeal, true);

      const [, update] = dishModel.findOneAndUpdate.mock.calls[0] as any[];
      expect(update.$setOnInsert.source).toBe("favourite");
      expect(update.$set).toMatchObject({
        name: "Coconut Curry Chicken Bake",
        favourite: true,
        status: "active",
        slots: ["dinner"],
        mealId: "meal-1",
        "usual.nutritionPerServing": { calories: 660, protein: 42, carbs: 55, fat: 28 },
        "usual.nutritionConfidence": "user-confirmed",
        "usual.prepMinutes": 35,
      });
      expect(update.$set["usual.ingredients"]).toEqual([
        { name: "chicken thigh", amount: "150 g" },
        { name: "coconut milk", amount: "100 ml" },
      ]);
      // No model call needed: the plan already holds the recipe.
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it("does not overwrite a better record the user already gave us", async () => {
      const { service, dishModel } = await build({
        dish: {
          _id: "d1",
          source: "onboarding",
          usual: {
            ingredients: [{ name: "their own", amount: "1" }],
            nutritionPerServing: { calories: 500, protein: 30, carbs: 50, fat: 15 },
            prepMinutes: 20,
          },
        },
      });
      await service.setFavourite(USER_ID, planMeal, true);

      const $set = (dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set;
      expect($set).not.toHaveProperty("usual.ingredients");
      expect($set).not.toHaveProperty("usual.nutritionPerServing");
      expect($set.favourite).toBe(true);
    });

    it("retires a dish that was only there because it was hearted", async () => {
      const { service, dishModel } = await build({
        dish: { _id: "d1", source: "favourite", status: "active" },
      });
      await service.setFavourite(USER_ID, planMeal, false);

      const $set = (dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set;
      expect($set).toEqual({ favourite: false, status: "retired" });
    });

    it("keeps a dish they actually cook when the heart comes off", async () => {
      const { service, dishModel } = await build({
        dish: { _id: "d1", source: "onboarding", status: "active" },
      });
      await service.setFavourite(USER_ID, planMeal, false);

      const $set = (dishModel.findOneAndUpdate.mock.calls[0] as any[])[1].$set;
      expect($set).toEqual({ favourite: false, status: "active" });
    });

    it("ignores a meal with no name", async () => {
      const { service, dishModel } = await build({});
      expect(await service.setFavourite(USER_ID, { name: "  " }, true)).toBeNull();
      expect(dishModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
