---
topic: eating-archetypes-and-intervention-maps
domain: profile
agents: [eating-profile, meal-generator, chat-ai]
tokens_est: 440
version: 1.0
sources: [van_Strien 1986, Arnow 1995, Allison 1994, Birch 1999, Masheb 2006]
---

# EATING ARCHETYPES — PROFILE CLASSIFICATION

## archetype_map

### emotional_eater
prevalence: ~45% of people who diet
core_pattern: negative_affect → eating → temporary_relief → guilt → ↑ negative_affect
trigger_profile: [stress, sadness, anxiety, loneliness, boredom]
risk_times: evenings, weekends, post-conflict, post-difficult_news
food_preference: high_fat + high_sugar (comfort_foods) | familiar_childhood_foods
warning_signs: eating_when_not_hungry, rapid_eating, eating_past_fullness, hiding_eating
ee_score: high
intervention_priority: [urge_surfing, self_compassion, stimulus_control, opposite_action]
meal_plan_notes: structure_matters_most (3 regular_meals → ↓ vulnerability windows)
  high_protein_breakfast → ↓ afternoon_vulnerability
  avoid_trigger_foods_in_home (not restriction, environmental_design)

### restrained_eater / restriction-binge_cycle
core_pattern: rigid_rules → restriction → rule_violation (real or perceived) → binge → restriction
key_feature: all-or-nothing_thinking drives_cycle (see distortions.md)
risk_factors: history_of_dieting, perfectionism, ↑ weight_consciousness
triggers: breaking_a_food_rule, emotional_distress, social_pressure
ee_score: high (but different mechanism — cognitive, not purely emotional)
intervention_priority: [cognitive_restructuring, flexible_eating_rules, meal_regularity]
meal_plan_notes: no_forbidden_foods in plan | all_foods_fit_language
  smaller_more_frequent_meals → prevent_extreme_hunger (hunger amplifies restriction breakdown)
  flexible_targets (ranges not exact numbers)

### habitual_eater
core_pattern: eating_as_conditioned_response to environmental_cues, not emotion or hunger
triggers: [location (couch, car, desk), activity (TV, phone), time_of_day]
key_feature: low_awareness during episodes ("I wasn't even hungry")
emotional_component: low — primarily_habit_learning
ee_score: medium
intervention_priority: [stimulus_control, mindful_eating, habit_disruption, eating_location_consolidation]
meal_plan_notes: consistent_meal_times → ↓ cue-based_eating
  keep_trigger_foods out_of_associated_contexts (no chips near TV)

### social_eater
core_pattern: eating_behavior significantly_shaped by social_context
subtype_1 (social_facilitator): overeats in groups, fast_eater, influenced by others' portions
subtype_2 (social_avoider): restricts in public, overeats in private, shame_based
ee_score: medium
risk_times: restaurants, parties, family_meals, celebrations
triggers: social_pressure, wanting_to_fit_in, celebration, permission_from_others_eating
intervention_priority: [pre-commitment, social_mindfulness, boundary_setting, self_compassion]
meal_plan_notes: plan for social_eating (not avoidance) | designated_celebration_meals allowed
  pre-eat_protein before events → ↓ vulnerability to social_overeating

### night_eater (Night Eating Syndrome — NES)
clinical_criteria: >25% daily_intake after evening_meal | ≥2×/week | ↓ appetite in morning
prevalence: 1.5% general_population, 9–14% obese_individuals
mechanism: circadian_dysregulation → appetite_hormones shifted to night
  cortisol remains_elevated at night (vs normal_decline)
  leptin ↓ at night (vs normal_peak) → hunger_signal persists
distinction_from_ee: not_primarily_emotion_driven — biological_circadian_shift
ee_score: medium-high
intervention_priority: [circadian_reset (meal_timing), morning_protein, light_exposure, sleep_hygiene]
meal_plan_notes: enforce morning_eating even if not_hungry (reset circadian_appetite)
  structured_dinner with no_later_access | herbal_tea / non-caloric_ritual for night_window

### mindful_eater (positive_archetype)
core_pattern: eats in response to physical_hunger | stops at satiety | aware during meals
characteristics: low_ee_score, stable_eating, flexible_not_rigid, positive_food_relationship
maintenance: not_perfection — occasional EE episodes without guilt_spiral
  key_difference: quick_recovery vs prolonged_shame_cycle
intervention: maintenance_focused | reinforce_skills | prevent_backslide during stress

## archetype_combination_rules
most_users are mixed (2 archetypes):
  emotional + restrained: highest_risk → most_complex to address
  habitual + social: moderate_risk → environmental_intervention most_effective
  night_eater + emotional: circadian_and_emotional → two_track intervention needed
profile_agent_note: weight primary_archetype by frequency × impact × user_distress
  do not force single_label — "dominant emotional_eater with habitual tendencies" is valid
