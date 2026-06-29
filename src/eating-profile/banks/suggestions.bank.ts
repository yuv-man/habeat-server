export interface BankSuggestion {
  id: string;
  text: string;
  tags: string[];
  priority: number;
}

export const SUGGESTION_BANK: BankSuggestion[] = [
  // Urge surfing
  { id: "urge-surf-snack",       text: "Before an unplanned snack: pause for 5 minutes. Ride the craving — it peaks and fades.",                   tags: ["needs-urge-surfing", "boredom-grazer", "habitual-snacker"],         priority: 1 },
  { id: "urge-surf-emotion",     text: "When emotion triggers eating: name the feeling first. Naming it reduces its pull by up to 50%.",            tags: ["needs-urge-surfing", "stress-eater", "emotional-dinner"],           priority: 1 },
  // Breathing
  { id: "breathing-stress",      text: "When stress hits: 4-7-8 breathing before opening the fridge. Inhale 4s, hold 7s, exhale 8s.",              tags: ["needs-breathing", "stress-eater", "anxiety-eater"],                 priority: 1 },
  { id: "breathing-evening",     text: "At 8 PM: 3 slow breaths before any evening snack. Creates a decision gap.",                                  tags: ["needs-breathing", "late-night-snacker", "emotional-dinner"],        priority: 1 },
  // Body scan
  { id: "body-scan-night",       text: "Replace a late-night snack with a 5-minute body scan. It addresses restlessness without food.",             tags: ["needs-body-scan", "late-night-snacker", "tiredness-eater"],         priority: 1 },
  { id: "body-scan-anxiety",     text: "Before an anxiety-driven meal: check in with your body. Tension often masquerades as hunger.",              tags: ["needs-body-scan", "anxiety-eater"],                                  priority: 1 },
  // Nutrition
  { id: "high-protein-am",       text: "Add 20g protein to breakfast. It cuts afternoon cravings significantly.",                                    tags: ["high-protein-morning"],                                             priority: 2 },
  { id: "protein-snack-swap",    text: "Swap your usual snack for a protein source (Greek yogurt, eggs, nuts). Hunger stays quieter for longer.",   tags: ["high-protein-morning", "habitual-snacker"],                         priority: 2 },
  // Evening & late night
  { id: "evening-swap",          text: "Replace evening snacks with herbal tea for 5 days. After day 3, the habit weakens noticeably.",             tags: ["reduce-evening-snacks", "late-night-snacker"],                      priority: 1 },
  { id: "kitchen-closed",        text: "Set a kitchen-closed time (e.g. 9 PM). The rule removes the decision entirely.",                            tags: ["reduce-evening-snacks", "late-night-snacker"],                      priority: 2 },
  // Hunger check
  { id: "hunger-scale",          text: "Rate hunger 1–10 before eating. Eat between 3 and 7. Below 3 = physical hunger. Above 7 = wait.",          tags: ["hunger-check"],                                                     priority: 1 },
  { id: "hunger-water-first",    text: "Drink a glass of water and wait 10 minutes before eating. Thirst mimics hunger 37% of the time.",          tags: ["hunger-check", "boredom-grazer"],                                   priority: 2 },
  // Pre-meal pause
  { id: "pre-meal-3-breaths",    text: "Take 3 breaths before every meal. Not for relaxation — to shift from automatic to intentional eating.",     tags: ["pre-meal-pause"],                                                   priority: 2 },
  { id: "plate-observation",     text: "Before the first bite: look at your plate for 5 seconds. Notice colours, textures. It activates awareness.", tags: ["pre-meal-pause", "habitual-snacker"],                               priority: 2 },
  // Meal pacing
  { id: "utensils-down",         text: "Put utensils down between every 3 bites. Your brain needs 20 minutes to register fullness.",                tags: ["meal-pacing"],                                                      priority: 2 },
  { id: "chew-count",            text: "Chew each bite 15–20 times. It sounds mechanical but halves eating speed within a week.",                   tags: ["meal-pacing"],                                                      priority: 3 },
  // Social mindfulness
  { id: "social-pre-commit",     text: "Before a group meal: decide your portions beforehand. Social eating doubles portion size without noticing.", tags: ["social-mindfulness", "social-overeater"],                           priority: 1 },
  { id: "social-slow",           text: "At group meals: aim to be the last to finish. It forces pacing and cuts second portions naturally.",         tags: ["social-mindfulness", "social-overeater"],                           priority: 2 },
  // Weekend planning
  { id: "weekend-prep",          text: "Sunday prep: keep 3 ready-to-eat healthy snacks visible in the fridge. Reduces weekend impulse eating.",    tags: ["weekend-planning", "weekend-spiral"],                               priority: 1 },
  { id: "weekend-structure",     text: "Keep meals at regular times on weekends. Skipping meals is the #1 driver of weekend overeating.",           tags: ["weekend-planning", "weekend-spiral"],                               priority: 1 },
  // Stress alternatives
  { id: "stress-walk",           text: "When stress triggers eating: a 5-minute walk first. Cortisol drops; the craving often dissolves.",          tags: ["stress-alternative", "stress-eater"],                               priority: 1 },
  { id: "stress-cold-water",     text: "Stressed? Drink cold water, hold the glass with both hands. The physical sensation breaks the stress loop.", tags: ["stress-alternative", "stress-eater", "anxiety-eater"],             priority: 2 },
  // Mood-meal link
  { id: "mood-log-prompt",       text: "Log your mood right before eating — just one tap. Within 2 weeks you'll see your own patterns clearly.",    tags: ["mood-meal-link"],                                                   priority: 1 },
  { id: "mood-post-meal",        text: "Check in 20 minutes after eating: better or worse? This data is the foundation of your eating profile.",    tags: ["mood-meal-link"],                                                   priority: 2 },
  // Tiredness
  { id: "tiredness-nap",         text: "Tired and craving food? A 10-minute rest often eliminates the craving. The body wants rest, not calories.", tags: ["stress-alternative", "tiredness-eater"],                            priority: 1 },
  { id: "tiredness-protein",     text: "When tired: choose protein over carbs. Carbs spike and crash energy; protein stabilises it.",               tags: ["high-protein-morning", "tiredness-eater"],                          priority: 2 },
  // Celebration
  { id: "celebrate-without-food", text: "Reward yourself with an experience, not a food treat. The emotional association weakens over time.",       tags: ["celebrate-without-food", "celebration-eater"],                      priority: 1 },
  { id: "portion-celebrate",     text: "At celebrations: eat slowly and mindfully rather than restricting. Satisfaction, not quantity, is the goal.", tags: ["celebrate-without-food", "celebration-eater", "social-overeater"], priority: 2 },
  // Boredom
  { id: "boredom-activity-list", text: "Keep a list of 5 non-food activities for boredom. Refer to it before any unstructured snack.",             tags: ["needs-urge-surfing", "boredom-grazer"],                             priority: 1 },
  // Anxiety
  { id: "anxiety-grounding",     text: "Anxious before eating? Try 5-4-3-2-1 grounding: name 5 things you see, 4 you feel, 3 you hear.",           tags: ["needs-body-scan", "anxiety-eater"],                                 priority: 1 },
];
