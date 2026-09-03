# AI Agent Testing — simulated users for Habeat

A simulated person named **Sarah** uses the real Habeat frontend in a real Chromium
browser, decides what to do next with Gemini, and writes up what confused her.
Every click, every thought behind it, and every UX finding lands in MongoDB.

It is not a test suite. Nothing asserts. The output is **evidence about your product**:
where a distracted 31-year-old marketing manager gets stuck, gives up, or is delighted.

---

## 1. What you get

| Collection | One row per | Useful field |
|---|---|---|
| `ai_test_users` | simulated person | `currentDay` — where she is in the simulated week |
| `ai_sessions` | one app-opening | `finishReason`, `summary` (her memory of it) |
| `ai_actions` | one click/type/scroll | `reasoning` — *why she did it*, in her own words |
| `ai_observations` | one UX finding | `severity`, `sentiment`, `evidence`, `recommendation` |

The `reasoning` field is the point of the whole system. Read that first.

---

## 2. Prerequisites

1. **The Habeat frontend running and reachable.** Default `http://localhost:8080`.
   ```bash
   cd ../habeat-client && npm run dev
   ```
2. **The Habeat server running.** Default `http://localhost:5080/api`.
   ```bash
   npm run start:dev
   ```
3. **MongoDB** — whatever `MONGO_URL_LOCAL` / `MONGO_URL_PROD` already points at.
4. **A Gemini API key** with quota left. One session costs roughly
   `actions + 2` Gemini calls (one per decision, one summary, one analysis) —
   about 15–40 calls, 3–8 minutes wall clock.
5. **Playwright's browser binary** (once per machine):
   ```bash
   npx playwright install chromium
   ```

---

## 3. Environment variables

Add to `.env` (all of these are already in `.env.example`):

```bash
HABEAT_URL=http://localhost:8080   # the frontend the agent drives
GEMINI_API_KEY=...                 # required

# Optional
AI_AGENT_MODEL=gemini-2.5-flash    # decision + analysis model
AI_AGENT_HEADFUL=true              # open a visible browser so you can watch
AI_AGENT_SLOWMO=250                # ms delay per Playwright action, for watching
```

> `AI_AGENT_HEADFUL=true` is the single most useful setting the first time you run this.
> Watch one full session before you trust any of the output.

---

## 4. Setup — do this once

### Step 1 — Create Sarah as a real Habeat user

The agent logs in through the actual login form, so Sarah needs a real account
**with onboarding already completed**. Do it manually, in the browser, once:

1. Open `http://localhost:8080` → **Create Account**
2. Sign up as `sarah@habeat-test.com` with a password you choose
3. **Finish the whole registration flow** — profile, diet goal, restrictions,
   preferences. Stop when you land on the Today screen.

Why manually: the registration flow is multi-step and the agent's job is to
evaluate the *app*, not to fight through signup on every run. If you also want
signup evaluated, run the `firstVisit` scenario against a fresh account and watch
it headful.

### Step 2 — Register her with the agent system

```bash
curl -X POST http://localhost:5080/api/ai-agent/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sarah AI",
    "email": "sarah@habeat-test.com",
    "password": "the-password-you-just-used"
  }'
```

The password is stored in plaintext in `ai_test_users` — the browser types it into
the login form. **Only ever use a throwaway test account.**

This endpoint upserts by email, so re-running it just updates the password.

### Step 3 — Smoke test with one short session

```bash
curl -X POST http://localhost:5080/api/ai-agent/run \
  -H "Content-Type: application/json" \
  -d '{ "scenarioId": "quickLunch" }'
```

`quickLunch` is deliberately the shortest scenario (~9 actions). Watch the server
log — you should see a line per action with Sarah's reasoning:

```
[AgentService] 3/9 click "Today" — I want to see what I'm supposed to eat, this looks like the main screen
```

If that works, you are set up correctly.

---

## 5. Running sessions

### One scenario

```bash
curl -X POST http://localhost:5080/api/ai-agent/run \
  -H "Content-Type: application/json" \
  -d '{ "scenarioId": "browseRecipes" }'
```

`scenarioId` accepts either the key (`browseRecipes`) or the slug (`browse-recipes`).

### One whole day (2–4 sessions, in order)

```bash
curl -X POST http://localhost:5080/api/ai-agent/run-day \
  -H "Content-Type: application/json" \
  -d '{ "day": 3 }'
```

Omit `day` to use the user's `currentDay`. After the last session of the day,
`currentDay` advances — so calling `run-day` repeatedly walks her through the week.

