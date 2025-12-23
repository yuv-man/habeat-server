import mockWeekPlan from "./mockWeekPlan.json";
import { IDailyPlan } from "../types/interfaces";

const convertIngredients = (ingredients: string[]): [string, string][] => {
  return ingredients.map((ing) => [ing, ""] as [string, string]);
};

const generateFullWeek = (): IDailyPlan[] => {
  return mockWeekPlan.data.plan.weeklyPlan.map((day) => ({
    ...day,
    day: day.day.toLowerCase() as
      | "monday"
      | "tuesday"
      | "wednesday"
      | "thursday"
      | "friday"
      | "saturday"
      | "sunday",
    date: new Date(day.date),
    meals: {
      breakfast: {
        ...day.meals.breakfast,
        category: "breakfast" as const,
        ingredients: convertIngredients(day.meals.breakfast.ingredients || []),
      },
      lunch: {
        ...day.meals.lunch,
        category: "lunch" as const,
        ingredients: convertIngredients(day.meals.lunch.ingredients || []),
      },
      dinner: {
        ...day.meals.dinner,
        category: "dinner" as const,
        ingredients: convertIngredients(day.meals.dinner.ingredients || []),
      },
      snacks: day.meals.snacks.map((snack: any) => ({
        ...snack,
        category: "snack" as const,
        ingredients: convertIngredients(snack.ingredients || []),
      })),
    },
  }));
};

export { generateFullWeek };
