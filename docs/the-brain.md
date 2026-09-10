# The Habeat Brain

The Brain is the single decision-maker in Habeat. It watches how someone
actually eats, decides which one behaviour is worth working on, decides how
hard to push on it this week, and hands the meal generator one instruction.

Everything that shapes a meal plan goes through it. That is the point: before
the Brain existed, two systems independently decided what a user needed, and
nothing arbitrated when they disagreed.

- **Code:** `src/brain/`
- **API:** `GET /brain/state`, `POST /brain/analyze`, `GET /brain/planner-context`, `GET /brain/catalogue`
- **Tests:** `test/unit/brain/` (69 tests)
- **LLM agents:** two, neither of which makes the decision — see §2

---

## 1. Why it exists

A meal log says *what food was involved*:

```json
{ "meal": "Pizza", "time": "21:30" }
```

That is not enough to change anything. The Brain wants *what happened*:

```json
{
  "type": "meal_logged",
  "mealType": "dinner",
  "timestamp": "2026-09-08T21:30:00",
  "context": { "feeling": "stressed", "hunger": 8, "planned": false, "energy": 3, "stress": 8 }
}
```

From enough of the second kind you can discover something the first kind can
never tell you: *dinner after 21:00 happens on high-stress, low-energy days.*
That is a behaviour, and behaviours are what Habeat is for.

---

## 2. The loop

Two LLM agents exist in this system, and **neither of them makes the decision.**
The spine down the middle is ordinary deterministic code. The agents sit at the
edges: one advises it, one writes prose for it.

```
              USER DATA — the collections other modules own
        DailyProgress  ·  MoodEntry  ·  MealMoodCorrelation
              (meals, wellness, habits, workouts)
                             │
              ┌──────────────┴──────────────┐
              ↓                             ↓
      Behavior Events                 Behavior Summary       ── no model ──
      event.projector.ts              behavior-summary.ts
      ── no model ──                  + behavior-checks.ts
              ↓                             ↓
      Pattern Engine            ╔═══════════▼═══════════════════════════╗
      pattern.engine.ts         ║ ①  BEHAVIOUR ANALYST       ▓▓ LLM ▓▓  ║
      ── no model ──            ║    behavior-analyst.agent.ts          ║
              │                 ║    gemini-2.0-flash                   ║
              │                 ║                                       ║
              │                 ║    Proposes: patterns, directives,    ║
              │                 ║              plannerBrief             ║
              │                 ╚═══════════╤═══════════════════════════╝
              │                             ↓
              │                    validateAnalysis()  ← drops anything the
              │                    ── no model ──         checks can't support
              │                             │
 P01 P04 P08  │                             │  advisory only
 + evidence   │                             │  (null on failure)
              ↓                             ↓
      ┌──────────────────────────────────────────┐
      │            DECISION ENGINE               │  decision.engine.ts
      │  · rank score × confidence               │  stage.engine.ts
      │  · commit to ONE pattern                 │  ── no model ──
      │  · advance / hold / step back            │
      │  · RECONCILE ① against the stage         │  ← the arbitration
      └───────────────────┬──────────────────────┘
                          ↓
                     BRAIN STATE                    brain_states
               active pattern + stage               ── the source of truth ──
                  + intervention
                          ↓
                renderPlannerContext()              brain.prompt.ts
                          ↓                         ── no model ──
                     PLANNER BRIEF              MENU SKELETON
                  what to work on, and        archetype · protein ·
                   how hard to push            calorie budget, per
                          │                    meal, seeded        ── no model ──
                          │                    │             meal-plan-prompt.ts
                          │                    │             healthCalculations.ts
                          ↓                    ↓
         ╔════════════════▼════════════════════▼════════════════╗
         ║ ②  MEAL PLAN WRITER               ▓▓ LLM ▓▓          ║
         ║    generate.service.ts / streaming.service.ts        ║
         ║    gemini-2.5-flash → 2.5-pro → 2.0-flash …          ║
         ║                                                      ║
         ║    Chooses dishes and writes ingredients.            ║
         ║    Does NOT choose the shape of the week, the        ║
         ║    calorie target, or the behaviour worked on.       ║
         ╚════════════════╤═════════════════════════════════════╝
                          ↓
               enforceDietaryConstraints()          ← rejects + regenerates
               ── no model ──                          violating days
                          ↓
                  Personalized Week
                          ↓
                        User
                          ↓
                      New Data
                          ↺
```

### Why the decision is not made by a model

