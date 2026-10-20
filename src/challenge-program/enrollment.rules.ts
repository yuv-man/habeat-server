import {
  ChallengeAction,
  ChallengeDay,
  ChallengeProgram,
  GuideTip,
  ProgramMilestone,
} from "./content/program.types";

/**
 * Progression rules for a challenge enrollment (design spec §3.3), kept pure
 * so they can be tested without a database. The service loads, calls these,
 * and saves.
 *
 * - Activity days, not calendar days: "Day 12" is the 12th activity.
 * - Resolving a day (done / partly / skipped) unlocks the next one tomorrow,
 *   so at most one new day opens per local calendar day. After a gap the next
 *   day is simply waiting — nothing resets.
 * - "Not today" (skipped) is a valid answer and still moves the journey on.
 * - "started" saves a draft so the user can leave mid-activity and resume.
 *   Drafts never touch `answers`; only a resolved day does.
 */

export type ActionStatus = "not_started" | "started" | "done" | "partly" | "skipped";
export type EnrollmentStatus = "active" | "paused" | "completed" | "left";

export interface EnrollmentDayState {
  day: number;
  lessonOpenedAt?: Date;
  lessonReadAt?: Date;
  actionStatus: ActionStatus;
  actionAt?: Date;
  answer?: unknown;
  /** Unfinished answers and where the user was, saved by "started". */
  draft?: unknown;
  /** Answers to the day's optional questions, keyed by their index. */
  extras?: Record<string, unknown>;
  note?: string;
  outcome?: string;
  source?: "manual" | "meal_log" | "swap";
}

export interface EnrollmentState {
  status: EnrollmentStatus;
  currentDay: number;
  /** dateKey (YYYY-MM-DD, user-local) when `currentDay` becomes available. */
  dayUnlockedOn: string;
  lastActivityAt: Date;
  days: EnrollmentDayState[];
  answers: Record<string, unknown>;
  milestones: { id: string; reachedAt: Date }[];
  completedAt?: Date;
}

/** Days away after which Today greets the user with "Welcome back". */
export const WELCOME_BACK_AFTER_DAYS = 3;

const RESOLVED: ActionStatus[] = ["done", "partly", "skipped"];
const COUNTS_AS_DONE: ActionStatus[] = ["done", "partly"];

// ── Dates ───────────────────────────────────────────────────────────────────

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

// ── Enrollment lifecycle ────────────────────────────────────────────────────

export function newEnrollmentState(program: ChallengeProgram, today: string, now: Date): EnrollmentState {
  return {
    status: "active",
    currentDay: 1,
    dayUnlockedOn: today,
    lastActivityAt: now,
    days: program.days.map((d) => ({ day: d.day, actionStatus: "not_started" })),
    answers: {},
    milestones: [],
  };
}

export function isCurrentDayOpen(state: EnrollmentState, today: string): boolean {
  return state.status === "active" && state.dayUnlockedOn <= today;
}

export function dayState(state: EnrollmentState, day: number): EnrollmentDayState {
  let entry = state.days.find((d) => d.day === day);
  if (!entry) {
    entry = { day, actionStatus: "not_started" };
    state.days.push(entry);
    state.days.sort((a, b) => a.day - b.day);
  }
  return entry;
}

export class EnrollmentRuleError extends Error {
  constructor(
    message: string,
    readonly code: "not_active" | "locked" | "not_reached" | "not_written" | "invalid_day" | "invalid_answer",
  ) {
    super(message);
  }
}

/**
 * A day the user may touch: any day already reached, or the current day once
 * it has unlocked. Earlier days stay editable (answers can be revised).
 */
function assertReachable(state: EnrollmentState, program: ChallengeProgram, day: number, today: string) {
  if (state.status !== "active") {
    throw new EnrollmentRuleError(`Enrollment is ${state.status}`, "not_active");
  }
  if (!Number.isInteger(day) || day < 1 || day > program.durationDays) {
    throw new EnrollmentRuleError(`Day ${day} is not part of this program`, "invalid_day");
  }
  if (day > state.currentDay) {
    throw new EnrollmentRuleError(`Day ${day} has not been reached yet`, "not_reached");
  }
  if (day === state.currentDay && !isCurrentDayOpen(state, today)) {
    throw new EnrollmentRuleError(`Day ${day} opens on ${state.dayUnlockedOn}`, "locked");
  }
  if (!program.days.some((d) => d.day === day)) {
    throw new EnrollmentRuleError(`Day ${day} isn't ready yet`, "not_written");
  }
}