### The full simulated week (~20 sessions, 1–2 hours)

```bash
curl -X POST http://localhost:5080/api/ai-agent/run-week \
  -H "Content-Type: application/json" \
  -d '{ "fromDay": 1, "toDay": 7 }'
```

Sessions run strictly one at a time — there is one browser and one Sarah.
All three endpoints return immediately and run in the background.

---

## 6. The simulated week

Day 1 is Monday. Each day is several separate app-openings with different intent,
because that is how people actually use a phone app.

| Day | Scenario key | What she came to do | Touches |
|---|---|---|---|
| **1 Mon** | `firstVisit` | Work out what this app is even for | landing, onboarding, navigation |
| | `generateFirstPlan` | Get a meal plan before the week runs away | plan generation |
| | `logMondayDinner` | Mark off what she actually ate | daily tracker, streaks |
| **2 Tue** | `quickLunch` | 15 minutes between meetings — what's for lunch? | speed to information |
| | `swapDislikedMeal` | Tonight's suggestion is something she won't eat | meal swap |
| | `waterAndSnack` | Log the crisps she wasn't supposed to eat | add snack, water |
| **3 Wed** | `stressfulDayMoodCheck` | Bad day, stress-ate, feels guilty | mindfulness, mood, tone |
| | `missedMealsCatchUp` | A day and a half behind on tracking | missed meals, tone |
| **4 Thu** | `checkProgress` | Is this actually working? | progress, analytics, streaks |
| | `exploreChallenges` | What are these coins, is it a gimmick? | challenges, gamification |
| **5 Fri** | `eatingOutTonight` | Dinner out — the plan isn't happening | flexibility, meal skip |
| | `favouriteAMeal` | Save the two meals that were genuinely good | favourites |
| **6 Sat** | `browseRecipes` | Free time, browsing food like a feed | recipes, discovery |
| | `cookAndLogRealMeal` | Cooked something off-plan, wants it recorded | custom meal, photo meal |
| | `socialShare` | Nosy about what other people post | social, privacy |
| **7 Sun** | `weeklyPlanning` | Sort the week so 20:00 decisions stop | weekly overview |
| | `shoppingListRun` | Leaving for the supermarket in 20 minutes | shopping list |
| | `setAGoal` | Commit to one small thing for next week | goals |
| | `reviewTheWeek` | Decide whether she keeps this app | weekly summary, retention |

List them live: `GET /api/ai-agent/scenarios`.

Each scenario carries a **mood**, an **energy level** and a **time budget**. The time
budget becomes the action limit (~3 actions per minute), so `quickLunch` really does
give up faster than `browseRecipes`. Low energy means fewer actions and an earlier exit.

---

## 7. Reading the results

```bash
# Recent sessions, newest first
curl http://localhost:5080/api/ai-agent/sessions | jq

# One session in full: actions with reasoning + observations
curl http://localhost:5080/api/ai-agent/sessions/<id> | jq

# Only the findings that should worry you
curl "http://localhost:5080/api/ai-agent/observations?severity=high&sentiment=negative" | jq

# Which features generate the most complaints
curl http://localhost:5080/api/ai-agent/report | jq
```

Straight from Mongo:

```javascript
// Her own account of each session — read this like a diary
db.ai_sessions.find({}, { day: 1, title: 1, finishReason: 1, summary: 1 }).sort({ startedAt: 1 })

// Where she got stuck: actions that failed
db.ai_actions.find({ success: false }, { day: 1, target: 1, reasoning: 1, url: 1 })

// High-severity problems across the whole week
db.ai_observations.find({ severity: "high" }, { feature: 1, description: 1, recommendation: 1 })
```

**How to read a session.** Go in this order:
1. `session.finishReason` — did she get what she came for, or run out of patience?
2. The `reasoning` on failed actions — that is where the app failed to communicate.
3. The observations — the write-up, with `evidence` pointing back at specific steps.

Treat `severity: high` + `sentiment: negative` as a bug report. Treat repeated failed
clicks on the same target as "this thing is not findable", not "the selector is wrong" —
Sarah is guessing from what is visible on screen, exactly like a user.

---

## 8. Sarah's memory

Sessions are not independent. Before each run, the last 3 completed session
summaries are loaded and put in the prompt as "what you remember from before today".
That is why day 4 behaves differently from day 1: she already knows where Progress
lives, and she remembers the thing that annoyed her on Tuesday.

