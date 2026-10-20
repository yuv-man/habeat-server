import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { EnrollmentService, dishMatches } from "../../../src/challenge-program/enrollment.service";
import { resolveToday } from "../../../src/challenge-program/challenge-program.controller";
import * as registry from "../../../src/challenge-program/program.registry";
import { FOOD_A_LITTLE_BETTER_V1 } from "../../../src/challenge-program/content/food-a-little-better.v1";
import { addDays } from "../../../src/challenge-program/enrollment.rules";

/** Just enough of a Mongoose model for the service: create, findOne, find. */
function fakeEnrollmentModel() {
  const docs: any[] = [];
  let seq = 0;
  const matches = (doc: any, q: any) =>
    Object.entries(q).every(([k, v]: [string, any]) => {
      const actual = k === "_id" ? String(doc._id) : doc[k];
      if (v && typeof v === "object" && "$in" in v) return v.$in.includes(actual);
      return actual === v;
    });
  const wrap = (data: any) => {
    const doc: any = {
      ...JSON.parse(JSON.stringify({ ...data, startedAt: undefined, lastActivityAt: undefined })),
      startedAt: data.startedAt,
      lastActivityAt: data.lastActivityAt,
      _id: (++seq).toString(16).padStart(24, "0"),
      markModified: jest.fn(),
      save: jest.fn(async () => doc),
    };
    return doc;
  };
  const query = (result: any) => {
    const p: any = Promise.resolve(result);
    p.sort = () => query(result);
    p.limit = () => query(result);
    return p;
  };
  return {
    docs,
    create: jest.fn(async (data: any) => {
      const live = docs.find((d) => d.userId === data.userId && ["active", "paused"].includes(d.status));
      if (live && ["active", "paused"].includes(data.status)) throw Object.assign(new Error("dup"), { code: 11000 });
      const doc = wrap(data);
      docs.push(doc);
      return doc;
    }),
    findOne: jest.fn((q: any) => query(docs.filter((d) => matches(d, q)).pop() ?? null)),
    find: jest.fn((q: any) => query(docs.filter((d) => matches(d, q)))),
  };
}

const TODAY = "2026-10-15";
const USER = "user-1";

