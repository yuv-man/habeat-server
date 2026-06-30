---
topic: user-psych-profile-schema-and-inference
domain: profile
agents: [eating-profile, chat-ai]
tokens_est: 460
version: 1.0
sources: [CBT Fairburn 2008, DBT Linehan 1993, Habit Loop Duhigg 2012, HALT model AA 1980s]
---

# USER PSYCH PROFILE — SCHEMA & INFERENCE GUIDE

## role
behavioral_nutrition engine: map psychological_state → meal_recommendation
frameworks: CBT (thought↔behavior↔emotion loops) | DBT (distress_tolerance, emotion_regulation) | Habit_Loop (cue→routine→reward)
goal: reduce EE episodes via personalized intervention, not restriction

## profile_schema
u_id: string (DB key, do not infer)

archetype: "stress-soother" | "clean-plater" | "mindless-grazer" | "fatigue-fueler"
  → see eating-archetypes.md for full classification rules

triggers: string[] — from: [anxiety, boredom, loneliness, fatigue, reward_seeking, social_pressure, procrastination, conflict, shame]
  infer from: what preceded last 3 EE episodes | time-of-day patterns | recurring emotional themes

interoception_score: int [1–10] — ability to sense internal body signals (hunger, fullness, emotion-in-body)
  1–3: poor (eats without hunger cues, unaware of fullness, difficulty naming emotions physically)
  4–6: moderate (sometimes notices hunger/fullness, can identify 1–2 body sensations)
  7–10: good (clear hunger/fullness awareness, can locate emotions in body)
  infer from: "I don't really feel hungry, I just eat" → low | "I eat before I realize I'm full" → low-mid

distress_tolerance: "low" | "moderate" | "high"
  low: eats within minutes of stressor, can't delay urge, EE is primary coping
  moderate: can delay 15–30min, has 1–2 non-food coping skills but inconsistent
  high: uses non-food strategies first, EE is occasional fallback
  infer from: gap between trigger and eating episode | whether user mentions alternative coping

exec_function_threshold: "low" | "moderate" | "high" — capacity for meal planning & follow-through
  low: can't stick to plans >2 days, overwhelmed by choices, needs very simple 1-step options
  moderate: can follow a weekly plan with reminders, breaks down with stress
  high: self-directed, can track and adjust independently
  infer from: history with meal plans | reported follow-through | cognitive load complaints

craving_mouthfeel: "crunchy" | "creamy" | "warm" | "sweet" | "savory"
  emotional_map:
    crunchy → often anger / frustration / tension (oral_aggression release)
    creamy → often sadness / loneliness / need_for_comfort (soothing texture)
    warm → often cold / tired / lonely (temperature_comfort)
    sweet → often low_dopamine / low_mood / fatigue (dopamine_seeking)
    savory → often boredom / low_stimulation (flavor_stimulation)
  infer from: what foods user reaches for during EE episodes

current_state.h_a_l_t: "H" | "A" | "L" | "T" | "None"
  H = Hungry (physical, not EE) | A = Angry/Anxious | L = Lonely | T = Tired
  HALT is acute state — reassess each session
  infer from: opening message tone | time of day | recent events mentioned
  high_risk combos: H+A (↑ impulsivity) | L+T (↑ comfort_food craving) | A+T (↑ stress-eating)

## inference_protocol
1. do NOT ask all fields at once — build profile across 2–4 interactions
2. priority_order: archetype → triggers → h_a_l_t (current) → distress_tolerance → interoception_score → craving → exec_function
3. trust behavioral signals over self-report (user says "I'm fine" but describes daily 10pm snacking → EE pattern)
4. update profile on new evidence — profiles shift with life_events, seasons, stress_load
5. partial_profile is valid — use what's known, flag unknowns rather than guessing

## profile_→_intervention_routing
stress-soother + low_distress_tolerance → urge_surfing + opposite_action (priority)
clean-plater + low_interoception → hunger_scale + mindful_eating
mindless-grazer + low_exec_function → stimulus_control + 2-choice meal simplification
fatigue-fueler + H.A.L.T.=T → circadian meal_timing + morning_protein anchoring
any + craving_mouthfeel → offer mouthfeel-matched healthier_swap (crunchy → carrots+hummus)
