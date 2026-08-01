# Meal-plan generation eval

Measures the thing users actually complain about — repeated meals, dietary
violations, dinner food at breakfast, fake nutrition — against real Gemini
calls, so a prompt change can be judged instead of guessed at.

## Running

Needs `GEMINI_API_KEY` in the repo `.env`.

```bash
# current production pipeline
TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
  npx ts-node --transpile-only scripts/meal-plan-eval/run-new.ts <model> <runs>

# the pre-rewrite prompt, kept for comparison
TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
  npx ts-node --transpile-only scripts/meal-plan-eval/run-baseline.ts <model> <runs>
```

`<runs>` generates the same persona for consecutive weeks, which is how the
cross-week repetition number is produced.

**Free-tier quota is 20 requests/day per model.** Four personas × 2 runs = 8
requests, so a couple of full sweeps exhausts a model for the day. Spread work
across `gemini-3.5-flash`, `gemini-3-flash-preview` and `gemini-2.5-flash`.

## Metrics

| Metric | Meaning | Want |
| --- | --- | --- |
| `violations` | meals breaking a hard dietary constraint | 0 |
| `dup` | repeated dish names inside one week | 0% |
| `CROSS-WEEK REPEAT` | identical dishes between consecutive weeks | 0 |
| `badBreakfast` | breakfasts that read as dinner | low |
| `calMAPE` | day calories vs target | 1–5% |
| `macroMAPE` | `p*4+c*4+f*9` vs stated calories | <5% |
| `missing` | meals with absent name/macros/ingredients | 0 |

`calMAPE` near **0.0% is a red flag, not a win** — it means the model echoed the
target numbers from the prompt instead of adding up the ingredients it listed.

## What the baseline showed

Measured on `gemini-2.5-flash-lite`, the model production used to select:

- **Repetition.** The omnivore persona got 6/21 identical dish names across two
  independent runs, and the dishes were the prompt's own example list read back
  ("Scrambled Eggs with Toast", "Oatmeal with Banana", "Grilled Chicken Salad").
- **Dietary violations.** The vegan persona got "Tempeh Bacon", "Seitan Sausage"
  and "Seitan 'Chicken' Salad"; the gluten/dairy-free persona got breadcrumbed
  turkey meatballs.
- **Wrong food, wrong slot.** Up to 4 of 7 breakfasts were dinners, because
  cuisine and protein were assigned per day and applied to all three slots.
- **Fabricated nutrition.** `calMAPE` 0.0% across the board.

## Latency: measure the phase users actually wait on

`run-latency.ts [days] [models,...]`

Plan generation is two-phase: **Phase 1 is today only and blocks the client**;
Phase 2 fills the rest of the week in the background. The first round of this
work benchmarked 7-day batches throughout — i.e. the part nobody waits for — and
picked a model that was 7x slower than necessary. Measure 1 day for the
user-facing number.

| model | 1 day | 6 days | violations |
| --- | --- | --- | --- |
| `gemini-3.1-flash-lite` | **2.2s** | **9.3s** | 0 |
| `gemini-3.5-flash-lite` | 2.4s | 10.5s | 1 |
| `gemini-3.5-flash` | — | 60–90s | 0 |

"Lite" is generation-specific. `gemini-2.5-flash-lite` genuinely was the source
of the original dietary violations, but the 3.x lites match the big models on
quality at a fraction of the latency. Do not generalise across generations.

**Gemini 3.x models spend output budget on internal reasoning before emitting
anything.** A tight `maxOutputTokens` gets eaten by thinking and the reply
truncates mid-JSON — a 4.5k budget made `gemini-3-flash-preview` and
`gemini-2.5-flash` fail on a *single day*. Hence the 8k floor in
`outputTokenBudget()`.

## Free-tier quota

20 requests/day **per model**, resetting at midnight US/Pacific. Probe live
state before concluding anything is broken:

```bash
for m in gemini-3.1-flash-lite gemini-3.5-flash-lite gemini-2.5-flash; do
  printf "%-26s " "$m"
  curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/$m:generateContent" \
    -H "Content-Type: application/json" -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{"contents":[{"parts":[{"text":"hi"}]}],"generationConfig":{"maxOutputTokens":5}}' \
    | grep -o '"status": *"[^"]*"' || echo OK
done
```

`gemini-2.0-flash` and `gemini-2.0-flash-lite` report **`limit: 0`** — no free
quota at all. They were in the fail-over list and could never have served a
request. Removed.

A full eval sweep is 4 requests per model per run and will exhaust a model in a
few passes. Spread sweeps across models and check quota first.

## What changed

See `src/generator/meal-plan-prompt.ts`. Code now fixes each meal's form,
protein and seasoning from a per-user, per-week seeded rotation, and the model
only decides the dish. Model priority moved off `gemini-2.5-flash-lite`.

Result on `gemini-3.5-flash` / `gemini-3-flash-preview`: 0 violations, 0
cross-week repeats, `calMAPE` 0.2–2.8%.

## Fallback provider (OpenRouter)

`run-openrouter.ts <comma,separated,models>` scores candidates on the same
prompt. What the sweep found:

- The three models previously configured in `generate.service.ts` —
  `llama-3.1-8b:free`, `mistral-7b:free`, `gemma-2-9b:free` — **all return 404**.
  There was effectively no fallback: once Gemini's quota ran out, users got
  `PLAN_GENERATION_UNAVAILABLE`.
- `nvidia/nemotron-3-super-120b-a12b:free` is a reasoning model and spent **37s
  on a two-item list**. Excluded — far too slow to sit in front of a waiting user.
- `nvidia/nemotron-3-ultra-550b:free` never returned within 25 minutes.
- `google/gemma-4-31b-it:free` returns "Provider returned error".
- Usable free models: `inclusionai/ling-3.0-flash`, `openai/gpt-oss-20b`,
  `google/gemma-4-26b-a4b-it` — all fine on small prompts, but they are reasoning
  models that stall on a full 7-day request. Treat the free tier as best-effort.

**OpenRouter reserves credit against `max_tokens`, not actual usage.** Asking for
32768 on a small balance is rejected outright — "you requested up to 32768
tokens, but can only afford 4444" — even though the real reply costs a fraction
of that. Hence `outputTokenBudget()`, which sizes the request to the day count.

The paid tier is `google/gemini-3.5-flash`, the same model the Gemini path
prefers, so failing over does not degrade the plan. A week is ~8k output tokens,
about **$0.02**. Roughly $5 of credit covers ~250 plans and makes the fallback
full-quality; without credit the code degrades to the free tier automatically.

## Caveat

Every number here comes from a live model and moves between runs. Treat a single
run as a smoke test; compare 2+ runs per persona before concluding a change
helped.
