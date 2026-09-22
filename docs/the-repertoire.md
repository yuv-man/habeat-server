# The Repertoire

> **Status:** design. Rollout steps 1–4 are implemented, and step 5 in a simple
> form (own dishes are placed in the plan; the full macro-aware balancer is not).
> See §14.

A real person cooks roughly 20–25 dishes. They know how to make them, they know
what to buy for them, and their week is built around them. A plan that replaces
those dishes with new recipes asks for a new shopping list, new techniques and
new decisions every day. It works for two weeks, and then the user stops opening
the app — not because the nutrition was wrong, but because following it was a
second job.

The Repertoire makes the user's own dishes the default content of the plan.
Habeat's job shifts from *choosing what they eat* to *tuning what they already
eat* — the portion, the composition, the pairing across the week — and to
introducing new dishes slowly, at a pace the Brain has evidence they can absorb.

**Change the meal, not the menu.**

---

## 1. Why it exists

Today, five separate mechanisms push every plan toward novelty, and nothing
pushes back:

| Where | What it does |
|---|---|
| `generator/meal-plan-prompt.ts` → `buildMenuSkeleton` | Picks an archetype, protein and flavour per meal, seeded so the week *changes every week*. Built to stop the model collapsing onto six dishes — which it does well — but it also prevents the user's own dishes from appearing. |
| `generator.service.ts` → `getRecentMealNames` | Last week's meals are passed in as exclusions. A dish the user liked cannot come back next week. |
| `behavior/behavior.prompts.ts:405` | Dishes the user reliably cooks are passed as *"build in this direction rather than repeating them exactly."* The strongest adherence signal we have is explicitly turned into "don't repeat". |
| `behavior/behavior-checks.ts` → `low-variety` | Fires when `repeatRate > 0.5`, which then renders *"Recent weeks repeated the same few dishes — widen the range."* A person eating their normal 20-dish rotation trips this. |
| `utils/helpers.ts` → `enrichPlanWithFavoriteMeals` | The only path back to known dishes: explicit favourites only, 20–30% of slots, post-hoc replacement after the model has already written the week. |

Each one is reasonable in isolation. Together they mean that a user who follows
the plan perfectly is cooking something unfamiliar at almost every meal. The
behaviour-change ladder in the Brain (`docs/the-brain.md` §6) is careful to
"change one thing, not the whole week" — but the plan it rides on changes the
whole week, every week.

---

## 2. The principle

Most of the nutritional distance between how someone eats and how they should
eat is not in *which* dishes they cook. It is in:

1. **Portion** — 120 g of dry pasta vs 80 g.
2. **Composition** — the ratio inside the dish: protein up, starch down, oil
   measured instead of poured, a vegetable folded in.
3. **Pairing** — what the dish sits next to, and what the rest of the day and
   week looks like around it. Schnitzel is fine; schnitzel after a pastry
   breakfast and a sandwich lunch is the problem.

All three can be changed without the user learning a single new recipe. So:

- **The repertoire is the plan's default content.** Early on, nearly every slot
  is a dish the user already cooks.
- **Habeat tunes those dishes** along the three levers above.
- **New dishes are a budget**, not a default. The Brain sets the budget per week
  from the user's stage and adherence, and a new dish that sticks joins the
  repertoire.

The habit we are building is *a better set of go-to dishes*, not
*compliance with a plan*. A user who leaves Habeat after six months with 28
dishes they cook in healthier proportions has succeeded.

---

## 3. Data model

A new collection, `repertoire_dishes`, one document per dish per user.