/** The last day with content. Equal to `durationDays` once a program is fully written. */
export function writtenThrough(program: ChallengeProgram): number {
  return program.days.reduce((max, d) => Math.max(max, d.day), 0);
}

export function recordLesson(
  state: EnrollmentState,
  program: ChallengeProgram,
  day: number,
  event: "opened" | "read",
  today: string,
  now: Date,
): void {
  assertReachable(state, program, day, today);
  const entry = dayState(state, day);
  entry.lessonOpenedAt ??= now;
  if (event === "read") entry.lessonReadAt ??= now;
  state.lastActivityAt = now;
}

export interface ActionInput {
  status: Exclude<ActionStatus, "not_started">;
  answer?: unknown;
  extras?: unknown;
  note?: string;
  outcome?: string;
  source?: "manual" | "meal_log" | "swap";
}

export interface ActionResult {
  /** True when this call moved the journey to the next day. */
  advanced: boolean;
  milestonesReached: ProgramMilestone[];
  /** Set when this call resolved the final day. */
  finished?: { completed: boolean; coreDaysDone: number };
}

export function recordAction(
  state: EnrollmentState,
  program: ChallengeProgram,
  day: number,
  input: ActionInput,
  today: string,
  now: Date,
): ActionResult {
  assertReachable(state, program, day, today);
  const content = program.days.find((d) => d.day === day)!;

  if (input.status === "started") {
    if (input.answer !== undefined && !isSmallJson(input.answer)) {
      throw new EnrollmentRuleError("Draft is too large", "invalid_answer");
    }
  } else if (input.status !== "skipped") {
    const error = validateAnswer(content.action, input.answer);
    if (error) throw new EnrollmentRuleError(error, "invalid_answer");
  }
  if (input.outcome !== undefined && !(content.action.outcomes ?? []).includes(input.outcome as any)) {
    throw new EnrollmentRuleError(`Outcome "${input.outcome}" doesn't apply to day ${day}`, "invalid_answer");
  }
  const extras = input.status === "skipped" ? undefined : validateExtras(content, input.extras);
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 1000)) {
    throw new EnrollmentRuleError("Note must be text up to 1000 characters", "invalid_answer");
  }

  const entry = dayState(state, day);
  const wasResolved = RESOLVED.includes(entry.actionStatus);

  // "started" never downgrades a day that is already resolved.
  if (input.status === "started" && wasResolved) {
    return { advanced: false, milestonesReached: [] };
  }
  if (input.status === "started") {
    entry.actionStatus = "started";
    if (input.answer !== undefined) entry.draft = input.answer;
    state.lastActivityAt = now;
    return { advanced: false, milestonesReached: [] };
  }

  entry.actionStatus = input.status;
  entry.actionAt = now;
  entry.source = input.source ?? "manual";
  if (input.note !== undefined) entry.note = input.note;
  if (extras) entry.extras = extras;
  if (input.outcome !== undefined) entry.outcome = input.outcome;
  if (input.answer !== undefined && input.status !== "skipped") {
    entry.answer = input.answer;
    if (content.action.answerKey) state.answers[content.action.answerKey] = input.answer;
  }
  entry.draft = undefined;
  state.lastActivityAt = now;

  if (wasResolved || !RESOLVED.includes(input.status) || day !== state.currentDay) {
    return { advanced: false, milestonesReached: [] };
  }
  return advance(state, program, today, now);
}