describe("EnrollmentService", () => {
  let model: ReturnType<typeof fakeEnrollmentModel>;
  let userModel: any;
  let engagement: { awardBadge: jest.Mock };
  let analytics: { capture: jest.Mock };
  let service: EnrollmentService;

  beforeEach(() => {
    model = fakeEnrollmentModel();
    userModel = {
      findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ subscriptionTier: "free" }) }) })),
    };
    engagement = { awardBadge: jest.fn(async (_u, id) => ({ id })) };
    analytics = { capture: jest.fn() };
    service = new EnrollmentService(model as any, userModel, engagement as any, analytics as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it("lists programs without lesson content and previews days 1–3 only", () => {
    expect(service.listPrograms()[0]).not.toHaveProperty("days");
    const preview = service.getPreview("food-a-little-better");
    expect(preview.previewDays.map((d) => d.day)).toEqual([1, 2, 3]);
    expect(preview.afterwards?.independent.title).toBe("Keep practicing on your own");
    expect(() => service.getPreview("nope")).toThrow(NotFoundException);
  });

  it("enrolls and returns today's resolved day", async () => {
    const view = await service.enroll(USER, "food-a-little-better", TODAY);
    expect(view.currentDay).toBe(1);
    expect(view.today.open).toBe(true);
    expect(view.today.content?.lesson.title).toBe("You keep your food");
    expect(analytics.capture).toHaveBeenCalledWith(
      USER,
      "challenge_enrolled",
      expect.objectContaining({ program_id: "food-a-little-better", program_version: 2 }),
    );
    expect(view.program.durationDays).toBe(84);
    expect(view.today.content?.focus).toBe("Start from the meals you already eat");
    expect(view.stage).toMatchObject({ id: "routine", title: "Understand your routine" });
  });

  it("saves a draft on 'started' so the activity can resume, without touching answers", async () => {
    const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
    const draft = { answer: ["Pasta"], step: 2 };
    const started = await service.recordAction(USER, id, 1, { status: "started", answer: draft }, TODAY);
    expect(started.today.state).toMatchObject({ actionStatus: "started", draft });
    expect(started.answers).toEqual({});
    expect(started.result.advanced).toBe(false);

    const done = await service.recordAction(USER, id, 1, { status: "done", answer: ["Pasta"] }, TODAY);
    expect(done.answers).toEqual({ everydayMeals: ["Pasta"] });
    expect(model.docs[0].days[0].draft).toBeUndefined();
  });

  it("accepts an observation answer field by field, every field optional", async () => {
    const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
    const doc = model.docs[0];
    doc.currentDay = 8;
    await expect(
      service.recordAction(USER, id, 8, { status: "done", answer: { situation: ["nope"] } }, TODAY),
    ).rejects.toMatchObject({ status: 400 });
    const view = await service.recordAction(
      USER,
      id,
      8,
      { status: "done", answer: { situation: "Packing lunches", ease: ["hard"] } },
      TODAY,
    );
    expect(view.answers.situation1).toEqual({ situation: "Packing lunches", ease: ["hard"] });
  });

  it("saves answers to a day's optional questions and rejects ones that don't fit", async () => {
    const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
    model.docs[0].currentDay = 3; // day 3: check-in with optional before/after questions
    await expect(
      service.recordAction(USER, id, 3, { status: "done", extras: { 0: "starving" } }, TODAY),
    ).rejects.toMatchObject({ status: 400 });
    await service.recordAction(USER, id, 3, { status: "done", extras: { 0: "hungry", 1: "satisfied" } }, TODAY);
    expect(model.docs[0].days.find((d: any) => d.day === 3).extras).toEqual({ 0: "hungry", 1: "satisfied" });
  });

  it("returns a reached day with its answer for review, and hides days ahead", async () => {
    const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
    await service.recordAction(USER, id, 1, { status: "done", answer: ["Pasta"] }, TODAY);
    const day1 = await service.getDay(USER, id, 1);
    expect(day1).toMatchObject({ day: 1, state: { actionStatus: "done", answer: ["Pasta"] } });
    expect(day1.content).not.toHaveProperty("aiGuidance", expect.anything());
    await expect(service.getDay(USER, id, 3)).rejects.toThrow(NotFoundException);
    await expect(service.getDay("someone-else", id, 1)).rejects.toThrow(NotFoundException);
  });

  it("waits on a day that isn't written yet instead of failing", async () => {
    const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
    model.docs[0].currentDay = 15;
    const view = await service.getActive(USER, TODAY);
    expect(view?.today).toMatchObject({ day: 15, open: true, comingSoon: true, content: undefined });
    await expect(service.recordAction(USER, id, 15, { status: "skipped" }, TODAY)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("offers the paths after the journey, leaving out programs that don't exist yet", async () => {
    await service.enroll(USER, "food-a-little-better", TODAY);
    Object.assign(model.docs[0], { status: "completed", currentDay: 84 });
    const done = await service.getActive(USER, TODAY);
    expect(done).toBeNull(); // completed journeys aren't live
    const view = (service as any).toView(model.docs[0], registry.getProgram("food-a-little-better"), TODAY);
    expect(view.afterwards).toEqual({
      maintenance: undefined,
      next: [],
      independent: expect.objectContaining({ title: "Keep practicing on your own" }),
    });
  });

  it("includes the authored tips for the current day", async () => {
    const { id, today } = await service.enroll(USER, "food-a-little-better", TODAY);
    expect(today.tips).toEqual([]);
    await service.recordAction(USER, id, 1, { status: "done", answer: ["Pasta"] }, TODAY);
    const view = await service.getActive(USER, addDays(TODAY, 1));
    expect(view?.today.tips.map((t) => t.id)).toEqual(["rhythm-not-schedule"]);
    expect(view?.today.tips[0]).not.toHaveProperty("when");
  });

  it("allows one live journey at a time", async () => {
    await service.enroll(USER, "food-a-little-better", TODAY);
    await expect(service.enroll(USER, "food-a-little-better", TODAY)).rejects.toThrow(ConflictException);
    // Another user is unaffected.
    await expect(service.enroll("user-2", "food-a-little-better", TODAY)).resolves.toBeDefined();
  });

  it("refuses a paid program without a paying subscription", async () => {
    jest
      .spyOn(registry, "getProgram")
      .mockReturnValue({ ...FOOD_A_LITTLE_BETTER_V1, access: "plus" });
    await expect(service.enroll(USER, "food-a-little-better", TODAY)).rejects.toThrow(ForbiddenException);

    userModel.findById.mockReturnValue({
      select: () => ({ lean: async () => ({ subscriptionTier: "plus", subscriptionStatus: "active" }) }),
    });
    await expect(service.enroll(USER, "food-a-little-better", TODAY)).resolves.toBeDefined();
  });

  it("never lets one user touch another user's enrollment", async () => {
    const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
    await expect(service.recordAction("intruder", id, 1, { status: "skipped" }, TODAY)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.leave("intruder", id)).rejects.toThrow(NotFoundException);
    await expect(service.recordAction(USER, "not-an-id", 1, { status: "skipped" }, TODAY)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("maps rule errors to 409 (locked) and 400 (bad answer)", async () => {
    const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
    await expect(service.recordAction(USER, id, 1, { status: "done", answer: [] }, TODAY)).rejects.toMatchObject({
      status: 400,
    });
    await service.recordAction(USER, id, 1, { status: "done", answer: ["Pasta"] }, TODAY);
    await expect(service.recordAction(USER, id, 2, { status: "skipped" }, TODAY)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("awards the milestone badge when Week 1 ends", async () => {
    const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
    let today = TODAY;
    let last: any;
    for (let day = 1; day <= 7; day++) {
      last = await service.recordAction(USER, id, day, { status: "skipped" }, today);
      today = addDays(today, 1);
    }
    expect(engagement.awardBadge).toHaveBeenCalledWith(USER, "journey_noticed");
    expect(last.result.milestonesReached).toEqual([{ id: "first_week", title: "First week" }]);
  });

  it("pause stops progress; resume opens the day straight away", async () => {
    const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
    await service.recordAction(USER, id, 1, { status: "skipped" }, TODAY);
    await service.pause(USER, id, TODAY);
    await expect(service.recordAction(USER, id, 2, { status: "skipped" }, addDays(TODAY, 1))).rejects.toMatchObject({
      status: 409,
    });
    const resumed = await service.resume(USER, id, TODAY);
    expect(resumed.status).toBe("active");
    expect(resumed.today.open).toBe(true);
  });

  it("leaving keeps the data and frees the user to start again, optionally continuing", async () => {
    const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
    await service.recordAction(USER, id, 1, { status: "done", answer: ["Shakshuka"] }, TODAY);
    await service.leave(USER, id);
    expect(model.docs[0].status).toBe("left");

    const again = await service.enroll(USER, "food-a-little-better", TODAY, { continueFromLeft: true });
    expect(again.currentDay).toBe(2);
    expect(again.answers).toEqual({ everydayMeals: ["Shakshuka"] });
    const history = await service.getHistory(USER);
    expect(history.map((h) => h.status)).toEqual(["left"]);
  });

  describe("onMealEvent", () => {
    async function enrolledOnDay(day: number, answers: Record<string, unknown> = {}) {
      const { id } = await service.enroll(USER, "food-a-little-better", TODAY);
      const doc = model.docs.find((d) => d._id === id);
      // The meal-logged days are in v1's weeks 3–4; v2 hasn't written them yet.
      doc.programVersion = 1;
      doc.currentDay = day;
      doc.answers = answers;
      return doc;
    }

    it("completes the 'cook your upgrade' day when the upgraded dish is logged", async () => {
      const doc = await enrolledOnDay(18, { upgradeDish: ["Lentil soup"] });
      await service.onMealEvent(USER, { source: "meal_log", mealName: "Pasta" }, TODAY);
      expect(doc.currentDay).toBe(18);
      await service.onMealEvent(USER, { source: "meal_log", mealName: "Lentil soup with spinach" }, TODAY);
      expect(doc.currentDay).toBe(19);
      expect(doc.days.find((d: any) => d.day === 18)).toMatchObject({ actionStatus: "done", source: "meal_log" });
    });

    it("completes the swap day on a swap, not on a meal tick", async () => {
      const doc = await enrolledOnDay(20);
      await service.onMealEvent(USER, { source: "meal_log", mealName: "Toast" }, TODAY);
      expect(doc.currentDay).toBe(20);
      await service.onMealEvent(USER, { source: "swap", mealName: "Toast" }, TODAY);
      expect(doc.currentDay).toBe(21);
    });

    it("ignores meal events on other days and never throws", async () => {
      const doc = await enrolledOnDay(5);
      await service.onMealEvent(USER, { source: "swap", mealName: "Toast" }, TODAY);
      expect(doc.currentDay).toBe(5);
      model.findOne.mockImplementationOnce(() => {
        throw new Error("db down");
      });
      await expect(service.onMealEvent(USER, { source: "swap" }, TODAY)).resolves.toBeUndefined();
    });
  });
});

describe("dishMatches", () => {
  it("matches either way round, ignoring case and punctuation", () => {
    expect(dishMatches(["Lentil soup"], "lentil soup, mum's")).toBe(true);
    expect(dishMatches("Chicken and rice bowl", "Chicken and rice")).toBe(true);
    expect(dishMatches(["Lentil soup"], "Pasta")).toBe(false);
    expect(dishMatches(undefined, "Anything")).toBe(true);
    expect(dishMatches(["Soup"], undefined)).toBe(false);
  });
});

describe("resolveToday", () => {
  const now = new Date(2026, 9, 15, 12);
  it("trusts the client's date within a day of the server's", () => {
    expect(resolveToday("2026-10-16", now)).toBe("2026-10-16");
    expect(resolveToday("2026-10-14", now)).toBe("2026-10-14");
  });
  it("falls back to the server's date for missing, bad or far-off dates", () => {
    expect(resolveToday(undefined, now)).toBe("2026-10-15");
    expect(resolveToday("2026-12-01", now)).toBe("2026-10-15");
    expect(resolveToday("garbage", now)).toBe("2026-10-15");
  });
});
