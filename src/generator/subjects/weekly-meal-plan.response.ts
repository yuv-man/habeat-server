import { ApiProperty } from "@nestjs/swagger";
import { IPlan } from "../../types/interfaces";

export class WeeklyMealPlanResponse {
  @ApiProperty({ example: "success" })
  status: string;

  @ApiProperty({ example: "Weekly meal plan generated and saved successfully" })
  message: string;

  @ApiProperty()
  data: {
    planId: string;
    title: string;
    plan: IPlan; // Full plan document from database
    language: string;
    generatedAt: string;
  };
}
