import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsOptional, IsObject } from "class-validator";

export class ChatContextDto {
  @ApiPropertyOptional({
    description: "Current screen the user is viewing",
    example: "daily-tracker",
  })
  @IsOptional()
  @IsString()
  currentScreen?: string;

  @ApiPropertyOptional({
    description: "Selected date if viewing a specific day",
    example: "2025-01-06",
  })
  @IsOptional()
  @IsString()
  selectedDate?: string;
}

export class SendMessageDto {
  @ApiProperty({
    description: "The message to send to the nutrition chatbot",
    example: "What should I eat for lunch today?",
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({
    description: "Additional context about user's current view",
    type: ChatContextDto,
  })
  @IsOptional()
  @IsObject()
  context?: ChatContextDto;
}