```ts
interface RepertoireDish {
  userId: ObjectId;
  name: string;                    // as the user calls it: "mum's chicken soup"
  canonicalKey: string;            // normalised, for matching logs → dish (see utils/ingredient-key.ts)

  slots: MealSlot[];               // where it is eaten: ["dinner"], ["lunch", "dinner"]
  source: "onboarding" | "logged" | "promoted" | "manual";

  /** How the user makes it today. The baseline everything is measured against. */
  usual: {
    ingredients: { name: string; amount: string }[];  // empty for dishes captured from logs — filled at first tune
    servings: number | null;       // how many people the pot feeds; null until asked
    prepMinutes: number | null;
    nutritionPerServing: { calories: number; protein: number; carbs: number; fat: number; fiber?: number } | null;
    nutritionConfidence: "estimated" | "logged" | "user-confirmed" | "photo";
  };

  /** Tuned versions, generated once per dish — not once per week. See §5. */
  tunes: {
    level: 1 | 2 | 3;
    changes: string[];             // full diff from usual: "90 g pasta instead of 120 g", "add a side salad"
    ingredients: { name: string; amount: string }[];  // the tuned recipe — what the shopping list will need
    nutritionPerServing: { calories: number; protein: number; carbs: number; fat: number; fiber?: number };
    acceptedAt?: Date;             // user saw it and did not reject it
    rejectedAt?: Date;
    rejections: number;
  }[];
  currentTuneLevel: 0 | 1 | 2 | 3; // 0 = as usual
  tuneCeiling: 0 | 1 | 2 | 3;      // highest level the user tolerates (§5)
  tunedForPath: string | null;     // diet path the tunes were written for
  tunedAt: Date | null;

  /** How the dish lives in their week. */
  rhythm: {
    usualPerMonth: number | null;  // what the user told us (onboarding); null for captured dishes
    observedPerMonth: number;      // what the last 30 days of home logs show, refreshed on read
    lastCookedOn: string | null;   // YYYY-MM-DD, kept after it ages out of the window
    leftoversFriendly: boolean;    // makes a second meal
  };

  status: "active" | "paused" | "retired" | "declined";  // declined: proposed and refused — never proposed again
  createdAt: Date;
  updatedAt: Date;
}
```

Notes:

- **`usual` is the baseline, not the target.** We keep how they actually make it
  so every change can be shown as a diff ("same soup, a bit less noodles").
- **`servings`** matters because most real cooking is for a household. Habeat
  tunes **only the user's own portion**, never the pot or the rest of the
  household's plates. Tunes may change what goes into the dish (level 2+), but
  must stay acceptable as a shared family meal — a tune that only works if the
  user cooks separately for themselves is a new dish, not a tune.
- **Home cooking only.** Takeaway and eating out are never repertoire dishes
  (see §4.2 and §12).
- **Dietary constraints still apply.** `findMealViolations` runs over repertoire
  dishes exactly as it does over favourites today; a violating dish is kept but
  set to `paused`, never injected.

---

## 4. Capturing the repertoire

The repertoire has to be cheap to build, or onboarding becomes the demanding
part instead.

### 4.1 Onboarding: "What do you eat most weeks?"

One screen, three input paths, aiming for **8+ dishes in under two minutes**:

1. **Pick from common dishes** — a grid localised by language/cuisine. Tap to
   add; tap again for "a lot" vs "sometimes" (seeds `usualPerMonth`).
2. **Type a name** — free text; the dish is resolved by the model into
   ingredients and a nutrition estimate, marked `estimated`.
3. **Photo** — through the existing `photo-recognition` module; marked `photo`.

Per dish we ask one optional follow-up: *"Roughly how much do you eat?"* with
visual portion sizes. Everything else is estimated and refined later.

### 4.2 Passively, from logs

`completedMeals` already feeds `favoriteMeals` in `behavior-summary.ts`. A
logged meal that matches no repertoire dish by `canonicalKey`, and is logged a
second time within 30 days, is proposed: *"You've had shakshuka twice — add it
to your dishes?"* One tap.

Only meals logged with `source: "cooked"` count toward the two. `"ordered"` and
`"eaten-out"` never do, and an **absent** `source` counts as unanswered, not as
cooked — the same rule the Brain's takeaway detection (P08) follows
(`plan.model.ts`, `docs/the-brain.md` §12). The same Pad Thai can be takeaway on
Friday and home-cooked on Sunday; only the Sunday one is evidence for the
repertoire. When a meal would be proposed but its logs have no `source`, the
prompt asks first: *"Do you make this at home?"*

### 4.3 Promotion of new dishes

A dish Habeat introduced (§7) is promoted to the repertoire when the user has
**cooked it twice and rated it ≥ 4/5** (or not rejected it). This is the adoption
loop: the repertoire grows from 20 to 30 dishes of the user's choosing.

### 4.4 Cold start

Repertoire mode switches on at **8 active dishes** (§12).

Below that — including a user who skipped onboarding entirely — they get the
current generator, but with the novelty rules from §7 applied to its output
(simple archetypes, `maxPrep` from the lowest cooking level). Whatever dishes
they do have are still placed first, within their rhythm; the generator only
writes the rest. §4.2 promotes their logged meals aggressively in the first two
weeks so the repertoire fills from real behaviour, and a generated dish they cook
twice is promoted like any new dish (§4.3). The generator is how the repertoire
grows past 8, not a separate mode the user is stuck in.

