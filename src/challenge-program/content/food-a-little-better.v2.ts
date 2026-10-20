import { BehaviorStage } from "../../brain/behavior/behavior.types";
import { FOOD_A_LITTLE_BETTER_V1 } from "./food-a-little-better.v1";
import { ChallengeDay, ChallengeProgram } from "./program.types";

/**
 * "Your Food, a Little Better", v2: the 12-week journey.
 *
 * Six two-week stages. Weeks 1–2 are written; later stages are outlined in
 * docs/superpowers/specs/2026-10-15-pilot-challenge-content.md and added here
 * as they're written. A user who gets ahead of the content waits on the next
 * day ("coming soon"); nothing is lost (see `writtenThrough`).
 *
 * Tone (no-guilt CBT): situations, thoughts, feelings and actions are
 * information, never faults. Copy never mirrors a problem back, never labels
 * a thought as wrong, and every reflection can be skipped.
 */

const STAGE_ROUTINE = "routine";

/** Week 1 is the v1 "Notice" week, re-homed in the first stage with user-facing focus lines. */
const WEEK_1_FOCUS: Record<number, { focus: string; minutes: number; next?: string }> = {
  1: { focus: "Start from the meals you already eat", minutes: 2 },
  2: { focus: "Notice when you eat", minutes: 2 },
  3: { focus: "Notice your hunger signals", minutes: 3 },
  4: { focus: "Notice what makes a meal easy", minutes: 2 },
  5: { focus: "Notice where you'd like more support", minutes: 2 },
  6: { focus: "Give one meal your full attention", minutes: 2 },
  7: { focus: "Look back on your first week", minutes: 3, next: "Next week: what shapes your food choices." },
};

const week1: ChallengeDay[] = FOOD_A_LITTLE_BETTER_V1.days
  .filter((d) => d.day <= 7)
  .map((d) => ({ ...d, stageId: STAGE_ROUTINE, ...WEEK_1_FOCUS[d.day] }));

const SITUATIONS = [
  { id: "home_rushed", label: "At home, short on time" },
  { id: "home_relaxed", label: "At home, with time" },
  { id: "work", label: "At work or school" },
  { id: "on_the_go", label: "On the go" },
  { id: "with_others", label: "With other people" },
  { id: "long_day", label: "At the end of a long day" },
];

const FEELINGS = [
  { id: "calm", label: "Calm" },
  { id: "tired", label: "Tired" },
  { id: "stressed", label: "Stressed" },
  { id: "bored", label: "Bored" },
  { id: "happy", label: "Happy" },
  { id: "rushed", label: "Rushed" },
];

