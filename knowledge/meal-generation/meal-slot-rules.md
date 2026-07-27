---
topic: meal-slot-assignment-rules
domain: meal-generation
agents: [meal-generator]
tokens_est: 300
version: 1.1
---

# MEAL SLOT RULES — GUIDELINES

## slot_definitions

### breakfast
time_window: 6am–10am
purpose: break overnight fast, fuel the morning, stabilize glucose
default_foods (use these when no explicit breakfast preference is given):
  eggs (scrambled, fried, poached, omelette, boiled)
  oatmeal, porridge, overnight oats
  yogurt (plain, Greek), cottage cheese
  toast, wholegrain bread, bagel, English muffin
  pancakes, waffles, crepes (light)
  granola, muesli, cereal
  fruit (fresh or blended — smoothies, smoothie bowls)
  avocado toast
  rice, congee, rice porridge (culturally valid breakfast choices)

### lunch
time_window: 11:30am–2pm
default_foods: salads, sandwiches, soups, wraps, grain bowls, light hot dishes, leftovers
food_preferences: MAY apply here if they fit naturally

### dinner
time_window: 6pm–9pm
default_foods: full proteins with sides (steak, chicken breast, fish, tofu), pasta, rice dishes, stews, grills
food_preferences: APPLY freely here

### snacks
time_window: between meals
default_foods: fruit, nuts, hummus + veg, yogurt, protein bar, boiled eggs, rice cakes

## preference_application_rules

food_preferences_scope:
  Default to applying food preferences to LUNCH and DINNER slots.
  Reason: liked foods are often dinner proteins (steak, beef, salmon fillet) that feel out of place
  at breakfast when placed there by the AI without the user explicitly choosing breakfast.

breakfast_preference_override:
  When user has a food preference that is a typical dinner food (steak, beef cut, heavy protein,
  pasta, curry), do NOT automatically apply it to breakfast.
  Instead: generate a morning-appropriate breakfast that uses similar flavors or protein spirit.
  Example: user likes "sirloin steak" → breakfast = "High-Protein Egg Bowl" or
  "Beef and Egg Breakfast Bowl" (ground beef + eggs), NOT "Sirloin Steak Scramble".
  Exception: if the user explicitly requests a specific breakfast (e.g. "rice for breakfast"),
  honor it — the goal is to avoid AI-driven mismatches, not to restrict user choices.

scramble_rule:
  Labeling a meal "scramble" does NOT automatically make a dinner ingredient breakfast-appropriate.
  "Sirloin Steak and Broccoli Scramble" is a poor breakfast choice.
  Egg scrambles should use eggs as the primary protein; add-ins should be vegetables or light proteins.
  Acceptable: "Spinach and Feta Egg Scramble", "Veggie Egg Scramble with Bell Peppers".
  Poor fit: "Sirloin Steak Scramble", "Lamb Scramble" — these feel like dinner, not breakfast.

## variety_slots
- Every breakfast across the week should be a DIFFERENT morning food type.
- Rotate: eggs-based → grain-based → yogurt-based → fruit-based → toast-based
- Avoid repeating the exact same breakfast twice in one plan.
