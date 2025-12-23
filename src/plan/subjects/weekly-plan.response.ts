import { ApiProperty } from "@nestjs/swagger";

class MacrosDto {
  @ApiProperty()
  protein: number;

  @ApiProperty()
  carbs: number;

  @ApiProperty()
  fat: number;
}

class WeeklyMacrosDto {
  @ApiProperty()
  calories: { consumed: number; total: number };

  @ApiProperty()
  protein: { consumed: number; total: number };

  @ApiProperty()
  carbs: { consumed: number; total: number };

  @ApiProperty()
  fat: { consumed: number; total: number };
}

class UserMetricsDto {
  @ApiProperty()
  bmr: number;

  @ApiProperty()
  tdee: number;

  @ApiProperty()
  targetCalories: number;

  @ApiProperty()
  idealWeight: number;

  @ApiProperty()
  weightRange: string;

  @ApiProperty()
  dailyMacros: MacrosDto;
}

class MealDto {
  @ApiProperty()
  _id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  calories: number;

  @ApiProperty()
  macros: MacrosDto;

  @ApiProperty()
  category: string;

  @ApiProperty({
    example: [
      ["chicken", "200g"],
      ["lettuce", "100g"],
    ],
  })
  ingredients: [string, string][];

  @ApiProperty()
  prepTime: number;
}

class WorkoutDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  category: string;

  @ApiProperty()
  duration: number;

  @ApiProperty()
  caloriesBurned: number;
}

class DayPlanDto {
  @ApiProperty()
  meals: {
    breakfast: MealDto;
    lunch: MealDto;
    dinner: MealDto;
    snacks: MealDto[];
  };

  @ApiProperty()
  workouts: WorkoutDto[];

  @ApiProperty()
  waterIntake: number;
}

export class WeeklyPlanResponse {
  @ApiProperty({ example: "success" })
  success: boolean;

  @ApiProperty()
  data: {
    _id: string;
    userId: string;
    title: string;
    userMetrics: UserMetricsDto;
    userData: any;
    weeklyPlan: { [date: string]: DayPlanDto };
    weeklyMacros: WeeklyMacrosDto;
    language: string;
    generatedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  };
}