const week2: ChallengeDay[] = [
  {
    day: 8,
    stageId: STAGE_ROUTINE,
    objective: "Introduce the idea that situations shape food choices.",
    focus: "Notice what shapes your food choices",
    minutes: 3,
    lesson: {
      title: "Situations shape choices",
      body: "Most food choices aren't really about food. They're about the situation: how much time you have, how tired you are, who's around, what's in the kitchen. Today, try noticing one moment when choosing what to eat felt easy or difficult. There's no right or wrong answer.",
      readMinutes: 1,
    },
    action: {
      kind: "observation",
      prompt: "Think of one food decision from today or yesterday.",
      answerKey: "situation1",
      fields: [
        { key: "situation", prompt: "Where were you, and what was going on?", options: SITUATIONS, allowText: true },
        {
          key: "ease",
          prompt: "Did choosing feel easy or difficult?",
          options: [
            { id: "easy", label: "Easy" },
            { id: "mixed", label: "Somewhere in between" },
            { id: "hard", label: "Difficult" },
          ],
        },
        {
          key: "why",
          prompt: "What made it that way?",
          multi: true,
          allowText: true,
          options: [
            { id: "time", label: "How much time I had" },
            { id: "energy", label: "My energy" },
            { id: "kitchen", label: "What was in the kitchen" },
            { id: "planned", label: "Whether I'd planned" },
            { id: "people", label: "Other people" },
            { id: "mood", label: "How I was feeling" },
          ],
        },
      ],
    },
    next: "Tomorrow: what gets in the way on busy days.",
    aiGuidance:
      "Day 8. The user is noticing one food decision and its situation. Treat every answer as information. Do not suggest changes yet and do not interpret the answer psychologically.",
  },
  {
    day: 9,
    stageId: STAGE_ROUTINE,
    objective: "Name the practical barriers on busy days, so later steps can target them.",
    focus: "Notice what makes busy days harder",
    minutes: 2,
    lesson: {
      title: "Busy days, honestly",
      body: "Busy days are when routines get tested. Knowing what specifically gets in the way points to a practical fix, which works far better than trying harder.",
      readMinutes: 1,
    },
    action: {
      kind: "reflection",
      prompt: "What tends to make dinner harder on busy days?",
      multi: true,
      answerKey: "busyDayBarrier",
      options: [
        { id: "little_time", label: "I have little time" },
        { id: "tired", label: "I feel tired" },
        { id: "unsure", label: "I'm unsure what to prepare" },
        { id: "no_ingredients", label: "I don't have the ingredients I need" },
        { id: "other", label: "Something else" },
      ],
    },
    next: "Tomorrow: a practical idea based on your answer, and the thoughts that show up around food.",
    aiGuidance:
      "Day 9. The user is naming what makes busy-day dinners harder ({{busyDayBarrier:lower|not answered}}). Treat it as a practical barrier, not a personal trait. Offer one practical idea only if they ask.",
  },
  {
    day: 10,
    stageId: STAGE_ROUTINE,
    objective: "Notice automatic thoughts around food decisions without judging them.",
    focus: "Notice the thoughts around food",
    minutes: 3,
    lesson: {
      title: "Thoughts aren't instructions",
      body: "Some thoughts show up right before a food decision: \"There's no time.\" \"Today's already off track.\" \"I've earned something nice.\" They can feel like facts, but they're just thoughts passing through. Noticing one is enough. You don't have to argue with it.",
      readMinutes: 1,
    },
    action: {
      kind: "choice",
      prompt: "Which of these sound familiar?",
      multi: true,
      answerKey: "familiarThoughts",
      options: [
        { id: "no_time", label: "There's no time to cook" },
        { id: "off_track", label: "Today's already off track" },
        { id: "earned", label: "I've earned something nice" },
        { id: "later", label: "I'm not hungry, I'll eat later" },
        { id: "easiest", label: "Whatever's easiest" },
        { id: "none", label: "None of these" },
      ],
    },
    optional: [{ kind: "reflection", prompt: "Any other thought that tends to show up? (optional)" }],
    next: "Tomorrow: how you feel before you eat.",
    aiGuidance:
      "Day 10. The user is noticing familiar thoughts ({{familiarThoughts:lower|none chosen}}). Do not call them distortions, wrong or irrational, and do not try to dispute them today. Noticing is the whole task.",
  },
  {
    day: 11,
    stageId: STAGE_ROUTINE,
    objective: "Neutral awareness of feelings around eating.",
    focus: "Notice how you feel before you eat",
    minutes: 2,
    lesson: {
      title: "Feelings are part of the picture",
      body: "Tired, stressed, bored, happy, relieved: feelings and food often go together. That's normal, and it isn't a problem to fix. Today, just notice how you feel before one meal or snack.",
      readMinutes: 1,
    },
    action: {
      kind: "observation",
      prompt: "Before one meal or snack today:",
      answerKey: "feelingBeforeMeal",
      fields: [
        { key: "feeling", prompt: "How were you feeling?", options: FEELINGS, multi: true, allowText: true },
        {
          key: "hunger",
          prompt: "And how hungry were you?",
          options: [
            { id: "not_hungry", label: "Not hungry" },
            { id: "a_bit", label: "A bit" },
            { id: "hungry", label: "Hungry" },
            { id: "very_hungry", label: "Very hungry" },
          ],
        },
      ],
    },
    foodHelp: { link: "/mindfulness" },
    next: "Tomorrow: see how the pieces connect.",
    aiGuidance:
      "Day 11. Feelings before eating, observed neutrally. Never suggest that eating for a feeling is bad or needs stopping. Don't diagnose.",
  },
  {
    day: 12,
    stageId: STAGE_ROUTINE,
    objective: "Introduce the situation → thought → feeling → action chain on the user's own example.",
    focus: "See how situation, thought, feeling and action connect",
    minutes: 4,
    lesson: {
      title: "How the pieces connect",
      body: "These pieces tend to link up. A busy evening (the situation) brings \"there's no time\" (a thought), a rushed feeling, and then whatever's quickest (the action). Seeing the chain is what makes it possible to change one link later. Today, map one moment from your own week.",
      readMinutes: 1,
    },
    action: {
      kind: "observation",
      prompt: "Pick one food moment from this week.",
      answerKey: "chain1",
      fields: [
        { key: "situation", prompt: "What was the situation?", options: SITUATIONS, allowText: true },
        {
          key: "thought",
          prompt: "What went through your mind?",
          allowText: true,
          options: [
            { id: "no_time", label: "There's no time" },
            { id: "off_track", label: "Today's already off track" },
            { id: "earned", label: "I've earned this" },
            { id: "easiest", label: "Whatever's easiest" },
            { id: "not_sure", label: "Not sure" },
          ],
        },
        { key: "feeling", prompt: "How did you feel?", options: FEELINGS, multi: true, allowText: true },
        {
          key: "action",
          prompt: "What did you end up doing?",
          allowText: true,
          options: [
            { id: "planned", label: "Ate what I'd planned" },
            { id: "quickest", label: "Had whatever was quickest" },
            { id: "ordered", label: "Ordered in" },
            { id: "snacked", label: "Snacked instead of a meal" },
            { id: "skipped", label: "Skipped the meal" },
            { id: "other", label: "Something else" },
          ],
        },
      ],
    },
    next: "Tomorrow: what already helps on your better days.",
    aiGuidance:
      "Day 12. The user is mapping one situation → thought → feeling → action chain. Reflect it back in their own words only, without judging any link. Don't propose a fix unless asked.",
  },
  {
    day: 13,
    stageId: STAGE_ROUTINE,
    objective: "Find existing strengths to build on.",
    focus: "Notice what already helps",
    minutes: 2,
    lesson: {
      title: "You're already doing things that work",
      body: "On the days that go well, something is helping. Maybe it's a meal you can make on autopilot, food you bought ahead, or eating with someone. These are the things to build on.",
      readMinutes: 1,
    },
    action: {
      kind: "choice",
      prompt: "What helps on your better days?",
      multi: true,
      answerKey: "alreadyHelps",
      options: [
        { id: "planned_ahead", label: "Knowing what I'll eat" },
        { id: "food_ready", label: "Having food ready" },
        { id: "regular_times", label: "Eating at regular times" },
        { id: "go_to_meal", label: "A go-to meal" },
        { id: "company", label: "Eating with others" },
        { id: "slower", label: "Eating without rushing" },
      ],
    },
    next: "Tomorrow: put the two weeks together.",
    aiGuidance: "Day 13. Strengths only. Build on what the user says already helps ({{alreadyHelps:lower|not answered}}).",
  },
  {
    day: 14,
    stageId: STAGE_ROUTINE,
    objective: "Consolidate stage 1 and let the user choose where stage 2 starts.",
    focus: "Map your routine and choose what's next",
    minutes: 3,
    lesson: {
      title: "Your routine, mapped",
      body: "Two weeks of noticing. Here's what you found: the meals you eat most weeks ({{everydayMeals|still to pick}}), where you'd like support ({{trickyMoment:lower|not chosen yet}}), and what already helps ({{alreadyHelps:lower|still to discover}}). Next, you'll start building on it.",
      readMinutes: 1,
    },
    action: {
      kind: "reflection",
      prompt: "What would you like to work on first?",
      answerKey: "firstFocus",
      options: [
        { id: "busy_days", label: "Easier busy days" },
        { id: "planning", label: "Planning ahead" },
        { id: "rhythm", label: "A steadier rhythm" },
        { id: "feelings", label: "Eating and feelings" },
        { id: "go_to_meals", label: "More go-to meals" },
      ],
    },
    communityPrompt: "Share a practical observation about your routine.",
    next: "Weeks 3–4: build the foundations.",
    aiGuidance:
      "Day 14, end of stage 1. Celebrate the noticing, not results. The user's chosen first focus is {{firstFocus:lower|not chosen}}.",
  },
];