function advance(state: EnrollmentState, program: ChallengeProgram, today: string, now: Date): ActionResult {
  const resolvedDay = state.currentDay;
  const milestonesReached = program.milestones.filter(
    (m) => m.afterDay === resolvedDay && !state.milestones.some((r) => r.id === m.id),
  );
  for (const m of milestonesReached) state.milestones.push({ id: m.id, reachedAt: now });

  if (resolvedDay >= program.durationDays) {
    const coreDaysDone = countCoreDaysDone(state);
    state.status = "completed";
    state.completedAt = now;
    return {
      advanced: true,
      milestonesReached,
      finished: { completed: coreDaysDone >= program.completion.minCoreDaysDone, coreDaysDone },
    };
  }

  state.currentDay = resolvedDay + 1;
  state.dayUnlockedOn = addDays(today, 1);
  return { advanced: true, milestonesReached };
}

export function countCoreDaysDone(state: EnrollmentState): number {
  return state.days.filter((d) => COUNTS_AS_DONE.includes(d.actionStatus)).length;
}

/** "completed" if enough core days were done or partly done, else "finished" (D5). */
export function completionLabel(state: EnrollmentState, program: ChallengeProgram): "completed" | "finished" {
  return countCoreDaysDone(state) >= program.completion.minCoreDaysDone ? "completed" : "finished";
}

export function shouldWelcomeBack(state: EnrollmentState, today: string, lastActiveKey: string): boolean {
  return state.status === "active" && daysBetween(lastActiveKey, today) >= WELCOME_BACK_AFTER_DAYS;
}

// ── Answers ─────────────────────────────────────────────────────────────────

const MAX_TEXT = 200;
const MAX_ITEMS = 6;
const MAX_JSON = 2000;

function isSmallJson(v: unknown): boolean {
  try {
    return JSON.stringify(v).length <= MAX_JSON;
  } catch {
    return false;
  }
}

function isShortText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= MAX_TEXT;
}

/** Returns an error message, or null when the answer fits the action. */
export function validateAnswer(action: ChallengeAction, answer: unknown): string | null {
  switch (action.kind) {
    case "check":
      return null;
    case "meal_logged":
      return answer === undefined || isShortText(answer) ? null : "Expected a dish name";
    case "meal_pick": {
      const items = Array.isArray(answer) ? answer : [answer];
      if (items.length < 1 || items.length > 5) return "Pick between 1 and 5 dishes";
      return items.every(isShortText) ? null : "Each dish must be a short name";
    }
    case "choice":
    case "reflection": {
      if (!action.options) return isShortText(answer) ? null : "Expected a short answer";
      if (answer === undefined && action.kind === "reflection") return null;
      const ids = Array.isArray(answer) ? answer : [answer];
      if (ids.length < 1 || ids.length > MAX_ITEMS) return "Pick at least one option";
      if (!action.multi && ids.length > 1) return "Pick one option";
      const valid = new Set(action.options.map((o) => o.id));
      return ids.every((id) => typeof id === "string" && valid.has(id)) ? null : "Unknown option";
    }
    case "plan": {
      // An option id, custom text, or a small structured plan ({ slot, time }, dish list…).
      if (isShortText(answer)) return null;
      if (answer && typeof answer === "object" && isSmallJson(answer)) return null;
      return "Expected a plan";
    }
    case "observation":
      return validateObservation(action, answer);
  }
}

/** `{ [index]: answer }` for the day's optional questions; each must fit its question. */
function validateExtras(content: ChallengeDay, extras: unknown): Record<string, unknown> | undefined {
  if (extras === undefined) return undefined;
  if (!extras || typeof extras !== "object" || Array.isArray(extras)) {
    throw new EnrollmentRuleError("Expected answers to optional questions", "invalid_answer");
  }
  const out: Record<string, unknown> = {};
  for (const [index, answer] of Object.entries(extras as Record<string, unknown>)) {
    const action = content.optional?.[Number(index)];
    if (!action) throw new EnrollmentRuleError(`No optional question ${index}`, "invalid_answer");
    if (answer === undefined || answer === null) continue;
    const error = validateAnswer(action, answer);
    if (error) throw new EnrollmentRuleError(error, "invalid_answer");
    out[index] = answer;
  }
  return out;
}

/**
 * `{ [field.key]: optionId[] | text }`. Every field is optional, so `{}` is a
 * valid answer: the user looked at the moment without labelling it.
 */