**① the analyst is advisory and constrained.** It returns `null` when
`GEMINI_API_KEY` is unset or the call fails, and the Brain carries on with the
deterministic half. What it does return passes through `validateAnalysis()`,
which drops any pattern that doesn't cite a check that actually fired, or that
falls below the confidence and occurrence floors. In its own words: *a model in
a bad mood can weaken the profile but cannot corrupt it.* Then the decision
engine reconciles whatever survives against the committed stage (§3).

**② the writer never decides anything behavioural.** By the time it is called,
the archetype, protein and calorie budget of every meal are already fixed by
`buildMenuSkeleton`, and the behavioural instruction is fixed by the Brain. It
chooses dishes and writes ingredients. Code owns the skeleton; the model owns
the cooking. Its output is then checked again by
`enforceDietaryConstraints()`, which regenerates any day containing something
the user cannot eat and discards the plan rather than persisting a violation.

There is a third model call on the meal side — `generateMealSuggestions`, for
single-meal swaps. It is not in this loop: it answers a request the user just
made, rather than deciding anything about their week.

**Everything in `src/brain/` is model-free.** The projector, the pattern
engine, the stage engine, the decision engine and the prompt renderer contain
zero LLM calls — a detection is a claim about someone's life, so it has to be
reproducible from its own evidence and pinned by a test.

---

## 3. One brain, not two

The server already had `src/behavior/` — an LLM behaviour analyst that
aggregates a month of logs into a `BehaviorSummary`, reasons over it, and
produces `planningDirectives` plus a written `plannerBrief`. It was calling the
meal generator directly.

The Brain does **not** replace it and does **not** duplicate it. It absorbs it.

```
BEFORE                                AFTER

  ▓ LLM ▓ analyst ──┐                   BrainService
                    ├──→ ▓ LLM ▓          ├── PatternEngine   no model
  pattern work ─────┘     generator       ├── StageEngine     no model
                                          ├── DecisionEngine  no model
  two briefs reach the model,             └── ▓ LLM ▓ analyst ── validated,
  nothing arbitrates between them                                advisory
                                                  │
                                                  ↓
                                            BRAIN STATE
                                                  │
                                                  ↓
                                          one brief ──→ ▓ LLM ▓ generator
```

`BehaviorService` is now an **organ** of the Brain. `BrainService` is the only
thing on the planning path that calls it, and `generator.service.ts` imports
`BrainService` and nothing else. That single import is what makes this one brain
rather than two.

### The arbitration

The analyst reasons over a month of history. The Brain tracks where the user is
on a change ladder *right now*. They can genuinely disagree, and the interesting
case is when they do.

Say the analyst concludes **"reduce late eating"** while the Brain has the user
at the **awareness** stage for exactly that pattern. Awareness explicitly means
*do not restrict anything yet* — the user has only just been shown the pattern
exists. Restricting now is how an intervention fails and the user concludes the
problem is them.

`DecisionEngine.reconcile()` resolves it: the staged decision wins, the
directive is switched off, and a note explains why.

```
directives.reduceLateEating = false
notes += "Late eating is the active pattern but the user is at an early stage:
          the plan makes dinner more satisfying rather than restricting evening food."
```

The staged decision wins because it is the one measuring whether the user can
actually act on it.

---

## 4. Behaviour events

`src/brain/events/event.projector.ts`

The Brain has **no write path of its own**. Every event is projected from a
collection some other part of Habeat already owns:

| Source | Produces |
|---|---|
| `DailyProgress.meals[*].done` | `MEAL_LOGGED`, `SNACK_LOGGED` |
| `DailyProgress` planned-but-untouched | `MEAL_SKIPPED` |
| `DailyProgress.workouts[*].done` | `WORKOUT_COMPLETED` |
| `MoodEntry` | `WELLNESS_LOGGED`, and context on nearby meals |
| `DailyProgress.meals[*].source` (preferred), `MealMoodCorrelation.source` | `TAKEAWAY_LOGGED` |

One system of record, so the Brain can never quietly disagree with the tracker
the user is looking at.

### Four rules the projection keeps

**Idempotence.** Every event carries a `fingerprint` derived from the record it
came from (`meal:2026-09-01:dinner:abc123`). Re-analysing an overlapping window
updates in place. Without this, every pattern's evidence count would double on
each run.

**Absent is not zero.** A meal with no recorded source does not count as home
cooking. A meal with no mood check-in nearby gets no `feeling`. A default here
would let the Brain report a calm dinner it never observed.