export const FOOD_A_LITTLE_BETTER_V2: ChallengeProgram = {
  id: "food-a-little-better",
  version: 2,
  title: "Your Food, a Little Better",
  tagline: "Keep the food you love. Understand your routine and make everyday eating a little easier.",
  description:
    "A 12-week guided journey built on the meals you already eat. Understand your routine, set up foundations that make good days easier, build flexible responses for the harder ones, try small experiments, and leave with a plan you can keep using on your own.",
  audience:
    "Anyone who wants a steadier routine without a diet. It's the best fit if you've tried strict plans before and they didn't last.",
  learningOutcomes: [
    "Understand what shapes your food choices",
    "Set things up so the easy choice is a good one",
    "Have practical options for days that don't go to plan",
    "Know which strategies work for you, and keep using them",
  ],
  durationDays: 84,
  dailyMinutes: { min: 2, max: 5 },
  access: "free",
  stages: [
    {
      id: STAGE_ROUTINE,
      title: "Understand your routine",
      purpose: "Notice when, what and why you eat, without changing anything yet.",
      brainStage: BehaviorStage.AWARENESS,
      days: [1, 14],
    },
    {
      id: "foundations",
      title: "Build the foundations",
      purpose: "Set up a backup meal, an anchor meal and a short plan, so good days take less effort.",
      brainStage: BehaviorStage.PREPARATION,
      days: [15, 28],
    },
    {
      id: "flexible",
      title: "Develop flexible responses",
      purpose: "Have a practical next step ready for the moments that used to derail the day.",
      brainStage: BehaviorStage.REPLACEMENT,
      days: [29, 42],
    },
    {
      id: "experiment",
      title: "Experiment and learn",
      purpose: "Try small strategies, review how they went, and keep what works for you.",
      brainStage: BehaviorStage.REPLACEMENT,
      days: [43, 56],
    },
    {
      id: "independence",
      title: "Build independence",
      purpose: "Make your own plans and adjustments with less guidance.",
      brainStage: BehaviorStage.REINFORCEMENT,
      days: [57, 70],
    },
    {
      id: "consolidate",
      title: "Consolidate and look ahead",
      purpose: "Review what you learned and prepare your plan for the months after the journey.",
      brainStage: BehaviorStage.MAINTENANCE,
      days: [71, 84],
    },
  ],
  milestones: [
    { id: "first_week", afterDay: 7, title: "First week", badgeId: "journey_noticed" },
    { id: "routine_mapped", afterDay: 14, title: "Routine mapped", badgeId: "journey_routine_mapped" },
    { id: "foundations", afterDay: 28, title: "Foundations set", badgeId: "journey_foundations" },
    { id: "flexible", afterDay: 42, title: "Flexible", badgeId: "journey_flexible" },
    { id: "experimenter", afterDay: 56, title: "Experimenter", badgeId: "journey_experimenter" },
    { id: "independent", afterDay: 70, title: "On your own", badgeId: "journey_independent" },
    { id: "twelve_weeks", afterDay: 84, title: "12 weeks", badgeId: "journey_twelve_weeks" },
  ],
  completion: { minCoreDaysDone: 56 },
  afterwards: {
    // Weekly check-ins that keep the toolkit in use. Not written yet, so it isn't offered.
    maintenanceProgramId: "keep-it-going",
    nextProgramIds: [],
    independent: {
      title: "Keep practicing on your own",
      body: "No daily steps. Your backup meal, go-to meals and the strategies that worked for you stay on Today, and your coach still knows them.",
    },
  },
  guides: [
    ...FOOD_A_LITTLE_BETTER_V1.guides.filter((g) => g.days[1] <= 7),
    {
      id: "no-right-answers",
      days: [8, 8],
      title: "Nothing to get right",
      body: "There's no good or bad answer here. A moment that felt difficult tells you just as much as one that felt easy.",
    },
    {
      id: "busy-time",
      days: [10, 10],
      when: { busyDayBarrier: ["little_time"] },
      title: "From yesterday: ten minutes counts",
      body: "A dinner that takes ten minutes is a real dinner. Eggs on toast, a wrap, a bowl of leftovers: quick isn't second best.",
    },
    {
      id: "busy-tired",
      days: [10, 10],
      when: { busyDayBarrier: ["tired"] },
      title: "From yesterday: decide before you're tired",
      body: "Tired evenings are hard places to make decisions. Choosing dinner at lunchtime takes the question off the table later.",
    },
    {
      id: "busy-unsure",
      days: [10, 10],
      when: { busyDayBarrier: ["unsure"] },
      title: "From yesterday: a short list helps",
      body: "Three go-to dinners you can make without thinking are worth more than thirty recipes. You'll build that list in the next stage.",
    },
    {
      id: "busy-ingredients",
      days: [10, 10],
      when: { busyDayBarrier: ["no_ingredients"] },
      title: "From yesterday: a few staples go a long way",
      body: "Pasta, eggs, canned beans, frozen vegetables: with a few staples at home, there's always something to make.",
    },
  ],
  days: [...week1, ...week2],
};
