---
topic: dietary-path-guidelines
domain: nutrition
agents: [meal-generator, chat-ai]
tokens_est: 400
version: 1.0
---

# DIETARY PATH GUIDELINES

## path_definitions

### healthy (maintain / balanced)
goal: sustainable balanced nutrition
calorie_strategy: TDEE maintenance (±0%)
macro_split: protein 25–30% | carbs 40–45% | fat 25–30%
meal_style: varied whole foods, moderate portions, no restriction
recommended: lean proteins, whole grains, vegetables, healthy fats, fruit

### lose / lose-weight (fat loss)
goal: controlled caloric deficit
calorie_strategy: TDEE −15% to −20% (max −500 kcal/day to protect muscle)
macro_split: protein 30–35% | carbs 35–40% | fat 25–30%
meal_style: high volume, high satiety, low calorie density
recommended: lean proteins (chicken breast, fish, egg whites), high-fiber vegetables,
  legumes, low-GI carbs; avoid fried foods, refined sugar, alcohol
breakfast_priority: high-protein + fiber → controls hunger for the full day

### muscle / gain-muscle (hypertrophy)
goal: caloric surplus with high protein
calorie_strategy: TDEE +10% to +15% (+200–400 kcal)
macro_split: protein 30–35% | carbs 45–50% | fat 20–25%
meal_style: frequent meals, protein at every meal, carbs around workouts
recommended: chicken, beef, eggs, dairy, rice, oats, sweet potato, legumes
meal_timing: pre-workout = carb + protein | post-workout = fast protein + carbs

### keto
goal: ketosis via carb restriction
calorie_strategy: TDEE maintenance
macro_split: fat 65–75% | protein 20–25% | carbs <5% (max 20–25g net/day)
meal_style: high fat, moderate protein, very low carb
recommended: fatty meats, eggs, cheese, avocado, nuts, oils, non-starchy vegetables
forbidden: grains, bread, pasta, rice, sugar, most fruit, legumes, root vegetables

### fasting (intermittent fasting)
goal: compress eating window, improve insulin sensitivity
eating_window: 8h (e.g., 12pm–8pm) or 10h (e.g., 10am–8pm)
calorie_strategy: TDEE maintenance within window
meal_style: 2–3 larger, nutrient-dense meals; no snacking outside window
recommended: same as "healthy" path but higher calorie density per meal
note: breakfast slot may be SKIPPED or shifted to late morning (10–12pm)

### running / endurance
goal: fuel training and recovery
calorie_strategy: TDEE +10–20% on workout days, maintenance on rest days
macro_split: carbs 50–55% | protein 20–25% | fat 20–25%
meal_style: carb-heavy around runs, protein-focused at dinner
recommended: oats, rice, pasta, sweet potato, banana, chicken, salmon, legumes
pre_run: fast carb (banana, toast, sports drink) 30–60 min before
post_run: protein + carb within 30 min (e.g., chocolate milk, rice + chicken)

### custom
goal: flexible — no specific path restriction
calorie_strategy: TDEE maintenance as baseline
macro_split: balanced, no hard rules
meal_style: driven by user preferences and restrictions only

## application_rules
- Path determines calorie target, macro ratios, and meal composition emphasis.
- Path does NOT override breakfast slot rules — breakfast must always be morning foods.
- Path-specific foods are inspiration for lunch and dinner composition.
- Always respect allergies and dietary restrictions above path guidelines.