---

## 5. Tuning a dish

Tuning is the LLM's job, but it happens **once per dish and level**, and is
cached in `tunes[]`. Weekly plan generation then needs no model call for
repertoire slots at all.

| Level | What may change | Example — "Pasta bolognese" |
|---|---|---|
| **0 — as usual** | nothing | as they make it |
| **1 — portion** | quantities only; same ingredients | 120 g → 90 g pasta, sauce unchanged |
| **2 — composition** | ratios, one addition, one like-for-like swap | + grated courgette in the sauce, lean mince, oil measured (1 tbsp) |
| **3 — upgraded** | a bigger swap, still recognisably the same dish | half pasta / half lentils, side salad |

Rules for the tuning prompt:

- **Same dish.** If the user would not call the result by the same name, it is
  not a tune — it is a new dish and belongs to the novelty budget.
- **At most two changes per level step.** A level-2 tune that changes five things
  is a new recipe in disguise.
- **No new techniques, no new equipment.**
- **Every change is written as a diff from `usual`**, so the client can render
  "same as always, except…".

A user who rejects a tune drops that dish back one level; two rejections at the
same level pin it there (`tuneCeiling`). Accepting a level lifts the ceiling to
it — the user asked for it. The Brain never moves a dish past the level the user
tolerates.

### 5.1 What the model is trusted with

The model proposes; `validateTunes` (`src/repertoire/repertoire.tuner.ts`)
decides what is kept. A tune is dropped when:

- its stated calories differ from `4p + 4c + 9f` by more than 15%;
- it lists more than `2 × level` changes — a new recipe, not a tune;
- it is level 1 and uses an ingredient the usual recipe doesn't have;
- its calories leave the diet path's range relative to usual (lose weight:
  60–100%; gain muscle: 90–130%; keto: 70–115% and carbs may not rise;
  default: 70–110%);
- it breaks a dietary restriction or adds a disliked food the usual recipe
  didn't already contain;
- the level beneath it was dropped — levels must be contiguous.

Tunes depend on the dish and the diet path, **not** on this week's calorie
target; portion-scaling to the target is the balancer's job (§6). So tunes are
cached per dish and regenerated only when the user's path changes (or on an
explicit `force`). A re-tune where nothing survives validation keeps the old
tunes rather than wiping levels the user already accepted.

For a dish captured from logs there is no recipe. The model reconstructs one
matched to the logged nutrition; it is stored as `usual.ingredients` only if its
own numbers add up, and tunes are always judged against the **logged**
nutrition, which is evidence, rather than the reconstruction, which is a guess.
With no usable recipe no tune is kept — every tune is shown as a diff, and there
would be nothing to diff against.

---

## 6. Weekly balancing

With the repertoire as the content, building a week becomes a **selection
problem**: which dishes on which days, at what portion scale, so the *week*
lands on target. This is deterministic code, consistent with the generator's
existing "code owns the skeleton" design, and it is pure and unit-testable.

### 6.1 Inputs

- Active slots per day (`computeActiveSlots`), and each slot's calorie share
  (`slotCalorieShares`).
- Daily calorie and macro targets (`calculateTargetCalories`, `calculateMacros`).
- The repertoire: active dishes, their `currentTuneLevel` nutrition, `slots`,
  `rhythm`.
- The Brain's decision for the week: `noveltyBudget`, `maxTuneLevel`, and any
  `targetDishIds` (§7).
- Workout days (`DaySpec.hasWorkout`).
- Seed: `planSeed(userId, weekStartKey)` so the same week reproduces.

### 6.2 Constraints

Hard:

- A dish only fills slots listed in its `slots`.
- Dietary constraints (already filtered).
- A dish appears at most `ceil(perMonth / 4) + 1` times per week — no more
  often than the user already eats it, plus one. `perMonth` is `usualPerMonth`
  when the user stated it, else `observedPerMonth`.
- The same dish is not on consecutive days, **unless** `leftoversFriendly`, in
  which case day+1 lunch is a legitimate — and encouraged — slot for it. Cooking
  once and eating twice is exactly the low-effort behaviour we want.
- Portion scale stays within **0.75×–1.15×** of the tuned portion. Beyond that
  the plate looks wrong, and the user will ignore the number.

Soft (scored):