**Exact vs. inferred time.** A meal without a `completedAt` is placed at its
slot's typical hour and flagged `timestampIsExact: false`. Any claim about time
of day *must* ignore those, or the detector is observing a placeholder it
invented itself. `P04` enforces this.

**Local time, always.** Timestamps are built from date parts, never
`new Date("2026-09-01")` — that is UTC midnight, which is the previous evening
for anyone behind Greenwich, and it silently moves late meals into the wrong
day. This was flagged as a known gap in the original design; it is fixed here
rather than inherited.

**Today is not over.** Untouched meals on the current date are not skips.
Counting them would tell a user at 9am that they had already missed lunch.

---

## 5. Pattern detection

`src/brain/patterns/pattern.engine.ts`

Every detector is **deterministic and pure** — same events in, same patterns
out, no model call. A detection is a claim about someone's life, so it has to
be reproducible, testable, and explainable from its own evidence. An LLM
reasons *over* these findings later; it does not get to invent them.

| ID | Pattern | Fires when | Guard |
|---|---|---|---|
| `P01` | Irregular meals | Most tracked days have < 3 meals | Needs ≥ 5 observed days |
| `P02` | All-or-nothing days | A missed meal usually takes the rest of the day | Only days that *could* recover; ≥ 3 slip days, ≥ 2 collapses |
| `P04` | Late-night eating | Timed meals cluster at/after 21:00 | **Exact timestamps only**, ≥ 3 late meals |
| `P08` | Frequent takeaway | Takeaway meals per week trend high | ≥ 3 takeaway events |

Three rules every detector keeps:

1. Below the pattern's `minimumDataDays`, return **null** — not zero.
2. Time-of-day claims use only exact timestamps.
3. Evidence is a sentence the user could check against their own memory:
   *"5 meals or snacks were logged after 21:00, across 4 nights."*

Nothing below a score of `0.35` is reported at all. Weak signal read as a
finding is how a brain starts telling users things about themselves that
aren't true.

### Why P02 is not just P01 again

They look similar and are not. `P01` is about *meals being missed*; `P02` is
about *what happens next*. Someone who misses breakfast and eats a normal lunch
has had a bad morning. Someone whose lunch and dinner also stop has written the
day off — and the two want opposite responses. The answer to the first is more
structure; the answer to the second is **less** effort, because the thing that
failed was the cost of restarting.

That is why `I10` (awareness for P02) tells the planner to leave the rest of
the day *unchanged and familiar*, and explicitly forbids compensating with
larger or stricter meals. Making up for a missed meal is what teaches a day to
be all-or-nothing in the first place.

Both can fire for the same user, and the decision engine picks one on
`score × confidence`. On a heavy all-or-nothing week P02 usually wins, because
P01's denominator includes every thin day while P02's includes only days that
actually offered a chance to recover. Worth watching in real data: where the
two are close, P01's `× 1.2` multiplier can edge it ahead of the sharper read.

### Score and confidence are separate

Deliberately two axes. **Score** is how strongly the behaviour shows up.
**Confidence** is how much data stands behind that reading. A pattern seen
twice in three days and one seen twice in thirty are not the same claim, and
collapsing them into one number is a lie.

The decision engine ranks by `score × confidence`, so a strong reading on thin
data does not outrank a solid one.

### The status ladder

`src/brain/schemas/behavior-pattern.schema.ts`

```
DISCOVERED → CONFIRMED → ACTIVE → IMPROVING → RESOLVED
                  ↓
                STABLE
```

A pattern is **not acted on the first time it is seen**. One sighting inside a
single window is as likely to be a bad week as a habit, so `DISCOVERED` only
becomes `CONFIRMED` on a second independent run.

`IMPROVING` is measured against `baselineScore` — where the user started — not
against last week, because week-to-week noise would otherwise read as progress.

A pattern that stops being detected is marked `RESOLVED` **explicitly**, so the
decision engine can stop working on it and the user can be told it improved.
Silence is not the same as resolution.

---

## 6. Stages

`src/brain/behavior/stage.engine.ts`

A stage is **not a week number**.

```
Awareness → Preparation → Replacement → Reinforcement → Maintenance
```

but really:

```
Awareness
   ↓
Preparation
   ↓
Preparation   ← the intervention wasn't working
   ↓
Replacement
```

| Condition | Result |
|---|---|
| `successRate ≥ 0.75` **and** `userFeedback ≥ 0.6` | advance |
| `successRate < 0.35` **and** `difficulty > 0.5` | **step back** |
| anything else | hold, and improve the intervention |