function validateObservation(action: ChallengeAction, answer: unknown): string | null {
  if (answer === undefined) return null;
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return "Expected an observation";
  const fields = new Map((action.fields ?? []).map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(answer as Record<string, unknown>)) {
    const field = fields.get(key);
    if (!field) return `Unknown question "${key}"`;
    if (typeof value === "string") {
      if (!field.allowText || !isShortText(value)) return "Expected a short answer";
      continue;
    }
    const ids = Array.isArray(value) ? value : [value];
    if (ids.length < 1 || ids.length > MAX_ITEMS) return "Pick at least one option";
    if (!field.multi && ids.length > 1) return "Pick one option";
    const valid = new Set(field.options.map((o) => o.id));
    if (!ids.every((id) => typeof id === "string" && valid.has(id))) return "Unknown option";
  }
  return null;
}

// ── Rendering ───────────────────────────────────────────────────────────────

/** Display text for a saved answer: option labels for chip answers, raw text otherwise. */
function answerText(program: ChallengeProgram, key: string, value: unknown, index?: number): string | undefined {
  const source = program.days.find((d) => d.action.answerKey === key)?.action;
  const label = (v: unknown): string | undefined => {
    if (typeof v === "string") return source?.options?.find((o) => o.id === v)?.label ?? v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return [o.label, o.name, o.text, o.dish].find((x): x is string => typeof x === "string");
    }
    return undefined;
  };
  if (Array.isArray(value)) {
    if (index !== undefined) return label(value[index]);
    const parts = value.map(label).filter((x): x is string => !!x);
    return parts.length ? parts.join(", ") : undefined;
  }
  return index === undefined || index === 0 ? label(value) : undefined;
}

const PLACEHOLDER = /\{\{\s*(\w+)(?:\.(\d+))?(?::(lower))?(?:\|([^}]*))?\s*\}\}/g;

export function renderTemplate(text: string, program: ChallengeProgram, answers: Record<string, unknown>): string {
  return text.replace(PLACEHOLDER, (_m, key: string, idx?: string, lower?: string, fallback?: string) => {
    const value = answerText(program, key, answers[key], idx === undefined ? undefined : Number(idx));
    const out = value ?? fallback ?? "";
    return lower ? out.toLowerCase() : out;
  });
}

function renderAction(action: ChallengeAction, program: ChallengeProgram, answers: Record<string, unknown>): ChallengeAction {
  return {
    ...action,
    prompt: renderTemplate(action.prompt, program, answers),
    options: action.options?.map((o) => ({ ...o, label: renderTemplate(o.label, program, answers) })),
    fields: action.fields?.map((f) => ({ ...f, prompt: renderTemplate(f.prompt, program, answers) })),
  };
}

/** A day's content with the user's earlier answers filled in. */
export function resolveDay(program: ChallengeProgram, day: number, answers: Record<string, unknown>): ChallengeDay | undefined {
  const content = program.days.find((d) => d.day === day);
  if (!content) return undefined;
  const r = (t: string) => renderTemplate(t, program, answers);
  return {
    ...content,
    focus: r(content.focus ?? content.lesson.title),
    minutes: content.minutes ?? program.dailyMinutes.min,
    lesson: { ...content.lesson, title: r(content.lesson.title), body: r(content.lesson.body) },
    action: renderAction(content.action, program, answers),
    optional: content.optional?.map((a) => renderAction(a, program, answers)),
    foodHelp: content.foodHelp && {
      ...content.foodHelp,
      assistantSeed: content.foodHelp.assistantSeed && r(content.foodHelp.assistantSeed),
    },
    aiGuidance: r(content.aiGuidance),
  };
}

export function stageForDay(program: ChallengeProgram, day: number) {
  return program.stages.find((s) => day >= s.days[0] && day <= s.days[1]);
}

/** Authored tips that apply to this day and these answers. */
export function tipsForDay(program: ChallengeProgram, day: number, answers: Record<string, unknown>): GuideTip[] {
  return program.guides.filter((g) => {
    if (day < g.days[0] || day > g.days[1]) return false;
    return Object.entries(g.when ?? {}).every(([key, accepted]) => {
      const v = answers[key];
      const values = Array.isArray(v) ? v : [v];
      return values.some((x) => typeof x === "string" && accepted.includes(x));
    });
  });
}