- Each day within ±10% of the calorie target; the **week** within ±5%.
- Weekly protein at or above target; fibre as a tiebreaker.
- Prefer dishes not cooked recently (`lastCookedOn`) — rotation, not novelty.
- Heavier dishes on workout days.
- Food-group spread across the week (see §9 on `low-variety`).

### 6.3 Algorithm

Greedy fill, then local search. The repertoire is small (~25 dishes × ~28
slots), so this runs in milliseconds.

```
reserve novelty slots        // §7: pick N slots for new dishes, spread across the week
for each remaining slot, hardest-first (dinner, then lunch, breakfast, snack):
    candidates = dishes eligible for slot under hard constraints
    pick candidate minimising  Δ(day target) + rotationPenalty + seededJitter
    set portionScale to close the day's remaining gap, clamped to [0.75, 1.15]

repeat until no improvement or 200 iterations:
    try swapping two slots' dishes, or one slot's dish for an unused candidate
    keep the swap if weekly score improves and hard constraints still hold

if a day is still > 10% off target:
    raise that day's tune level by one for the heaviest dish (≤ maxTuneLevel)
    re-score
```

The last step matters: when the repertoire alone cannot hit the target, the
answer is a slightly more tuned version of a familiar dish, not a new recipe.

**Gap-fill slots.** A slot with no eligible dish under the hard constraints —
usually because the repertoire is small, or has nothing for that slot (e.g. no
breakfasts) — becomes a gap-fill slot: `kind: "new"` with `gapFill: true`.
Gap-fill is not novelty the Brain chose; it is the repertoire running out. So it:

- does **not** draw on the Brain's `noveltyBudget`;
- is restricted to the simplest archetypes and the user's lowest prep ceiling;
- prefers ingredients already on the week's shopping list;
- is weighted lower in change cost (§8).

Gap-fill slots shrink on their own as the repertoire grows: each one the user
cooks twice is promoted (§4.3) and becomes an eligible dish next week.

### 6.4 Output

The skeleton's `PlannedMeal` becomes a union:

```ts
type PlannedMeal =
  | {
      kind: "repertoire";
      slot: MealSlot;
      dishId: string;
      tuneLevel: 0 | 1 | 2 | 3;
      portionScale: number;
      calories: number;
      leftoverOf?: string;       // dishId cooked the day before
    }
  | {
      kind: "new";
      slot: MealSlot;
      archetype: string;
      protein: string;
      flavour: string;
      calories: number;
      replacesDishId?: string;   // Brain-targeted replacement, §7
      gapFill?: boolean;         // repertoire had nothing eligible, §6.3
    };
```

Only `kind: "new"` slots go to the model. For a user in the first stages that is
0–1 slots out of ~28, so plan generation also becomes **faster and cheaper**.

---

## 7. The novelty budget and the Brain

The Brain already decides *how hard to push* this week. The repertoire gives
that decision a concrete, measurable form. `BrainDecision` gains:

```ts
noveltyBudget: number;        // new dishes allowed this week
maxTuneLevel: 0 | 1 | 2 | 3;  // how far familiar dishes may be tuned
targetDishIds: string[];      // repertoire dishes the active intervention is about
```

Defaults per stage:

| Stage | New dishes / week | Max tune level | From the repertoire |
|---|---|---|---|
| Awareness | 0 | 1 (portion only) | ~100% |
| Preparation | 0–1 | 1 | ~95% |
| Replacement | 1–2 | 2 | ~85% |
| Reinforcement | 1–2 | 3 | ~85% |
| Maintenance | user-chosen (0–3) | 3 | user-chosen |

These follow the Brain's existing rules rather than adding new ones:

- **Holding is the default.** The budget only rises when the stage advances,
  which requires `successRate ≥ 0.75` and `userFeedback ≥ 0.6`.
- **Stepping back is a correction.** If adherence drops, the stage steps back and
  the budget and tune level step back with it.
- **Change one thing.** At Replacement, the intervention targets a *specific*
  repertoire dish (`targetDishIds`) — "the late Tuesday pizza" — and the new dish
  in that slot carries `replacesDishId`. Everything else stays familiar.

The intervention definitions in `brain/behavior/intervention.definitions.ts`
gain a way to name a dish-level target, so a pattern like late-night eating can
resolve to "make the dish you already eat at 21:30 a lighter tune" before it ever
resolves to "eat something new".

---

## 8. Change cost

"Too demanding" needs to be a number, or it will be argued about forever. Every
generated week gets a **change cost** relative to the user's baseline:

```
changeCost =   3 × newDishes
             + 1 × tuneLevelSteps          // sum over slots of (tuneLevel − 0)
             + 0.5 × newShoppingItems      // ingredients not in any active repertoire dish
             + 0.1 × extraPrepMinutes      // above the user's usual, summed over the week

gapFillCost =  1 × gapFillSlots            // §6.3, plus their shopping/prep terms
```

Gap-fill is priced separately because the balancer cannot trade it away: with 8
dishes, a week may need 15+ gap-fill slots no matter what the Brain decides.
Folding that into `changeCost` would put every small-repertoire user over the
Awareness cap and force the balancer to strip out the tunes and new dishes it
*can* control. So the stage cap applies to `changeCost` only; `gapFillCost` is
recorded next to it and tracked as its own metric — it should fall week over
week as the repertoire grows. If it doesn't, capture (§4) is failing.

Each stage has a cap on `changeCost` (initial values, to be calibrated against
adherence data):

| Stage | Max change cost |
|---|---|
| Awareness | 10 |
| Preparation | 15 |
| Replacement | 25 |
| Reinforcement | 30 |
| Maintenance | 35 |

The balancer rejects any week over the cap, reducing the novelty budget first
and tune levels second. The cost is stored on the plan, so we can plot adherence
against it and find the real breaking point per user rather than guessing.

`newShoppingItems` is computed against the existing shopping-list ingredient keys
(`utils/ingredient-key.ts`), so it is the same notion of "an ingredient" that the
shopping list already uses.

---

## 9. What changes in existing code

| Where | Change |
|---|---|
| `generator/meal-plan-prompt.ts` | `buildMenuSkeleton` becomes the fallback for `kind: "new"` slots only. New `buildRepertoireWeek` (§6) runs first. The prompt only describes new slots. |
| `generator.service.ts` → `getRecentMealNames` | Exclusions apply to **new** slots only — a new dish should not repeat last week's new dish. Repertoire dishes are governed by rotation (§6.2), not exclusion. |
| `behavior/behavior.prompts.ts:405` | Remove the "rather than repeating them exactly" line. Reliable dishes are repertoire candidates (§4.2), not something to move away from. |
| `behavior/behavior-checks.ts` → `low-variety` | Repeating dishes is not a problem; eating from a narrow **nutritional** range is. *Done in step 1:* fires only on fewer than 8 distinct dishes over at least 20 logged meals. *Later:* redefine it on food-group spread across the week (vegetables, legumes, fish, whole grains, fruit) once logged meals carry ingredients into the summary. A user with 20 dishes that cover the groups should never trip it. |
| `utils/helpers.ts` → `enrichPlanWithFavoriteMeals` | Superseded. Explicit favourites become repertoire dishes with `source: "manual"`; the post-hoc replacement is removed once §6 ships. |
| `brain/decision/brain-state.types.ts` | `BrainDecision` gains `noveltyBudget`, `maxTuneLevel`, `targetDishIds`. |
| `brain/decision/decision.engine.ts` | Sets the three fields above from stage and intervention. |
| `plan/plan.model.ts` | Stores `kind`, `dishId`, `tuneLevel`, `portionScale` per meal, and `changeCost` per plan. |
| `plan/plan.controller.ts` (replace meal) | "Swap" defaults to another repertoire dish for that slot, portion rebalanced; "Try something new" is the secondary option. A swap out of a new dish back to a familiar one is a signal, not a failure — it feeds `userFeedback`. |

---

## 9a. Why code places the dishes, not the model

The outline can name a dish and tell the model to cook it as the person makes
it. In a real week that asked for nine of a user's own dishes, none came back:
"Pasta with tomato and basil" was returned as "Garlic Tomato Beef Pasta".

A dish the user gave us is already known in full — ingredients, nutrition, prep
time — so there is nothing for the model to work out. Code places those meals
(`generator/own-dishes.ts`) and the prompt lists them under "do not plan these
or a close variant", which is the one thing the model is needed for here:
keeping the rest of the week clear of them.

---

## 10. What the user sees

- **The plan reads as their week.** "Mon dinner: *your* chicken soup — same as
  always, a bit less noodles, add the carrots back in."
- **Every tune is a visible diff** from how they make it, never a silent rewrite.
- **New dishes are labelled** as such, one or two a week at most, with the reason
  ("to replace the late-night pizza on busy Tuesdays").
