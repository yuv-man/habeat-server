/**
 * Scenarios = one app-opening moment in the persona's life.
 *
 * Each one is a *reason to open Habeat*, not a test script. The agent is never
 * told which button to press — it is told what Sarah wants, how much time she
 * has, and what mood she is in. Whether she can achieve it is the finding.
 *
 * The week below is a full simulated week (day 1 = Monday). Every day has two
 * or three separate sessions so the app gets used the way a real person uses
 * it: little and often, with different intent each time.
 */

export type TimeOfDay = 'morning' | 'midday' | 'afternoon' | 'evening';

export interface Scenario {
  /** Stable slug persisted on the session document. */
  id: string;
  title: string;
  dayOfWeek: string;
  timeOfDay: TimeOfDay;
  /** Roughly how long she is willing to spend before giving up. */
  minutes: number;
  /** Emotional state she opens the app in. */
  mood: string;
  /** 0 = exhausted, 1 = fresh. Low energy means fewer actions, faster exit. */
  energy: number;
  /** What she is trying to achieve, in her own words. */
  goal: string;
  /** What "she got what she came for" means — used by the observation pass. */
  successCriteria: string[];
  /** App areas this session is expected to touch (for reporting/coverage). */
  focus: string[];
}

export const SCENARIOS: Record<string, Scenario> = {
  // ─── MONDAY — day 1: fresh start, most motivated ─────────────────────────
  firstVisit: {
    id: 'first-visit',
    title: 'First time opening Habeat',
    dayOfWeek: 'Monday',
    timeOfDay: 'morning',
    minutes: 10,
    mood: 'curious but sceptical — she has abandoned three health apps before',
    energy: 0.8,
    goal: `You just signed up for Habeat and this is the first time you are really looking at it.
You have about 10 minutes with your morning coffee. Find out what this app actually does for you
and whether it is worth keeping. Look around, open whatever seems interesting, and form an opinion.
If something asks you to set up your plan or profile, do it — but only if it is quick.`,
    successCriteria: [
      'She can explain in one sentence what Habeat is for',
      'She reached the main daily screen and understood what it shows',
      'She found at least one thing she wants to come back for',
    ],
    focus: ['landing', 'onboarding', 'daily tracker', 'navigation'],
  },

  generateFirstPlan: {
    id: 'generate-first-plan',
    title: 'Getting a meal plan for the first time',
    dayOfWeek: 'Monday',
    timeOfDay: 'morning',
    minutes: 8,
    mood: 'motivated, start-of-week energy',
    energy: 0.8,
    goal: `You do not have a meal plan yet and you want one before the week runs away from you.
Find how to get Habeat to give you meals for today and the coming days. If it asks about your
goals, restrictions or preferences, answer honestly as yourself. If generating takes a long time,
react the way you normally would when an app makes you wait.`,
    successCriteria: [
      'A plan exists and today\'s meals are visible',
      'She understood what the plan is based on',
      'Waiting time did not make her abandon',
    ],
    focus: ['plan generation', 'onboarding', 'daily tracker'],
  },

  logMondayDinner: {
    id: 'log-monday-dinner',
    title: 'Marking off what she actually ate',
    dayOfWeek: 'Monday',
    timeOfDay: 'evening',
    minutes: 4,
    mood: 'tired but pleased with herself for day one',
    energy: 0.5,
    goal: `It is around 21:00 and the day is done. You want to tell the app what you actually ate
today — you had the breakfast it suggested, skipped the afternoon snack, and had something close
to the suggested dinner. Mark off what you ate, and see what the app says back to you.`,
    successCriteria: [
      'She marked at least two meals as eaten',
      'She found a way to handle the meal she skipped',
      'The app acknowledged her progress in some way',
    ],
    focus: ['daily tracker', 'meal completion', 'streaks', 'engagement'],
  },

  // ─── TUESDAY — day 2: routine workday, speed matters ─────────────────────
  quickLunch: {
    id: 'quick-lunch',
    title: 'Deciding lunch between meetings',
    dayOfWeek: 'Tuesday',
    timeOfDay: 'midday',
    minutes: 3,
    mood: 'rushed — 15 minutes between calls',
    energy: 0.6,
    goal: `It is 13:05 and you have a gap between meetings. You want to know what you are supposed
to eat for lunch and whether you have what you need for it. You genuinely do not have time to
explore — get the answer and get out.`,
    successCriteria: [
      'She learned what today\'s lunch is within the first few actions',
      'She did not have to navigate more than twice to find it',
    ],
    focus: ['daily tracker', 'meal detail', 'speed to information'],
  },

  swapDislikedMeal: {
    id: 'swap-disliked-meal',
    title: 'The suggested meal is something she will not eat',
    dayOfWeek: 'Tuesday',
    timeOfDay: 'afternoon',
    minutes: 5,
    mood: 'mildly annoyed at the suggestion',
    energy: 0.6,
    goal: `You looked at tonight's suggested dinner and you do not want it — it is either something
you dislike or something you have no time to cook. Find a way to change it to something you would
actually eat. If the app cannot do that, say so.`,
    successCriteria: [
      'She found the swap/replace option without being told where it is',
      'The replacement was something she would genuinely eat',
      'The swap did not lose her place in the day',
    ],
    focus: ['meal swap', 'daily tracker', 'personalisation'],
  },

  waterAndSnack: {
    id: 'water-and-snack',
    title: 'Afternoon snack and water',
    dayOfWeek: 'Tuesday',
    timeOfDay: 'afternoon',
    minutes: 3,
    mood: 'peckish, half-focused, phone in one hand',
    energy: 0.5,
    goal: `It is 16:30, you just had a coffee and a handful of nuts that were not in the plan, and
you remember you have barely drunk any water today. Record the snack you actually ate and log your
water. Do not overthink it.`,
    successCriteria: [
      'She logged an unplanned snack without having to plan it first',
      'She found water tracking without hunting for it',
    ],
    focus: ['add snack', 'water tracking', 'daily tracker'],
  },

  // ─── WEDNESDAY — day 3: the mid-week dip, where apps get abandoned ───────
  stressfulDayMoodCheck: {
    id: 'stressful-day-mood-check',
    title: 'Bad day, stress eating',
    dayOfWeek: 'Wednesday',
    timeOfDay: 'evening',
    minutes: 6,
    mood: 'stressed and a bit down — a presentation went badly',
    energy: 0.35,
    goal: `Today was rough. You skipped lunch, then ate most of a bag of crisps at 18:00 while
answering emails. You feel a bit guilty. Open Habeat and see if it has anything useful to say about
that — you have heard it does something with moods and eating patterns. If it makes you feel judged,
react honestly.`,
    successCriteria: [
      'She found the mood or emotional-eating feature',
      'Logging how she felt took under a minute',
      'The app response felt supportive rather than judgemental',
    ],
    focus: ['mindfulness', 'mood check-in', 'emotional eating', 'tone'],
  },

  missedMealsCatchUp: {
    id: 'missed-meals-catch-up',
    title: 'Two days behind on tracking',
    dayOfWeek: 'Wednesday',
    timeOfDay: 'evening',
    minutes: 5,
    mood: 'behind and slightly deflated',
    energy: 0.4,
    goal: `You have not marked anything for a day and a half. You want to catch up without spending
ten minutes on it — or decide that catching up is not worth it and just carry on from today. See how
the app handles you being behind.`,
    successCriteria: [
      'She could see what she missed without feeling nagged',
      'Catching up (or skipping it) took under two minutes',
      'She did not abandon the app over the backlog',
    ],
    focus: ['missed meals', 'daily tracker', 'past days', 'tone'],
  },

  // ─── THURSDAY — day 4: is this actually working? ─────────────────────────
  checkProgress: {
    id: 'check-progress',
    title: 'Looking for evidence it is working',
    dayOfWeek: 'Thursday',
    timeOfDay: 'evening',
    minutes: 7,
    mood: 'curious, wants a reason to keep going',
    energy: 0.6,
    goal: `You have been using Habeat for a few days. You want to see whether you are actually doing
better — a streak, a score, a chart, anything. Find whatever the app can show you about how the week
has gone and decide whether it makes you want to continue.`,
    successCriteria: [
      'She found progress/analytics without help',
      'She understood at least one number she was shown',
      'She left with a reason to come back tomorrow',
    ],
    focus: ['progress', 'analytics', 'streaks', 'healthy coins', 'engagement'],
  },

  exploreChallenges: {
    id: 'explore-challenges',
    title: 'Poking at the rewards and challenges',
    dayOfWeek: 'Thursday',
    timeOfDay: 'evening',
    minutes: 5,
    mood: 'relaxed, mildly playful',
    energy: 0.55,
    goal: `You noticed the app has coins or challenges of some kind. You are half-curious and half
suspicious that it is a gimmick. Look into it, work out what you get out of it, and claim anything
you have already earned.`,
    successCriteria: [
      'She understood what the coins/challenges are for',
      'She claimed or completed something',
      'It did not feel like a pointless gimmick',
    ],
    focus: ['challenges', 'healthy coins', 'engagement', 'gamification'],
  },

  // ─── FRIDAY — day 5: real life gets in the way ───────────────────────────
  eatingOutTonight: {
    id: 'eating-out-tonight',
    title: 'Dinner out with friends',
    dayOfWeek: 'Friday',
    timeOfDay: 'afternoon',
    minutes: 4,
    mood: 'light, looking forward to the evening',
    energy: 0.7,
    goal: `You are going out for dinner tonight, so the planned dinner is not happening. You want to
tell the app that, or at least not have it count against you. Do whatever feels natural — change it,
skip it, or log what you will actually eat.`,
    successCriteria: [
      'She could opt out of a planned meal without it feeling like a failure',
      'The app did not punish or nag her for eating out',
    ],
    focus: ['meal skip', 'flexibility', 'daily tracker', 'tone'],
  },

  favouriteAMeal: {
    id: 'favourite-a-meal',
    title: 'Saving the meals she liked this week',
    dayOfWeek: 'Friday',
    timeOfDay: 'evening',
    minutes: 5,
    mood: 'content, end of the work week',
    energy: 0.6,
    goal: `Two of the meals this week were genuinely good and you want them to come back. Find a way
to tell the app you liked them, and check where saved or favourite meals end up.`,
    successCriteria: [
      'She found how to favourite a meal',
      'She found where favourites are stored afterwards',
      'She believes favourites will influence future plans',
    ],
    focus: ['favourites', 'recipes', 'personalisation'],
  },

  // ─── SATURDAY — day 6: time to actually explore ──────────────────────────
  browseRecipes: {
    id: 'browse-recipes',
    title: 'Saturday morning recipe browsing',
    dayOfWeek: 'Saturday',
    timeOfDay: 'morning',
    minutes: 12,
    mood: 'relaxed, no time pressure, coffee in hand',
    energy: 0.85,
    goal: `It is Saturday and you have actual free time. Browse the recipes in Habeat the way you
would browse a food feed — look at breakfasts, look at dinners, open anything that looks good, and
save the ones you would actually make. You are allowed to enjoy yourself here.`,
    successCriteria: [
      'She opened several recipes and read at least one properly',
      'She saved something for later',
      'Browsing felt enjoyable rather than like a search task',
    ],
    focus: ['recipes', 'recipe detail', 'favourites', 'discovery'],
  },

  cookAndLogRealMeal: {
    id: 'cook-and-log-real-meal',
    title: 'Cooking something and logging it',
    dayOfWeek: 'Saturday',
    timeOfDay: 'evening',
    minutes: 7,
    mood: 'pleased with herself, cooked a real dinner',
    energy: 0.7,
    goal: `You actually cooked tonight — a chicken salad with a lot of extras, not exactly what the
plan said. Record what you really ate, as closely as the app lets you. If there is a way to add your
own meal or take a photo of it, try that.`,
    successCriteria: [
      'She logged a meal that was not from the plan',
      'Adding a custom meal took under two minutes',
      'She trusted that what she logged was recorded correctly',
    ],
    focus: ['custom meal', 'photo meal', 'daily tracker', 'meal logging'],
  },

  socialShare: {
    id: 'social-share',
    title: 'Seeing what other people are doing',
    dayOfWeek: 'Saturday',
    timeOfDay: 'evening',
    minutes: 6,
    mood: 'sociable, mildly nosy',
    energy: 0.65,
    goal: `You noticed Habeat has a community side. Have a look at what other people post, and if you
feel good about your week, share something of your own. You are a bit self-conscious about posting,
so only do it if it feels easy and low-risk.`,
    successCriteria: [
      'She found the community/social area',
      'She understood who would see a post before posting',
      'Posting (or deciding not to) felt comfortable',
    ],
    focus: ['social', 'community feed', 'sharing', 'privacy'],
  },

  // ─── SUNDAY — day 7: reset and plan the week ─────────────────────────────
  weeklyPlanning: {
    id: 'weekly-planning',
    title: 'Planning the coming week',
    dayOfWeek: 'Sunday',
    timeOfDay: 'morning',
    minutes: 12,
    mood: 'organised, Sunday-reset energy',
    energy: 0.8,
    goal: `It is Sunday morning and you want the coming week sorted so you are not deciding what to
eat at 20:00 every night. Look at the week ahead in Habeat, check the meals make sense for your
schedule, and change anything that clearly will not work (you have a late meeting Wednesday and you
are out Friday).`,
    successCriteria: [
      'She saw the whole week in one place',
      'She could change a specific day without redoing everything',
      'She left feeling the week was handled',
    ],
    focus: ['weekly overview', 'plan editing', 'meal swap'],
  },

  shoppingListRun: {
    id: 'shopping-list-run',
    title: 'Building the supermarket list',
    dayOfWeek: 'Sunday',
    timeOfDay: 'midday',
    minutes: 8,
    mood: 'practical, about to leave the house',
    energy: 0.7,
    goal: `You are going to the supermarket in twenty minutes and you want a list based on this
week's plan. Get the list, check it is something you could actually shop from, and add the two
things you know you need anyway (coffee, oat milk).`,
    successCriteria: [
      'A usable shopping list came out of the plan',
      'She could add her own items',
      'The list was organised enough to shop from in a real store',
    ],
    focus: ['shopping list', 'weekly plan', 'add item'],
  },

  setAGoal: {
    id: 'set-a-goal',
    title: 'Setting a goal for the new week',
    dayOfWeek: 'Sunday',
    timeOfDay: 'evening',
    minutes: 6,
    mood: 'hopeful, slightly ambitious',
    energy: 0.6,
    goal: `You want to commit to something small for the coming week — drinking more water, or not
snacking after 21:00. Find where goals live in Habeat and set one that you actually believe you can
keep. If the goal options do not match what you care about, say so.`,
    successCriteria: [
      'She created a goal that matched her own words',
      'She understood how the app would track it',
      'The goal felt achievable rather than aspirational nonsense',
    ],
    focus: ['goals', 'goal creation', 'personalisation'],
  },

  reviewTheWeek: {
    id: 'review-the-week',
    title: 'Looking back at the whole week',
    dayOfWeek: 'Sunday',
    timeOfDay: 'evening',
    minutes: 7,
    mood: 'reflective — deciding whether to keep the app',
    energy: 0.55,
    goal: `You have used Habeat for a full week now. Look back at how it went — what you tracked,
what you missed, what changed. Then decide, honestly, whether you will still be using this app in a
month. Say why in your final reasoning.`,
    successCriteria: [
      'She found a week-level summary or story',
      'The summary reflected what she actually did',
      'She reached a clear keep/abandon verdict with a reason',
    ],
    focus: ['weekly summary', 'progress', 'reflection', 'retention'],
  },
};

