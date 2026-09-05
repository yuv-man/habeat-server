export interface BankPattern {
  id: string;
  name: string;
  emoji: string;
  context: string;
  impact: "positive" | "negative" | "neutral";
  tags: string[];
  priority: number;
}

export const PATTERN_BANK: BankPattern[] = [
  // Negative
  { id: "late-night-snacker",  name: "Late-Night Snacking",      emoji: "🌙", context: "After 9 PM",                    impact: "negative", tags: ["late-night-snacker"],    priority: 1 },
  { id: "stress-eater",        name: "Stress-Eating",            emoji: "😤", context: "High-pressure moments",          impact: "negative", tags: ["stress-eater"],          priority: 1 },
  { id: "boredom-grazer",      name: "Boredom Grazing",          emoji: "😑", context: "Unstructured time",              impact: "negative", tags: ["boredom-grazer"],        priority: 1 },
  { id: "emotional-dinner",    name: "Emotional Evening Eating", emoji: "🌆", context: "Evenings, low-mood days",        impact: "negative", tags: ["emotional-dinner"],      priority: 2 },
  { id: "anxiety-eater",       name: "Anxiety-Driven Eating",    emoji: "😰", context: "Before stressful events",        impact: "negative", tags: ["anxiety-eater"],         priority: 1 },
  { id: "tiredness-eater",     name: "Tiredness Eating",         emoji: "😴", context: "Post-work, late evenings",       impact: "negative", tags: ["tiredness-eater"],       priority: 2 },
  { id: "weekend-spiral",      name: "Weekend Pattern",          emoji: "📅", context: "Saturday–Sunday eating shifts",  impact: "negative", tags: ["weekend-spiral"],        priority: 2 },
  { id: "social-overeater",    name: "Social Overeating",        emoji: "👥", context: "Group meals, celebrations",      impact: "negative", tags: ["social-overeater"],      priority: 2 },
  { id: "habitual-snacker",    name: "Habitual Snacking",        emoji: "🔄", context: "TV time, screen habits",         impact: "negative", tags: ["habitual-snacker"],      priority: 2 },
  { id: "celebration-eater",   name: "Celebration Eating",       emoji: "🎉", context: "Events and rewards",             impact: "negative", tags: ["celebration-eater"],     priority: 3 },
  // Positive
  { id: "mindful-breakfast",   name: "Morning Mindfulness",      emoji: "☀️", context: "Most aware at breakfast",        impact: "positive", tags: ["mindful-breakfast"],     priority: 1 },
  { id: "mindful-lunch",       name: "Mindful Lunch Habit",      emoji: "🥗", context: "Consistent lunch awareness",     impact: "positive", tags: ["mindful-lunch"],         priority: 1 },
  { id: "consistent-logger",   name: "Consistent Tracker",       emoji: "✅", context: "Logging meals daily",            impact: "positive", tags: ["consistent-logger"],     priority: 1 },
  { id: "mood-responsive",     name: "Mood-Aware Eater",         emoji: "💭", context: "Notices mood before eating",     impact: "positive", tags: ["mood-responsive"],       priority: 2 },
  // Neutral
  { id: "social-diner",        name: "Social Dining",            emoji: "🤝", context: "Weekend group meals",            impact: "neutral",  tags: ["social-overeater"],      priority: 3 },
];