The summary is written by Gemini at the end of each session and stored on
`ai_sessions.summary`. To give her amnesia, clear that field (or the collection).

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `MongoServerError: Command find requires authentication` | The dockerised mongo runs `mongod --auth`, but `MONGO_URL` has no credentials | Use `MONGO_URL=mongodb://root:rootpassword@localhost:27017/?authSource=admin` and restart the server. Note `MONGO_URL_LOCAL` is **not** read by the app |
| `Timeout ... input[type="email"]` during login | The login form is inside a modal that must be opened first | Already handled — the service clicks **Sign In** first. If it still fails, the landing page copy changed; update `BrowserService.login()` |
| Session ends after 1–2 actions | She is stuck on registration, or a blocking modal is up | Run with `AI_AGENT_HEADFUL=true` and watch |
| Every click fails | The app didn't render, or `HABEAT_URL` is wrong | Open `HABEAT_URL` yourself; check the client is running |
| `429` / quota errors in logs | Gemini rate limit | The rate limiter backs off automatically; set `AI_AGENT_MODEL=gemini-2.5-flash-lite` for cheaper runs |
| No observations saved | Analysis returned malformed enums, or the session had 0 actions | Check the log for "Dropped N malformed observation(s)" |
| She never finds a feature you know exists | It is not reachable from a visible label | That **is the finding** — don't fix it by editing the prompt |
| Sessions overlap / browser conflicts | Two runs at once | One browser per process; wait for the first to finish |

Never "fix" a failing run by telling the agent where to click. The `HABEAT_APP_MAP`
in `src/ai-agent/app/app-map.ts` gives her only what a person can see on screen —
the bottom navigation labels and the general shape of the app. Adding CSS selectors
or step-by-step instructions there destroys the value of the whole exercise.

---

## 10. Architecture

```
POST /ai-agent/run | run-day | run-week
  └── AgentService.runSession(user, scenario)
        ├── BrowserService.login()                 real login form, real Chromium
        ├── loop (≈3 × scenario.minutes actions):
        │     ├── BrowserService.getState()        cleaned HTML, scripts/SVG stripped
        │     ├── LlmService.decide()              persona + mood + memory + screen → 1 action
        │     ├── BrowserService.click/type/...    executed, success recorded
        │     └── 0.4–1.4s "think time"            so it isn't 30 clicks in 4 seconds
        ├── LlmService.summarize()                 first-person memory → next session
        └── ObservationService.analyzeAndSave()    UX findings, validated, stored
```

| File | Change it when |
|---|---|
| `persona/personas.ts` | Sarah's life, habits, frustrations — or to add a persona |
| `scenario/scenarios.ts` | Adding a reason to open the app, or re-shaping the week |
| `app/app-map.ts` | Routes or bottom-nav labels changed in the client |
| `llm/llm.prompts.ts` | How she thinks, and what the UX write-up asks for |
| `browser/browser.service.ts` | Login flow changed, or a new interaction primitive |

---

## 11. Extending

### Add a scenario

Add an entry to `SCENARIOS` in `src/ai-agent/scenario/scenarios.ts` and slot its key
into `WEEK_PLAN`. Write the `goal` **as the user's intention, never as instructions**:

```ts
// Good — a reason to open the app
goal: `You are going to the supermarket in twenty minutes and you want a list
based on this week's plan.`

// Bad — a test script; this measures nothing
goal: `Click Plan, then click Shopping List, then verify items appear.`
```

Fill in `successCriteria` honestly — the observation pass grades the session against it.

### Add a persona

Copy `SARAH` in `src/ai-agent/persona/personas.ts`, change every field (an unmodified
field makes two personas behave identically), and add it to `PERSONAS`. Then register a
test user with that `personaId` and run the same week — comparing two personas' findings
on the same screens is where persona-specific UX problems show up.

```bash
curl -X POST http://localhost:5080/api/ai-agent/users \
  -H "Content-Type: application/json" \
  -d '{ "name": "David AI", "email": "david@habeat-test.com",
        "password": "...", "personaId": "your-new-persona-id" }'
```

---

## 12. Not done yet

- **Screenshots.** `BrowserService.screenshot()` exists but nothing stores the images.
  Saving the frame before each confusing moment and running the analysis pass through
  `generateVisionWithRateLimit` would let the observations reference what she *saw*,
  not just the DOM.
- **Signup coverage.** Registration is done by hand in step 4.1; the agent never
  evaluates it.
- **Cross-persona reports.** `GET /ai-agent/report` aggregates everything together;
  it does not yet split by `personaId`.