/**
 * A full simulated week. Day 1 = Monday.
 * Sessions run in order within a day — morning first, evening last.
 */
export const WEEK_PLAN: Record<number, { dayOfWeek: string; scenarios: string[] }> = {
  1: { dayOfWeek: 'Monday', scenarios: ['firstVisit', 'generateFirstPlan', 'logMondayDinner'] },
  2: { dayOfWeek: 'Tuesday', scenarios: ['quickLunch', 'swapDislikedMeal', 'waterAndSnack'] },
  3: { dayOfWeek: 'Wednesday', scenarios: ['stressfulDayMoodCheck', 'missedMealsCatchUp'] },
  4: { dayOfWeek: 'Thursday', scenarios: ['checkProgress', 'exploreChallenges'] },
  5: { dayOfWeek: 'Friday', scenarios: ['eatingOutTonight', 'favouriteAMeal'] },
  6: { dayOfWeek: 'Saturday', scenarios: ['browseRecipes', 'cookAndLogRealMeal', 'socialShare'] },
  7: { dayOfWeek: 'Sunday', scenarios: ['weeklyPlanning', 'shoppingListRun', 'setAGoal', 'reviewTheWeek'] },
};

export function getScenario(key: string): Scenario | undefined {
  return SCENARIOS[key];
}

/** All scenario keys scheduled for a given day (1-7). */
export function getDayScenarioKeys(day: number): string[] {
  return WEEK_PLAN[day]?.scenarios ?? [];
}

/** Scenarios scheduled for a given day (1-7), in the order they should run. */
export function getScenariosForDay(day: number): Scenario[] {
  return getDayScenarioKeys(day)
    .map((key) => SCENARIOS[key])
    .filter(Boolean);
}