**Holding is the default, not the exception.** A brain that only ever advances
turns every plateau into escalating demands. One that advances on a timer hands
someone a replacement task before awareness has landed.

**Stepping back is a correction, not a punishment.** If a hard intervention is
failing, the intervention was mis-set. Leaving the user to keep failing it is
how they conclude the problem is them.

Note that results alone are not enough to advance: hitting the metric while
hating the plan is not progress worth compounding, because the next stage asks
more and it will break.

---

## 7. Interventions

`src/brain/behavior/intervention.definitions.ts`

Nine interventions, three per pattern, laddered by stage.

```
P01 Irregular meals     I01 awareness → I02 preparation → I03 replacement
P02 All-or-nothing days I10 awareness → I11 preparation → I12 replacement
P04 Late-night eating   I04 awareness → I05 preparation → I06 replacement
P08 Frequent takeaway   I07 awareness → I08 preparation → I09 replacement
```

The field that matters most is **`mealStrategy`** — it is the sentence the meal
generator receives. Everything upstream exists to choose the right one, so each
is written as an instruction to the planner, not as advice to the user:

> `I05` — *"Prioritize satisfying, easy-to-prepare dinners."*
> `I08` — *"Prioritize meals requiring minimal preparation."*

`difficulty` (0–1) feeds the stage engine: a failed easy intervention means
something different from a failed hard one.

Reinforcement and maintenance have no material of their own yet, so
`interventionFor()` holds the last defined intervention rather than returning
nothing. A user who has got as far as maintaining a change should not have the
Brain go quiet on them — that is exactly when a change unravels. A test pins
this for every pattern at every stage.

---

## 8. The decision

`src/brain/decision/decision.engine.ts`

Two rules do most of the work.

**One pattern at a time.** A user given three things to fix changes none of
them. The Brain commits to the top-ranked pattern; the rest stay visible as
findings but do not shape the plan.

**Continuity beats novelty.** Once a pattern is being worked on it keeps
priority even if another edges ahead on score, until it resolves or the user
stops responding. Switching target weekly is how a plan stops feeling like it
is about the person using it.

A newly chosen pattern **always starts at awareness**. Dropping someone
straight into "replace the behaviour" for a pattern they have not been told
about is the most reliable way to make an intervention fail.

Every decision carries a `rationale`, so the choice is auditable:

> `"Continuing P04 at preparation — score 0.71 at confidence 0.80, success rate 62%. Holding the stage and improving the intervention."`

### Measuring success

`BrainService.measureSuccess()` judges the last 7 days against the active
intervention's metric, from the **same event stream the detectors use** — so
success is measured on what happened, not on self-report.

| Pattern | Success is |
|---|---|
| `P01` | share of days that reached 3+ meals |
| `P02` | share of slip days that recovered (a meal after the missed one) |
| `P04` | share of timed meals before 21:00 |
| `P08` | inverse of takeaway share |
| (awareness, any) | simply that the user kept logging |

It returns **null** when there is nothing to judge — fewer than 3 days of data,
or no timed meals for `P04`. The decision engine reads null as *hold the stage*,
never as failure.

### Confidence

Graded on **observed days**, not event count — a single heavy logging day
produces plenty of events and tells you almost nothing about how someone lives.

| Grade | Requires |
|---|---|
| `insufficient` | < 5 observed days |
| `low` | ≥ 5 days |
| `medium` | ≥ 10 days and best confidence ≥ 0.5 |
| `high` | ≥ 21 days and best confidence ≥ 0.8 |

At `insufficient`, `renderPlannerContext()` returns **null** and the generator
gets no behavioural guidance at all. An unreliable state is worse than none:
the model will happily build a whole week around a pattern seen twice.

---

## 9. Reaching the meal generator

`src/brain/brain.prompt.ts` renders `BrainState` into the brief.

Ordering is deliberate — the committed instruction comes **first**, because
when the analyst's prose and the active intervention pull in different
directions, the model follows whichever it read first.

```
ACTIVE BEHAVIOUR — Late-night eating (P04), stage: preparation.
MEAL STRATEGY (this is the requirement, not a suggestion): Prioritize
satisfying, easy-to-prepare dinners.
This week is judged on: Planned dinner completed on at least 4 days.
STAGE RULE — preparation: introduce one predictable, low-effort anchor.
Change one thing, not the whole week.
Observed: 5 meals or snacks were logged after 21:00, across 4 nights.
PLANNING CONSTRAINTS: keep prep at or under 25 minutes; simplify: breakfast.
COACH'S NOTES on this user, from a month of their logs:
<the analyst's brief>
```

