/**
 * What the Brain actually does about a pattern.
 *
 * `mealStrategy` is the field that matters most: it is the sentence the meal
 * generator receives. Everything upstream — events, detection, staging —
 * exists to choose the right one of these, so each is written as an
 * instruction to the planner, not as advice to the user.
 */
export interface InterventionDefinition {
  id: string;
  patternId: string;
  name: string;
  description: string;
  stage: string;
  /** 0–1. Fed to the stage engine: a failed easy intervention means something
   *  different from a failed hard one. */
  difficulty: number;
  /** Handed to the meal generator verbatim. */
  mealStrategy: string;
  successMetric: string;
  /**
   * The same intervention, said to the person it is about.
   *
   * `mealStrategy` and `successMetric` are written at the planner — "Prioritize
   * satisfying, easy-to-prepare dinners" is an instruction to a model, and
   * showing it to a user reads like being handed someone else's memo. These
   * are the sentences the app says out loud, and they live here so the meaning
   * of an intervention is defined in exactly one place.
   */
  userFacing: {
    /** What the app is doing this week, in the second person. */
    whatWeAreDoing: string;
    /** How the user can tell it is working, without a percentage. */
    goingWellIf: string;
  };
}

export const INTERVENTIONS: InterventionDefinition[] = [
  // ── P01 · Irregular meals ─────────────────────────────────────────────────
  {
    id: "I01",
    patternId: "P01",
    name: "Notice your meal rhythm",
    description:
      "Help the user become aware of when meals happen without immediately trying to change them.",
    stage: "awareness",
    difficulty: 0.1,
    mealStrategy: "Keep familiar meals and improve visibility of meal timing.",
    successMetric: "User logs meals consistently.",
    userFacing: {
      whatWeAreDoing:
        "We're keeping your meals familiar this week. Nothing to change yet — just tick meals off as you go so the timings become visible.",
      goingWellIf: "You're logging most days, even the messy ones.",
    },
  },
  {
    id: "I02",
    patternId: "P01",
    name: "Create an easier meal anchor",
    description: "Introduce one predictable meal during the day.",
    stage: "preparation",
    difficulty: 0.3,
    mealStrategy:
      "Recommend simple, low-preparation meals around the chosen meal anchor.",
    successMetric: "Meal anchor completed on at least 4 days.",
    userFacing: {
      whatWeAreDoing:
        "We've built the week around one meal you can count on, kept simple and quick so it happens even on a bad day.",
      goingWellIf: "That one anchor meal happens on 4 or more days.",
    },
  },
  {
    id: "I03",
    patternId: "P01",
    name: "Build a flexible meal rhythm",
    description: "Gradually create a more predictable daily eating structure.",
    stage: "replacement",
    difficulty: 0.5,
    mealStrategy: "Generate balanced meals with flexible timing.",
    successMetric: "Reduced number of days with very few meals.",
    userFacing: {
      whatWeAreDoing:
        "Your meals are balanced and flexible on time — the aim is a rhythm that bends rather than one you have to keep up.",
      goingWellIf: "Fewer days go by with barely anything eaten.",
    },
  },

  // ── P02 · All-or-nothing days ─────────────────────────────────────────────
  {
    id: "I10",
    patternId: "P02",
    name: "Notice what happens after a miss",
    description:
      "Help the user see that a missed meal and a written-off day are two different things.",
    stage: "awareness",
    difficulty: 0.1,
    mealStrategy:
      "Leave the day's remaining meals unchanged and familiar after a missed meal. Never compensate with larger, stricter or 'making up for it' meals — that is what teaches the day to be all or nothing.",
    successMetric: "A meal is logged after a missed one on most slip days.",
    userFacing: {
      whatWeAreDoing:
        "Nothing in your plan changes yet. We're just watching what happens after a meal gets missed — one skipped meal doesn't have to take the rest of the day with it.",
      goingWellIf: "You still eat something after a meal you've missed.",
    },
  },
  {
    id: "I11",
    patternId: "P02",
    name: "Make the next meal the easy one",
    description:
      "Lower the effort of the meal that follows the slot the user most often misses.",
    stage: "preparation",
    difficulty: 0.3,
    mealStrategy:
      "Make the meal following the user's most-missed slot the lowest-effort meal of the day — shortest prep, fewest ingredients. Getting back on track must cost less than giving up on the day.",
    successMetric: "The meal after a missed one is completed on at least 4 slip days.",
    userFacing: {
      whatWeAreDoing:
        "The meal right after the one you most often miss is now the easiest of the day, so picking the day back up needs almost nothing from you.",
      goingWellIf: "A missed meal is usually followed by one you actually eat.",
    },
  },
  {
    id: "I12",
    patternId: "P02",
    name: "Build a restart meal",
    description:
      "Give the user one dependable, near-zero-effort meal that can replace any meal after a slip.",
    stage: "replacement",
    difficulty: 0.5,
    mealStrategy:
      "Include one very low-effort fallback meal that can stand in for any meal later in the day. It should need no shopping and under ten minutes, so a missed meal has an answer rather than an ending.",
    successMetric: "Fewer days are abandoned after the first missed meal.",
    userFacing: {
      whatWeAreDoing:
        "There's a simple fallback in your plan you can reach for after any missed meal — a restart rather than a write-off.",
      goingWellIf: "A slip stays a slip instead of becoming a whole day.",
    },
  },

  // ── P04 · Late-night eating ───────────────────────────────────────────────
  {
    id: "I04",
    patternId: "P04",
    name: "Understand the evening pattern",
    description: "Help the user notice what tends to happen before late eating.",
    stage: "awareness",
    difficulty: 0.1,
    mealStrategy:
      "Do not aggressively restrict evening food. Focus on satisfying planned dinners.",
    successMetric: "User records evening context consistently.",
    userFacing: {
      whatWeAreDoing:
        "We're not cutting anything out. Your dinners are built to be more filling, so the evening starts from a better place.",
      goingWellIf: "You notice what tends to happen before a late meal.",
    },
  },
  {
    id: "I05",
    patternId: "P04",
    name: "Make dinner easier",
    description: "Create a satisfying dinner plan before the evening gets busy.",
    stage: "preparation",
    difficulty: 0.3,
    mealStrategy: "Prioritize satisfying, easy-to-prepare dinners.",
    successMetric: "Planned dinner completed on at least 4 days.",
    userFacing: {
      whatWeAreDoing:
        "Dinner is planned to be satisfying and quick, ready before the evening gets away from you.",
      goingWellIf: "The planned dinner happens on 4 or more days.",
    },
  },
  {
    id: "I06",
    patternId: "P04",
    name: "Create an evening alternative",
    description:
      "Introduce a flexible alternative for situations where the user wants food later in the evening.",
    stage: "replacement",
    difficulty: 0.5,
    mealStrategy:
      "Include an optional evening snack or simple alternative rather than using restriction.",
    successMetric: "User reports improved control over evening eating.",
    userFacing: {
      whatWeAreDoing:
        "There's a proper evening option in the plan now, so wanting something later has an answer that isn't willpower.",
      goingWellIf: "Evenings feel more like your choice than a habit.",
    },
  },

  // ── P08 · Frequent takeaway ───────────────────────────────────────────────
  {
    id: "I07",
    patternId: "P08",
    name: "Prepare for busy evenings",
    description: "Identify when takeaway is most likely to happen.",
    stage: "awareness",
    difficulty: 0.1,
    mealStrategy: "Identify high-risk busy days and suggest easy meals.",
    successMetric: "User identifies common takeaway situations.",
    userFacing: {
      whatWeAreDoing:
        "We're looking for the days takeaway tends to win. Nothing is off the menu — we're just watching when it happens.",
      goingWellIf: "You can name the situations that usually lead to ordering.",
    },
  },
  {
    id: "I08",
    patternId: "P08",
    name: "Create emergency meals",
    description: "Give the user several very easy meal options for busy days.",
    stage: "preparation",
    difficulty: 0.3,
    mealStrategy: "Prioritize meals requiring minimal preparation.",
    successMetric: "Emergency meal used instead of takeaway at least twice.",
    userFacing: {
      whatWeAreDoing:
        "The plan now includes very easy meals for the days you have nothing left in the tank.",
      goingWellIf: "An easy meal replaces a takeaway at least twice.",
    },
  },
  {
    id: "I09",
    patternId: "P08",
    name: "Build a flexible backup system",
    description:
      "Create a reliable set of meals and leftovers that reduce decision fatigue.",
    stage: "replacement",
    difficulty: 0.5,
    mealStrategy: "Use leftovers, quick meals and flexible substitutions.",
    successMetric: "Reduced takeaway frequency compared with baseline.",
    userFacing: {
      whatWeAreDoing:
        "Leftovers and quick swaps are built into the week, so a busy evening doesn't need a decision.",
      goingWellIf: "You're ordering less than you were when we started.",
    },
  },
];

export const interventionById = (id: string): InterventionDefinition | undefined =>
  INTERVENTIONS.find((i) => i.id === id);

/**
 * The intervention for a pattern at a stage.
 *
 * The ladder has five rungs but each pattern currently carries three
 * interventions (awareness → preparation → replacement). Reinforcement and
 * maintenance have no material of their own yet, so they hold the last
 * defined intervention rather than falling back to nothing: a user who has
 * got as far as maintaining a change should not have the Brain go quiet on
 * them, which is exactly when the change unravels.
 */
export const interventionFor = (
  patternId: string,
  stage: string,
): InterventionDefinition | null => {
  const forPattern = INTERVENTIONS.filter((i) => i.patternId === patternId);
  if (forPattern.length === 0) return null;

  const exact = forPattern.find((i) => i.stage === stage);
  if (exact) return exact;

  return forPattern[forPattern.length - 1];
};
