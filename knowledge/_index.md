---
type: manifest
version: 1.0
---

# HABEAT KNOWLEDGE BASE — INDEX

Load files by agent need. Each file is self-contained. Load only what is relevant to avoid token waste.

## files

| file | domain | tokens_est | load_when |
|---|---|---|---|
| nutrition/macros-mood.md | nutrition | 480 | meal generation, profile scoring, CBT recommendations |
| nutrition/meal-timing.md | nutrition | 360 | meal plan generation, risk window analysis, fasting users |
| nutrition/mood-foods.md | nutrition | 420 | meal swaps, stress-specific suggestions, trigger-matched meals |
| cbt/emotional-eating.md | cbt | 500 | profile classification, trigger scoring, pattern detection |
| cbt/interventions.md | cbt | 460 | suggestion matching, script writing (Chloe), chat responses |
| cbt/distortions.md | cbt | 340 | thought journal analysis, chat CBT support |
| profile/eating-archetypes.md | profile | 440 | profile agent classification, suggestion tag assignment |
| profile/psych-profile.md | profile | 460 | user psych profile schema + inference protocol for eating-profile and chat-ai |

## load strategy

eating_profile_agent: [nutrition/macros-mood.md, cbt/emotional-eating.md, profile/eating-archetypes.md, profile/psych-profile.md]
meal_generator: [nutrition/macros-mood.md, nutrition/meal-timing.md, nutrition/mood-foods.md]
chloe_voice_agent: [cbt/emotional-eating.md, cbt/interventions.md]
chat_ai: load on demand based on user question topic
