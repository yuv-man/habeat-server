import { ApiProperty } from "@nestjs/swagger";

export class GoalResponse {
  @ApiProperty({ example: "success" })
  status: string;

  @ApiProperty({ example: "Goal generated successfully" })
  message: string;

  @ApiProperty()
  data: {
    goal: string;
    description: string;
    category: string;
    targetDate: Date;
    startDate: Date;
    target: number;
  };
}