- **"My dishes"** is a first-class screen: the repertoire, what level each dish is
  tuned to, and dishes promoted from new ones. This is where progress is
  visible — the list of go-to dishes getting better over time.

---

## 11. Measuring whether it works

Primary:

- **Week-4 and week-8 retention**, repertoire users vs the current generator.
- **Planned meals actually cooked** (share of plan slots with a matching log).

Secondary:

- **Swap rate** per slot kind — a high swap rate on new slots means the budget is
  too high; on repertoire slots it means the tune level is too high.
- **Change cost vs adherence** — calibrates the caps in §8.
- **Repertoire growth** — dishes promoted per month, and weeks from sign-up to
  the 8-dish threshold.
- **Gap-fill share** — `gapFillCost` per week; should trend to zero.
- **Nutrition outcome** — weekly calories/protein vs target. The bet is that a
  75%-optimal plan followed beats a 100%-optimal plan abandoned; this is the
  metric that checks the bet.

---

## 12. Decisions

- **Household cooking → the user's portion only.** Habeat tunes what the user
  eats, not what the household eats. It is the one thing fully in the user's
  control, and it keeps the plan from quietly becoming a family diet. Tunes to
  the dish itself must still work as a shared meal (§3).
- **Takeaway and eating out → not repertoire dishes.** The repertoire is what the
  user cooks. Ordered and eaten-out meals are never captured (§4.2), never tuned
  and never planned. Takeaway stays where it already lives: as a behaviour,
  detected by P08 and handled through the Brain's interventions — not as content
  the plan schedules.
- **Minimum repertoire → 8 active dishes; the generator fills the gaps.** Below
  8, the balancer cannot cover a week without repeating dishes beyond the user's
  own rhythm, so repertoire mode stays off and the plan is built as in §4.4.
  Between 8 and a full week's worth, repertoire mode is on and slots the
  repertoire cannot fill become gap-fill slots (§6.3). The threshold is
  deliberately low: a user with 8 dishes should see them in their plan, not wait
  until they have 25.

## 13. Open questions

- **Portion accuracy.** Estimated portions for home dishes will be wrong by
  20–30%. Is a one-time "how much do you usually eat" photo enough, or do we need
  a calibration week of logging?
- **Unhealthy staples.** Some repertoire dishes can't be tuned into a reasonable
  place (instant noodles five nights a week). They stay in the repertoire and
  become the Brain's `targetDishIds` at Replacement — never silently dropped.

---

## 14. Rollout

Each step ships independently and is useful on its own.

1. **Stop fighting repetition.** *(Implemented.)* Reliable dishes are planned
   as the same dish (`behavior.prompts.ts`); last week's exclusions only cover
   dishes the user did not eat at home (`generator/recent-meals.ts`, read from
   DailyProgress, since `done`/`source` never reach the plan); `low-variety`
   fires on a narrow rotation, not on repeats. No new data model.
2. **Repertoire model + passive capture** (§3, §4.2). *(Implemented:*
   `src/repertoire/` — `GET /repertoire`, `GET /repertoire/candidates`,
   `POST /repertoire/candidates/:key/accept|decline`, `PATCH /repertoire/:id/status`.
   Dietary-constraint pausing is not yet applied.*)* Starts filling from existing
   logs with no UI beyond a confirmation prompt.
3. **Onboarding capture** (§4.1). *(Implemented:* `POST /repertoire` and
   `POST /repertoire/bulk`, with `repertoire.resolver.ts` turning a typed name
   into a recipe and nutrition estimate; client step `MyDishesStep.tsx` after
   the cooking-level question. The "My dishes" management screen is not built.*)*
4. **Tuning** (§5), cached per dish. *(Implemented:* `POST /repertoire/:id/tune`,
   `POST /repertoire/:id/tunes/accept|reject`. Tunes are generated on request;
   nothing tunes dishes in the background yet.*)*
5. **Weekly balancing** (§6). *(Partly implemented:* `generator/own-dishes.ts`
   places ~40% of the week's mains from the user's own dishes — respecting each
   dish's slots, their own rhythm and no two days running — portioned to the
   slot. The model is told to keep clear of those dishes rather than asked to
   cook them: briefed, it drifted off all nine of one user's dishes. Still to
   do: choosing dishes to hit the week's macros, `changeCost`, and the flagged
   comparison.*)*
6. **Brain integration** (§7–8): novelty budget, tune level and dish targets
   driven by stage.
7. Retire `enrichPlanWithFavoriteMeals`.
