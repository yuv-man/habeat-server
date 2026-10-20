import { BehaviorStage } from "../../brain/behavior/behavior.types";
import { ChallengeProgram } from "./program.types";

/**
 * Pilot program: "Your Food, a Little Better", v1.
 *
 * Source of truth for the copy is
 * docs/superpowers/specs/2026-10-15-pilot-challenge-content.md. Pending
 * dietitian review (D9) — change copy there first, then here.
 *
 * Tone (no-guilt CBT): reflect what the user is building, never mirror a
 * problem back. Copy says "your evenings", never "your late-night eating".
 *
 * Placeholders: `{{answerKey}}` renders a saved answer, `{{answerKey.0}}` its
 * first item, `{{answerKey:lower}}` lower-cased, `{{answerKey|fallback}}`
 * when the user has no answer yet. See enrollment.rules.ts → renderTemplate.
 */

const CHECK = "check" as const;

const TRICKY_MOMENTS = [
  { id: "busy_evenings", label: "Busy evenings" },
  { id: "hectic_middays", label: "Hectic middays" },
  { id: "late_evenings", label: "Late evenings" },
  { id: "on_the_go", label: "Days on the go" },
  { id: "weekends", label: "Weekends" },
  { id: "other", label: "Something else" },
];

export const FOOD_A_LITTLE_BETTER_V1: ChallengeProgram = {
  id: "food-a-little-better",
  version: 1,
  title: "Your Food, a Little Better",
  tagline:
    "Keep the food you love. Make your everyday eating a little easier, one small step a day.",
  description:
    "A 30-day guided challenge built on the meals you already eat. Notice your rhythm, set things up so the easy choice is the good one, make small upgrades to dishes you love, and build a plan for the harder moments.",
  audience:
    "Anyone who wants a steadier routine without a diet. It's the best fit if you've tried strict plans before and they didn't last.",
  learningOutcomes: [
    "Notice your eating rhythm without judging it",
    "Set things up so the easy choice is the good one",
    "Make small upgrades to meals you already love",
    "Have a plan ready for the harder moments",
  ],
  durationDays: 30,
  dailyMinutes: { min: 2, max: 5 },
  access: "free",
  stages: [
    { id: "notice", title: "Week 1: Notice", brainStage: BehaviorStage.AWARENESS, days: [1, 7] },
    { id: "easy", title: "Week 2: Make it easy", brainStage: BehaviorStage.PREPARATION, days: [8, 14] },
    { id: "upgrade", title: "Week 3: Small upgrades", brainStage: BehaviorStage.REPLACEMENT, days: [15, 21] },
    { id: "stick", title: "Week 4: Make it stick", brainStage: BehaviorStage.REINFORCEMENT, days: [22, 28] },
    { id: "keep", title: "Keep going", brainStage: BehaviorStage.MAINTENANCE, days: [29, 30] },
  ],
  milestones: [
    { id: "noticed", afterDay: 7, title: "Noticed", badgeId: "journey_noticed" },
    { id: "set_up", afterDay: 14, title: "Set up", badgeId: "journey_set_up" },
    { id: "upgraded", afterDay: 21, title: "Upgraded", badgeId: "journey_upgraded" },
    { id: "steady", afterDay: 28, title: "Steady", badgeId: "journey_steady" },
    { id: "finished", afterDay: 30, title: "30 days", badgeId: "journey_finished" },
  ],
  completion: { minCoreDaysDone: 20 },
  nextChapter: undefined, // Chapter 2 ("Cook it your way") is not written yet.
  guides: [
    {
      id: "rhythm-not-schedule",
      days: [2, 2],
      title: "A rhythm, not a schedule",
      body: "No need to eat at 'perfect' times. A rough rhythm you can keep beats a strict schedule you can't.",
    },
    {
      id: "repeat-meals-proven",
      days: [4, 4],
      title: "Start from what already works",
      body: "Meals you already repeat are the best starting point. They've already proven they fit your life.",
    },
    {
      id: "busy-evening-batch",
      days: [9, 9],
      when: { trickyMoment: ["busy_evenings"] },
      title: "Busy-evening tip",
      body: "Cook rice or pasta once on Sunday. Three dinners just got 10 minutes shorter.",
    },
    {
      id: "hectic-midday-pack",
      days: [9, 9],
      when: { trickyMoment: ["hectic_middays", "on_the_go"] },
      title: "Packed and ready",
      body: "Pack tomorrow's lunch while you clear up dinner. It takes two minutes, and midday is already decided.",
    },
    {
      id: "late-evening-close",
      days: [9, 9],
      when: { trickyMoment: ["late_evenings"] },
      title: "A satisfying dinner helps later",
      body: "A dinner with some protein and something warm tends to carry you further into the evening.",
    },
    {
      id: "weekend-loose-plan",
      days: [9, 9],
      when: { trickyMoment: ["weekends", "other"] },
      title: "A loose plan is enough",
      body: "One planned meal is enough for the weekend. The rest can stay flexible.",
    },
    {
      id: "short-list",
      days: [11, 11],
      title: "Keep the list short",
      body: "A list with five items gets used. A list with thirty gets lost.",
    },
    {
      id: "frozen-veg",
      days: [16, 16],
      title: "Frozen counts",
      body: "Frozen vegetables count, and they don't go bad on a busy week.",
    },
    {
      id: "next-meal-normal",
      days: [23, 23],
      title: "The kindest next step",
      body: "After a big meal, the kindest next step is a normal meal. Your body doesn't need you to make up for anything.",
    },
    {
      id: "enjoy-with-attention",
      days: [25, 25],
      title: "Enjoy it on purpose",
      body: "Enjoying food with attention tends to make it more satisfying, not less.",
    },
  ],
  days: [
    // ── Week 1: Notice ──────────────────────────────────────────────────────
    {
      day: 1,
      stageId: "notice",
      objective: "Set expectations and anchor the challenge in the user's own food.",
      lesson: {
        title: "You keep your food",
        body: "Most plans fail because they swap your life for someone else's menu. Here, you'll start from meals you already eat and make them a little easier and a little better, one small step a day. Some days you'll miss. That's built in: you just pick up where you left off.",
        readMinutes: 1,
      },
      action: {
        kind: "meal_pick",
        prompt: "Pick 3 meals you eat most weeks.",
        multi: true,
        answerKey: "everydayMeals",
      },
      foodHelp: {
        assistantSeed: "Help me name a dish I eat often so I can add it to My Meals.",
        link: "/my-meals",
      },
      next: "Tomorrow: just notice when you eat. Nothing to change.",
      aiGuidance:
        "Day 1. The user is choosing 3 everyday meals. Help them name dishes they already eat. Do not suggest changes or healthier versions yet.",
    },
    {
      day: 2,
      stageId: "notice",
      objective: "Notice meal timing without changing it.",
      lesson: {
        title: "When matters as much as what",
        body: "Long gaps often turn into 'suddenly starving' moments later. Today you're not fixing anything, just noticing roughly when you eat.",
        readMinutes: 1,
      },
      action: {
        kind: "choice",
        prompt: "Roughly when did you eat today?",
        multi: true,
        answerKey: "mealTimes",
        options: [
          { id: "early_morning", label: "Early morning" },
          { id: "late_morning", label: "Late morning" },
          { id: "midday", label: "Midday" },
          { id: "afternoon", label: "Afternoon" },
          { id: "evening", label: "Evening" },
          { id: "late_night", label: "Late night" },
        ],
      },
      next: "Tomorrow: how hungry you are before one meal.",
      aiGuidance:
        "Day 2. The user is noticing meal timing only. Do not recommend meal times or changes.",
    },
    {
      day: 3,
      stageId: "notice",
      objective: "Introduce hunger and fullness awareness, framed neutrally.",
      lesson: {
        title: "Your body sends signals",
        body: "Before one meal today, check in: how hungry am I? Afterward: how do I feel now? There's no right answer. It's information, not a test.",
        readMinutes: 1,
      },
      action: {
        kind: CHECK,
        prompt: "Check in before and after one meal.",
      },
      optional: [
        {
          kind: "choice",
          prompt: "Before the meal",
          options: [
            { id: "not_hungry", label: "Not hungry" },
            { id: "a_bit", label: "A bit" },
            { id: "hungry", label: "Hungry" },
            { id: "very_hungry", label: "Very hungry" },
          ],
        },
        {
          kind: "choice",
          prompt: "After the meal",
          options: [
            { id: "still_hungry", label: "Still hungry" },
            { id: "satisfied", label: "Satisfied" },
            { id: "too_full", label: "Too full" },
          ],
        },
      ],
      next: "Tomorrow: what makes a meal easy for you.",
      aiGuidance:
        "Day 3. Hunger and fullness awareness. Never say 'stop at X' or 'you ate too much'. Any answer is fine.",
    },
    {
      day: 4,
      stageId: "notice",
      objective: "Identify what makes the user's meals easy.",
      lesson: {
        title: "Easy beats perfect",
        body: "The meals you repeat are the ones that fit your time, energy and kitchen. Knowing why a meal is easy tells us what to build on.",
        readMinutes: 1,
      },
      action: {
        kind: "choice",
        prompt: "What makes {{everydayMeals.0|your go-to meal}} easy?",
        multi: true,
        answerKey: "easyBecause",
        usesAnswer: ["everydayMeals"],
        options: [
          { id: "quick", label: "Quick" },
          { id: "few_ingredients", label: "Few ingredients" },
          { id: "know_by_heart", label: "I know it by heart" },
          { id: "everyone_eats", label: "Everyone at home eats it" },
          { id: "cheap", label: "Cheap" },
          { id: "leftovers", label: "Leftovers work" },
        ],
      },
      next: "Tomorrow: the part of your day that could use more support.",
      aiGuidance:
        "Day 4. The user is noting what makes their everyday meals easy. Build on it; don't critique the meal.",
    },
    {
      day: 5,
      stageId: "notice",
      objective: "Find the moment where the routine needs backup, framed as support.",
      lesson: {
        title: "Where you'd like more support",
        body: "Every routine has a harder moment, and that's about your day, not about you. For most people it's a busy evening, a hectic midday, the late hours, or eating on the go. Knowing which one tells us where to put the support.",
        readMinutes: 1,
      },
      action: {
        kind: "choice",
        prompt: "Which part of your day could use a little more support?",
        answerKey: "trickyMoment",
        options: TRICKY_MOMENTS,
      },
      next: "Tomorrow: one meal, with full attention.",
      aiGuidance:
        "Day 5. The user is choosing where they'd like support. Never repeat it back as a problem (no 'your late-night eating'); say 'your evenings' or 'busy days'.",
    },
    {
      day: 6,
      stageId: "notice",
      objective: "A light mindful-eating experience.",
      lesson: {
        title: "Taste it",
        body: "Eating while scrolling makes meals disappear. Today, for one meal, put the phone face-down for the first few bites. Notice the flavor, the texture, when you start to feel satisfied.",
        readMinutes: 1,
      },
      action: { kind: CHECK, prompt: "Eat one meal without a screen for the first few bites." },
      foodHelp: { link: "/mindfulness" },
      next: "Tomorrow: look back on your first week.",
      aiGuidance: "Day 6. One meal without a screen for the first few bites. Keep it light.",
    },
    {
      day: 7,
      stageId: "notice",
      objective: "Consolidate awareness and celebrate.",
      lesson: {
        title: "You've been paying attention",
        body: "That's the hardest part, and it's the base everything else builds on. This week you told us your everyday meals ({{everydayMeals|still to pick}}) and the part of the day you'd like support with ({{trickyMoment:lower|not chosen yet}}).",
        readMinutes: 1,
      },
      action: {
        kind: "reflection",
        prompt: "What surprised you most?",
        answerKey: "week1Insight",
        options: [
          { id: "meal_times", label: "My meal times" },
          { id: "hunger", label: "How hungry I get" },
          { id: "easy_meals", label: "What makes meals easy" },
          { id: "support_moment", label: "Where I'd like support" },
          { id: "nothing_yet", label: "Nothing yet" },
        ],
      },
      communityPrompt: "What's one thing you noticed about your eating this week?",
      next: "Week 2: make the easy choice the default.",
      aiGuidance: "Day 7, Week 1 review. Celebrate attention, not results.",
    },

    // ── Week 2: Make it easy ────────────────────────────────────────────────
    {
      day: 8,
      stageId: "easy",
      objective: "Environment over willpower.",
      lesson: {
        title: "What you see is what you eat",
        body: "We tend to grab what's in front of us. Moving one useful food into view does more than any amount of willpower.",
        readMinutes: 1,
      },
      action: {
        kind: CHECK,
        prompt:
          "Put one food you'd like to eat more of where you'll see it: fruit on the counter, a water bottle on your desk, yogurt at the front of the fridge.",
      },
      next: "Tomorrow: your no-energy backup meal.",
      aiGuidance: "Day 8. Help the user pick one food to put in sight. No rules about what to remove.",
    },
    {
      day: 9,
      stageId: "easy",
      objective: "A ready plan for low-energy days.",
      lesson: {
        title: "For the days you've got nothing left",
        body: "A backup meal is something you can make in about 10 minutes from things you keep at home. With one ready, a hard day doesn't have to become a takeout-and-regret day.",
        readMinutes: 1,
      },
      action: {
        kind: "meal_pick",
        prompt: "Choose your backup meal.",
        answerKey: "backupMeal",
        usesAnswer: ["trickyMoment"],
      },
      foodHelp: {
        assistantSeed:
          "Suggest 3 backup meals I can make in about 10 minutes from pantry staples, using foods I like.",
        link: "/shopping",
      },
      next: "Tomorrow: decide two dinners ahead of time.",
      aiGuidance:
        "Day 9. The user is picking a ~10-minute backup meal for {{trickyMoment:lower|harder days}}. Suggest quick, restriction-safe meals, ideally from their own dishes.",
    },
    {
      day: 10,
      stageId: "easy",
      objective: "Reduce in-the-moment decisions.",
      lesson: {
        title: "Decisions are tiring",
        body: "At 7pm, after a long day, 'what's for dinner?' is a hard question. Answer it now, while it's easy.",
        readMinutes: 1,
      },
      action: {
        kind: "plan",
        prompt: "Pick dinners for the next two days.",
        answerKey: "nextDinners",
      },
      next: "Tomorrow: a short shopping list.",
      aiGuidance: "Day 10. Help the user decide the next two dinners from their plan or My Meals.",
    },
    {
      day: 11,
      stageId: "easy",
      objective: "Make the plan practical.",
      lesson: {
        title: "Five minutes now saves three trips later",
        body: "Check what your dinners and backup meal need, and get it on the list.",
        readMinutes: 1,
      },
      action: { kind: CHECK, prompt: "Review your shopping list for the next few days." },
      foodHelp: { link: "/shopping" },
      next: "Tomorrow: one meal you can count on.",
      aiGuidance: "Day 11. Shopping list for {{nextDinners|the next dinners}} and {{backupMeal|the backup meal}}.",
    },
    {
      day: 12,
      stageId: "easy",
      objective: "One predictable meal stabilizes the day.",
      lesson: {
        title: "One steady meal",
        body: "You don't need every meal planned. One meal you eat around the same time most days (often breakfast or lunch) makes the rest of the day easier to manage.",
        readMinutes: 1,
      },
      action: {
        kind: "plan",
        prompt: "Choose your anchor meal and a rough time.",
        answerKey: "anchor",
      },
      next: "Tomorrow: prep once, eat twice.",
      aiGuidance:
        "Day 12. Anchor meal. If the user fasts, the anchor must sit inside their eating window. No breakfast pressure.",
    },
    {
      day: 13,
      stageId: "easy",
      objective: "Practice one small make-ahead step.",
      lesson: {
        title: "Future you will thank you",
        body: "Cooking one component ahead (a pot of rice, chopped vegetables, boiled eggs, a can of beans rinsed and ready) turns tomorrow's meal into assembly.",
        readMinutes: 1,
      },
      action: { kind: CHECK, prompt: "Prepare one thing ahead for a meal this week." },
      foodHelp: { assistantSeed: "What can I prep ahead for {{nextDinners|my next dinners}}?" },
      next: "Tomorrow: look back on week 2.",
      aiGuidance: "Day 13. One make-ahead step for {{nextDinners|the coming dinners}}.",
    },
    {
      day: 14,
      stageId: "easy",
      objective: "Consolidate the setup.",
      lesson: {
        title: "You've built a safety net",
        body: "You now have a backup meal ({{backupMeal|not picked yet}}), an anchor ({{anchor|not set yet}}), and a couple of dinners decided.",
        readMinutes: 1,
      },
      action: {
        kind: "reflection",
        prompt: "Which setup helped most?",
        answerKey: "week2Helpful",
        options: [
          { id: "food_in_sight", label: "Food in sight" },
          { id: "backup_meal", label: "Backup meal" },
          { id: "planning_dinners", label: "Planning dinners" },
          { id: "shopping_list", label: "Shopping list" },
          { id: "anchor_meal", label: "Anchor meal" },
          { id: "prep_ahead", label: "Prep ahead" },
        ],
      },
      communityPrompt: "What's your backup meal? Share it, someone might steal it.",
      next: "Week 3: make meals you love a little better.",
      aiGuidance: "Day 14, Week 2 review. Celebrate the setup they built.",
    },

    // ── Week 3: Small upgrades ──────────────────────────────────────────────
    {
      day: 15,
      stageId: "upgrade",
      objective: "Introduce tuning familiar dishes.",
      lesson: {
        title: "Keep the dish",
        body: "The meals you love stay. This week you'll pick one and make it a little better: one small change, not a whole new recipe.",
        readMinutes: 1,
      },
      action: {
        kind: "meal_pick",
        prompt: "Pick one everyday meal to upgrade this week.",
        answerKey: "upgradeDish",
        usesAnswer: ["everydayMeals"],
      },
      foodHelp: {
        assistantSeed:
          "Give me 3 small upgrades for {{upgradeDish|one of my everyday meals}} that keep it tasting like itself.",
      },
      next: "Tomorrow: add some color.",
      aiGuidance:
        "Day 15. Small upgrades only: keep the dish recognizable, respect restrictions and the repertoire tuning limits. Add, don't remove.",
    },
    {
      day: 16,
      stageId: "upgrade",
      objective: "Additive change: vegetables and fruit.",
      lesson: {
        title: "Add before you subtract",
        body: "Adding a vegetable or piece of fruit to a meal you already eat is one of the simplest upgrades there is. Nothing comes off the plate.",
        readMinutes: 1,
      },
      action: { kind: CHECK, prompt: "Add a vegetable or fruit to one meal today." },
      next: "Tomorrow: meals that keep you going.",
      aiGuidance: "Day 16. Additive framing only: what to add, never what to cut.",
    },
    {
      day: 17,
      stageId: "upgrade",
      objective: "Protein and fiber for satisfaction.",
      lesson: {
        title: "Meals that last",
        body: "If a meal leaves you hungry an hour later, adding some protein or fiber (eggs, beans, lentils, yogurt, whole grains) usually helps it keep you going longer.",
        readMinutes: 1,
      },
      action: {
        kind: CHECK,
        prompt: "Add protein or fiber to a meal that usually doesn't last.",
        outcomes: ["kept_going", "about_same"],
      },
      next: "Tomorrow: cook your upgrade.",
      aiGuidance: "Day 17. Suggest protein or fiber additions that fit the user's restrictions.",
    },
    {
      day: 18,
      stageId: "upgrade",
      objective: "Try the Day 15 upgrade for real; capture a preference signal.",
      lesson: {
        title: "Taste test",
        body: "Make {{upgradeDish|your chosen dish}} with the change you picked. If it's not for you, that's useful too: we'll try a different tweak.",
        readMinutes: 1,
      },
      action: {
        kind: "meal_logged",
        prompt: "Cook {{upgradeDish|your upgraded dish}} with your change.",
        outcomes: ["liked", "okay", "not_for_me"],
        autoComplete: { source: "meal_log", matchAnswer: "upgradeDish" },
      },
      next: "Tomorrow: what you drink.",
      aiGuidance:
        "Day 18. The user is cooking {{upgradeDish|their upgraded dish}}. 'Not for me' is a useful result, not a failure.",
    },
    {
      day: 19,
      stageId: "upgrade",
      objective: "Neutral awareness of drinks.",
      lesson: {
        title: "Drinks count too, and so does water",
        body: "No rules today. Have a glass of water with each meal, and notice what else you usually drink.",
        readMinutes: 1,
      },
      action: { kind: CHECK, prompt: "Have water with your meals today." },
      next: "Tomorrow: a swap you'd actually keep.",
      aiGuidance: "Day 19. Observation only. No 'cut soda' messaging.",
    },
    {
      day: 20,
      stageId: "upgrade",
      objective: "Use the meal assistant in context.",
      lesson: {
        title: "Realistic beats ideal",
        body: "A planned meal you won't eat isn't helping. Swap one for something you'd genuinely want, and we'll learn from it.",
        readMinutes: 1,
      },
      action: {
        kind: "meal_logged",
        prompt: "Swap one planned meal for something you'd actually want.",
        autoComplete: { source: "swap" },
      },
      next: "Tomorrow: look back on week 3.",
      aiGuidance: "Day 20. Help the user swap a planned meal for one they'd genuinely eat.",
    },
    {
      day: 21,
      stageId: "upgrade",
      objective: "Consolidate the upgrades.",
      lesson: {
        title: "Your food, a little better",
        body: "This week you upgraded {{upgradeDish|one of your meals}} and tried a few additions. Keep what worked; drop what didn't.",
        readMinutes: 1,
      },
      action: {
        kind: "reflection",
        prompt: "Which changes would you keep?",
        multi: true,
        answerKey: "upgradesKept",
        options: [
          { id: "upgrade_dish", label: "My upgraded dish" },
          { id: "add_color", label: "Adding color" },
          { id: "staying_power", label: "Protein or fiber" },
          { id: "water", label: "Water with meals" },
          { id: "swap", label: "A swap I liked" },
        ],
      },
      communityPrompt: "Share an upgrade that worked: what did you change?",
      next: "Week 4: make it stick.",
      aiGuidance: "Day 21, Week 3 review. Celebrate what they kept.",
    },

    // ── Week 4: Make it stick ───────────────────────────────────────────────
    {
      day: 22,
      stageId: "stick",
      objective: "An if-then plan.",
      lesson: {
        title: "Decide before it happens",
        body: "A plan like 'If it's a busy evening, then I make my backup meal' works because the decision is already made.",
        readMinutes: 1,
      },
      action: {
        kind: "plan",
        prompt: "My plan for {{trickyMoment:lower|harder moments}}: I'll…",
        answerKey: "ifThen",
        usesAnswer: ["trickyMoment", "backupMeal"],
        options: [
          { id: "backup", label: "Make {{backupMeal|my backup meal}}" },
          { id: "anchor", label: "Have my anchor meal" },
          { id: "prep", label: "Eat something from my prep" },
        ],
      },
      next: "Tomorrow: your restart meal.",
      aiGuidance: "Day 22. Help shape an if-then plan for {{trickyMoment:lower|harder moments}}.",
    },
    {
      day: 23,
      stageId: "stick",
      objective: "Recovery after an off day without compensation.",
      lesson: {
        title: "Off days happen. The next meal is just a meal.",
        body: "Skipping meals or 'making up for it' after a big day usually leads to another big day. Instead, pick a normal, satisfying meal you go back to. That's your restart.",
        readMinutes: 1,
      },
      action: { kind: "meal_pick", prompt: "Pick your restart meal.", answerKey: "restartMeal" },
      next: "Tomorrow: ordering in and eating out.",
      aiGuidance:
        "Day 23. Anti-compensation: never suggest skipping meals, eating less, or exercising to make up for anything.",
    },
    {
      day: 24,
      stageId: "stick",
      objective: "Eating out without rules.",
      lesson: {
        title: "Eating out is part of life",
        body: "Having one go-to order at a place you visit often means one less decision when you're tired.",
        readMinutes: 1,
      },
      action: {
        kind: "choice",
        prompt: "Pick a go-to order somewhere you go often.",
        answerKey: "goToOrder",
      },
      foodHelp: {
        assistantSeed: "Help me pick a satisfying go-to order at a place I go often that fits what I'm working on.",
      },
      next: "Tomorrow: enjoy something fully.",
      aiGuidance: "Day 24. A satisfying go-to order. No 'healthiest option' rules.",
    },
    {
      day: 25,
      stageId: "stick",
      objective: "Reduce guilt and restriction around favorite foods.",
      lesson: {
        title: "Foods you love belong",
        body: "Treat foods aren't failures. Today, have something you really enjoy: sit down, slow down, and enjoy it without 'making up for it' later.",
        readMinutes: 1,
      },
      action: { kind: CHECK, prompt: "Enjoy a food you love, fully." },
      next: "Tomorrow: your simple week template.",
      aiGuidance: "Day 25. Encourage enjoyment. Never frame any food as bad or as something to earn.",
    },
    {
      day: 26,
      stageId: "stick",
      objective: "Turn the challenge pieces into a repeatable week.",
      lesson: {
        title: "Your week, on one card",
        body: "Anchor meal, two planned dinners, a backup, a shopping day. That's a routine you can run without thinking.",
        readMinutes: 1,
      },
      action: {
        kind: "plan",
        prompt: "Pick your shopping and planning day.",
        answerKey: "weekTemplate",
        usesAnswer: ["anchor", "backupMeal", "ifThen"],
      },
      next: "Tomorrow: cook once, eat twice.",
      aiGuidance: "Day 26. Week template from their anchor, backup meal and if-then plan.",
    },
    {
      day: 27,
      stageId: "stick",
      objective: "Reinforce prep with a favorite meal.",
      lesson: {
        title: "Double it",
        body: "Make a double portion of an everyday meal (ideally your upgraded one) and you've got tomorrow sorted.",
        readMinutes: 1,
      },
      action: { kind: CHECK, prompt: "Make a double portion of one everyday meal." },
      next: "Tomorrow: look back on week 4.",
      aiGuidance: "Day 27. Batch-cook a favorite, ideally {{upgradeDish|their upgraded dish}}.",
    },
    {
      day: 28,
      stageId: "stick",
      objective: "Name what has become easier.",
      lesson: {
        title: "This is what a routine looks like",
        body: "Four weeks of small steps add up. Take a moment to notice what feels different.",
        readMinutes: 1,
      },
      action: {
        kind: "reflection",
        prompt: "What's become easier?",
        multi: true,
        answerKey: "easierNow",
        options: [
          { id: "deciding", label: "Deciding meals" },
          { id: "busy_days", label: "Busy days" },
          { id: "back_on_track", label: "Getting back on track" },
          { id: "enjoying", label: "Enjoying food" },
          { id: "shopping", label: "Shopping" },
          { id: "not_much_yet", label: "Not much yet" },
        ],
      },
      communityPrompt: "What's easier now than a month ago?",
      next: "Two more days: look at how far you've come.",
      aiGuidance: "Day 28, Week 4 review. 'Not much yet' is a valid answer; respond with support.",
    },

    // ── Keep going ──────────────────────────────────────────────────────────
    {
      day: 29,
      stageId: "keep",
      objective: "Self-reported change, never body metrics.",
      lesson: {
        title: "Here's your month",
        body: "Day 1 you picked {{everydayMeals|your everyday meals}}. Since then you've built a backup meal ({{backupMeal|not picked}}), an anchor ({{anchor|not set}}) and a restart meal ({{restartMeal|not picked}}).",
        readMinutes: 1,
      },
      action: {
        kind: "reflection",
        prompt: "Compared to day 1, how does everyday eating feel?",
        answerKey: "selfReport",
        options: [
          { id: "easier", label: "Easier" },
          { id: "same", label: "About the same" },
          { id: "harder", label: "Harder" },
        ],
      },
      next: "Tomorrow: choose what you'll keep.",
      aiGuidance:
        "Day 29. If the user says 'harder', respond with support and offer to revisit Week 2. Never mention weight or body change.",
    },
    {
      day: 30,
      stageId: "keep",
      objective: "Choose what to keep and what's next.",
      lesson: {
        title: "You did 30 days",
        body: "Not perfectly, nobody does. The pieces you built are yours.",
        readMinutes: 1,
      },
      action: {
        kind: "choice",
        prompt: "Pick up to 3 things to keep.",
        multi: true,
        answerKey: "keep",
        options: [
          { id: "anchor", label: "My anchor meal" },
          { id: "backup", label: "My backup meal" },
          { id: "if_then", label: "My if-then plan" },
          { id: "upgrade", label: "My upgraded dish" },
          { id: "restart", label: "My restart meal" },
          { id: "week_template", label: "My week template" },
        ],
      },
      next: "What's next is up to you.",
      aiGuidance: "Day 30. Celebrate routines built, never physical change.",
    },
  ],
};
