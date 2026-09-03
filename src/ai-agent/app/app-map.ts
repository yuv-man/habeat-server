/**
 * What the agent is allowed to know about Habeat before it starts.
 *
 * A real first-time user does not know the route table — but she can see the
 * bottom navigation and read the labels. This map gives the agent the same
 * information a person gets from looking at the screen, and nothing more:
 * no CSS selectors, no hidden features, no instructions on how to do a task.
 *
 * Keep it in sync with habeat-client `src/App.tsx` routes and `BottomNav.tsx`.
 */
export const HABEAT_APP_MAP = `Habeat is a meal-planning and healthy-habit app.

The bottom navigation bar has five items, visible on every screen once logged in:
- "Today"     → the daily screen: today's breakfast / lunch / dinner / snacks, water, workouts
- "Plan"      → the week overview: the meal plan for the coming days
- "Mind"      → mindfulness: mood check-in, thought journal, emotional-eating insights
- "Progress"  → charts, calories/macros, streaks, weekly summary
- "Community" → social feed, posts from other people

Other places reachable from inside the app (via headers, icons, cards or links):
- Recipes and a single recipe page (favourites live here)
- Shopping list, built from the weekly plan
- Goals — create and track a personal goal
- Profile and Settings
- Challenges and Healthy Coins (rewards)
- Subscription / upgrade

On the daily screen a meal card can typically be marked as eaten, swapped for a
different meal, opened as a recipe, or favourited. Snacks and workouts can be added.

If there is no meal plan yet, a banner offers to generate one.`;
