import { BehaviorStage } from "../../brain/behavior/behavior.types";

/**
 * A guided challenge, defined in code and versioned (design spec §3.1).
 *
 * Enrollments pin `id` + `version`, so editing a program means adding a new
 * version file — a journey already in progress keeps the copy it started with.
 */
export interface ChallengeProgram {
  id: string;
  version: number;
  title: string;
  tagline: string;
  description: string;
  audience: string;
  learningOutcomes: string[];
  /**
   * Activity days, not calendar days. `days` may stop short of this while a
   * long program is still being written: a user who reaches an unwritten day
   * waits on it (see `writtenThrough` in enrollment.rules) instead of erroring.
   */
  durationDays: number;
  dailyMinutes: { min: number; max: number };
  access: "free" | "plus" | "premium";
  stages: ProgramStage[];
  days: ChallengeDay[];
  milestones: ProgramMilestone[];
  /** Core days done or partly done that make the run "completed" rather than "finished" (D5). */
  completion: { minCoreDaysDone: number };
  guides: GuideTip[];
  /** Program offered as the next chapter on the last day (D7b). */
  nextChapter?: string;
  /** What the user can choose once the core program ends. */
  afterwards?: ProgramAfterwards;
}

/**
 * The paths offered at the end of a program. The journey never just stops:
 * the user keeps what they built (answers, experiments, toolkit) whichever
 * path they take.
 */
export interface ProgramAfterwards {
  /** A light, open-ended program that keeps the practice going (weekly check-ins). */
  maintenanceProgramId?: string;
  /** Programs offered as a new focus, in display order. */
  nextProgramIds: string[];
  /** Copy for "keep practicing on my own": no program, the toolkit stays on Today. */
  independent: { title: string; body: string };
}

export interface ProgramStage {
  id: string;
  title: string;
  /** One line on what this stage is for, shown on the Progress timeline. */
  purpose?: string;
  brainStage: BehaviorStage;
  /** Inclusive day range. */
  days: [number, number];
}

export interface ProgramMilestone {
  id: string;
  afterDay: number;
  title: string;
  badgeId?: string;
}

export type ChallengeActionKind =
  | "check"
  | "choice"
  | "meal_pick"
  | "meal_logged"
  | "plan"
  | "reflection"
  | "observation";

/**
 * One question inside an `observation`: situation, thought, feeling, action.
 * Each is asked on its own screen; every field is optional to answer.
 */
export interface ObservationField {
  key: string;
  prompt: string;
  options: { id: string; label: string }[];
  multi?: boolean;
  /** Offer a short free-text answer next to the options. */
  allowText?: boolean;
}

export interface ChallengeAction {
  kind: ChallengeActionKind;
  prompt: string;
  options?: { id: string; label: string }[];
  multi?: boolean;
  /** Where the answer is saved, so later days can reuse it. */
  answerKey?: string;
  /** Earlier answers this day's copy draws on. */
  usesAnswer?: string[];
  /** Outcomes the user may report alongside the action. */
  outcomes?: ActionOutcome[];
  /** observation only: the questions, asked one at a time. */
  fields?: ObservationField[];
  /** meal_logged only: which meal events complete the day on their own. */
  autoComplete?: { source: "meal_log" | "swap"; matchAnswer?: string };
}

export type ActionOutcome =
  | "liked"
  | "okay"
  | "not_for_me"
  | "easier"
  | "same"
  | "harder"
  | "kept_going"
  | "about_same";

export interface ChallengeDay {
  day: number;
  stageId: string;
  /** Authoring note on what the day is for. Not shown to users. */
  objective: string;
  /** "Today's focus", in the user's words. Falls back to the lesson title. */
  focus?: string;
  /** Estimated minutes for the whole activity. Falls back to the program's daily minimum. */
  minutes?: number;
  lesson: { title: string; body: string; readMinutes: number };
  action: ChallengeAction;
  optional?: ChallengeAction[];
  foodHelp?: { assistantSeed?: string; link?: string };
  reflectionPrompt?: string;
  communityPrompt?: string;
  next: string;
  /** What the assistant should know about today. */
  aiGuidance: string;
}

/** An authored tip (design spec §3.5). Process guides are generated, not authored. */
export interface GuideTip {
  id: string;
  days: [number, number];
  /** answerKey → accepted values. All entries must match. */
  when?: Record<string, string[]>;
  title: string;
  body: string;
}