The **stage rule** is what stops the model reaching for restriction the moment
it reads "late-night eating" — at awareness, restriction is precisely the wrong
move, and the model has no way to know that without being told.

In `generator.service.ts`:

```ts
const [behaviourContext, behaviourMaxPrep] = await Promise.all([
  this.brainService.buildPlannerContext(userId).catch(() => null),
  this.brainService.effectiveMaxPrepMinutes(userId).catch(() => null),
]);
```

Both `.catch(() => null)`. **A plan always generates.** A cold Brain, a thin
window, or an unavailable analyst degrades the plan's personalisation — it
never blocks the user from getting a week.

---

## 10. When it runs

Analysis **never happens on a request path**.

- **Nightly**, at `REFRESH_HOUR + 1` — an hour after the behaviour analyst, so
  each night's decision is made over a freshly written profile rather than
  yesterday's.
- **Background refresh** when `buildPlannerContext` finds state older than
  `STATE_REFRESH_HOURS` (20h). The caller gets what is currently known and does
  not wait.
- **On demand** via `POST /brain/analyze`, for debugging.

`findDueUserIds()` only returns users with **recent logged activity**. A user
who has not opened the app has no new behaviour to read, and re-running over an
unchanged window produces yesterday's decision at the cost of a full projection.

---

## 11. Data model

| Collection | Owner | Holds |
|---|---|---|
| `behavior_events` | Brain | Projected events. Unique on `(userId, fingerprint)`. |
| `behavior_patterns` | Brain | Per-user pattern history, status, baseline. Unique on `(userId, patternId)`. |
| `brain_states` | Brain | Active behaviour, stage, rendered planner context. One per user. |
| `behavior_profiles` | Analyst organ | The LLM analysis. Read by the Brain. |
| `dailyprogress`, `moodentries`, `mealmoodcorrelations` | Other modules | **Read-only** to the Brain. |

`BrainState` is kept separate from `BehaviorProfile` because they answer
different questions. The profile describes *how someone eats*. The state records
*what Habeat is doing about it, and since when* — which is the part that has to
survive across runs for staging to mean anything.

---

## 12. The takeaway data path

`P08` (Frequent takeaway) needs to know where food came from. That signal used
to stop at the device: the client captured it into `patternStore` — explicitly
device-local, capped at 60 days — and no schema on the server had a field for
it. The pattern could never fire.

It is now wired end to end.

```
MealSourcePicker  (ChangeMealModal — the "log what I actually ate" flow)
        ↓  newMeal.source
PUT /plan/:userId/meal-replace/:planId
        ↓  MealDto.source          ← must be declared, see below
plan.service.ts  mealData.source
        ↓
weeklyPlan embedded meal   +   DailyProgress meal snapshot
        ↓
extractLoggedMeals → LoggedMeal.source
        ↓
event.projector.ts → TAKEAWAY_LOGGED
        ↓
PatternEngine → P08 → intervention I07/I08/I09
```

A second path exists for the tick itself: `PUT /progress/meal/:userId/:mealId`
accepts an optional `source`, and `MealMoodCorrelation` carries one too, which
`MealCheckIn` can populate. The projector prefers the meal's own snapshot value
and falls back to the correlation — the snapshot is stamped when the user
logged what they ate, the correlation is a reflection on it afterwards.

### Three things this path has to get right

**The ValidationPipe strips undeclared fields.** `main.ts` runs
`new ValidationPipe({ whitelist: true })`, and `ReplaceMealDto.newMeal` is a
`@ValidateNested()` `MealDto`. Anything not decorated on `MealDto` is removed
before the service sees it — the request looks accepted and the field silently
vanishes. `source` is declared there for exactly this reason. **Any new
per-occasion meal field needs the same treatment.**

**Source belongs to the occasion, not the dish.** In `replaceMeal` it is taken
from `newMeal`, never from `resolvedMeal`. The same Pad Thai is takeaway on
Friday and home-cooked on Sunday; the catalogue meal has no business
remembering either. This is also why `source` is not on `IMeal`.

**Un-ticking clears it.** `markMealCompleted` clears `source` alongside
`completedAt` when a meal is un-ticked. A meal that did not happen has no
source, and a stale one would let an undone takeaway keep counting toward P08.
On the way in, a tick with *no* answer leaves the existing value alone, so it
cannot erase a source given earlier when the meal was swapped in.

### Still worth doing

The tick does not *ask* where the food came from — it only accepts an answer if
one is passed. Today the question is asked in `ChangeMealModal`, which covers
the quick-log flow but not a plain tick on a planned meal. Adding the question
to `MealCheckIn`'s after-meal phase would raise the capture rate considerably;
the transport is already in place for it.

---

## 13. What the user sees

`src/brain/brain.view.ts` · `GET /brain/state` → `data.focus`

The internal vocabulary is clinical on purpose. "Replacement" is precise about
what the stage engine is doing, and `mealStrategy` — *"Prioritize satisfying,
easy-to-prepare dinners"* — is an instruction written at a model. Both are
correct, and neither belongs on a screen: one makes someone feel like a case
being managed, the other reads like being handed someone else's memo.

So every intervention carries a `userFacing` block alongside its planner
phrasing, and `brain.view.ts` holds the stage labels. Both live server-side, so
what a stage *means* is defined once rather than re-invented by each screen.

| Internal | What the user reads |
|---|---|
| `awareness` | Getting to know it |
| `preparation` | Making it easier |
| `replacement` | Trying something new |
| `reinforcement` | Making it stick |
| `maintenance` | Keeping it going |

`getUserFacingState()` composes the `BrainFocus` object — pattern, stage,
evidence, and the two user-facing sentences — at request time rather than
storing it, so changing a wording updates every user immediately instead of
waiting for their next analysis run. It returns `null` when confidence is
`insufficient`, and the client shows a "still learning" state rather than an
empty card.

The Eating Patterns page (`src/pages/EmotionalEating.tsx`) leads with this,
then shows the score, chart and pattern table as the evidence behind it. The
card answers four questions in the order people actually ask them:

```
1. What is this about?        the pattern, named plainly
2. How do you know?           the evidence, verbatim and checkable
3. So what are you doing?     the intervention, in the second person
4. How will I know it works?  the success signal, no percentages
```

Client-side: `brainAPI.getBrainFocus()` → `useBrainStore` → `BrainFocusCard`.
The store distinguishes *not asked yet* from *nothing to work on*, because a
screen that only checks `focus` renders its empty state on every first paint —
which reads as "you have no patterns" to someone who does.

---

## 14. Extending it

**A new pattern:**

1. Add a `PatternDefinition` to `pattern.definitions.ts` — take the next free
   ID. IDs are permanent and stored on user documents; renumbering silently
   rewrites history.
2. Add a detector to `pattern.engine.ts`. Return `null` below
   `minimumDataDays`. Use exact timestamps for any time-of-day claim.
3. Add three interventions to `intervention.definitions.ts` — awareness,
   preparation, replacement — each with a `mealStrategy` the generator can act
   on **and** a `userFacing` block the screen can show (see §13). The type
   requires both, so this is not something you can forget.
4. Add a `measureSuccess` branch in `brain.service.ts`.

The catalogue tests will fail if a pattern has no intervention at some stage, or
an intervention references a pattern that does not exist.

**A new event source:** add it to `event.projector.ts` with a stable, unique
`fingerprint` prefix. Nothing else needs to change.

---

## 15. Test coverage

`test/unit/brain/` — 69 tests server-side, plus 17 client-side
(`BrainFocusCard.test.tsx`, `brainStore.test.ts`). All passing.

| File | Covers |
|---|---|
| `event-projector.spec.ts` | Projection, mood pairing, local-time handling, idempotent fingerprints, "today is not over", the full takeaway path including P08 firing from progress snapshots alone |
| `pattern-engine.spec.ts` | Each detector's fire and silence conditions, minimum windows, exact-timestamp guard, local-day grouping |
| `stage-engine.spec.ts` | Advance / hold / step back, ladder bounds, catalogue completeness |
| `decision-engine.spec.ts` | Single-target commitment, `score × confidence` ranking, continuity, resolution, **the analyst arbitration** |
| `brain-wiring.spec.ts` | Nest DI graph constructs |
| `BrainFocusCard.test.tsx` (client) | Evidence shown before the plan, planner phrasing never leaked to the UI, stage shown as rungs not a percentage |
| `brainStore.test.ts` (client) | "Not asked yet" vs "nothing to work on"; a fetch failure never becomes an empty state |

The tests worth reading first are the arbitration ones in
`decision-engine.spec.ts` — they pin the behaviour that makes this one brain
rather than two.
