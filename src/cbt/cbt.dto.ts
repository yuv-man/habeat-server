import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  ValidateNested,
  IsObject,
} from "class-validator";
import { Type } from "class-transformer";
import {
  MoodLevel,
  MoodCategory,
  MoodTrigger,
  CognitiveDistortionType,
  CBTExerciseType,
  MealType,
} from "./cbt.model";

// Mood DTOs
export class LogMoodDto {
  @ApiProperty({ description: "Date in YYYY-MM-DD format" })
  @IsString()
  date: string;

  @ApiProperty({ description: "Time in HH:MM format" })
  @IsString()
  time: string;

  @ApiProperty({ description: "Mood level from 1-5", minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  moodLevel: MoodLevel;

  @ApiProperty({
    enum: [
      "happy",
      "calm",
      "energetic",
      "neutral",
      "tired",
      "stressed",
      "anxious",
      "sad",
      "angry",
    ],
  })
  @IsString()
  moodCategory: MoodCategory;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  energyLevel?: MoodLevel;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  stressLevel?: MoodLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  triggers?: MoodTrigger[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedMealId?: string;

  @ApiPropertyOptional({ enum: ["breakfast", "lunch", "dinner", "snacks"] })
  @IsOptional()
  @IsString()
  linkedMealType?: MealType;
}

// Thought DTOs
export class ThoughtEmotionDto {
  @ApiProperty()
  @IsString()
  emotion: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  intensity: MoodLevel;
}

export class EvidenceDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supporting?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contradicting?: string[];
}

export class LogThoughtDto {
  @ApiProperty({ description: "Date in YYYY-MM-DD format" })
  @IsString()
  date: string;

  @ApiProperty({ description: "Time in HH:MM format" })
  @IsString()
  time: string;

  @ApiProperty({ description: "What happened - the situation" })
  @IsString()
  situation: string;

  @ApiProperty({ description: "The automatic thought that came to mind" })
  @IsString()
  automaticThought: string;

  @ApiProperty({ type: [ThoughtEmotionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThoughtEmotionDto)
  emotions: ThoughtEmotionDto[];

  @ApiPropertyOptional({
    type: [String],
    description: "Cognitive distortion patterns identified",
  })
  @IsOptional()
  @IsArray()
  cognitiveDistortions?: CognitiveDistortionType[];

  @ApiPropertyOptional({ type: EvidenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EvidenceDto)
  evidence?: EvidenceDto;

  @ApiPropertyOptional({ description: "Reframed balanced thought" })
  @IsOptional()
  @IsString()
  balancedThought?: string;

  @ApiPropertyOptional({ type: ThoughtEmotionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ThoughtEmotionDto)
  outcomeEmotion?: ThoughtEmotionDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedMealId?: string;

  @ApiPropertyOptional({ enum: ["breakfast", "lunch", "dinner", "snacks"] })
  @IsOptional()
  @IsString()
  linkedMealType?: MealType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEmotionalEating?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateThoughtDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  situation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  automaticThought?: string;

  @ApiPropertyOptional({ type: [ThoughtEmotionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThoughtEmotionDto)
  emotions?: ThoughtEmotionDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  cognitiveDistortions?: CognitiveDistortionType[];

  @ApiPropertyOptional({ type: EvidenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EvidenceDto)
  evidence?: EvidenceDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  balancedThought?: string;

  @ApiPropertyOptional({ type: ThoughtEmotionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ThoughtEmotionDto)
  outcomeEmotion?: ThoughtEmotionDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEmotionalEating?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

// Exercise DTOs
export class CompleteExerciseDto {
  @ApiProperty()
  @IsString()
  exerciseId: string;

  @ApiProperty({
    enum: [
      "thought_record",
      "behavioral_activation",
      "mindful_eating",
      "gratitude",
      "progressive_relaxation",
      "breathing",
      "cognitive_restructuring",
      "urge_surfing",
      "self_compassion",
      "body_scan",
    ],
  })
  @IsString()
  exerciseType: CBTExerciseType;

  @ApiProperty({ description: "Date in YYYY-MM-DD format" })
  @IsString()
  date: string;

  @ApiProperty({ description: "Duration in minutes" })
  @IsNumber()
  @Min(1)
  duration: number;

  @ApiPropertyOptional({ description: "Exercise-specific responses" })
  @IsOptional()
  @IsObject()
  responses?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reflection?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  moodBefore?: MoodLevel;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  moodAfter?: MoodLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedMealId?: string;
}

// Meal-Mood DTOs
export class MoodStateDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  moodLevel: MoodLevel;

  @ApiProperty({
    enum: [
      "happy",
      "calm",
      "energetic",
      "neutral",
      "tired",
      "stressed",
      "anxious",
      "sad",
      "angry",
    ],
  })
  @IsString()
  moodCategory: MoodCategory;
}

export class LinkMoodToMealDto {
  @ApiProperty()
  @IsString()
  mealId: string;

  @ApiProperty()
  @IsString()
  mealName: string;

  @ApiProperty({ enum: ["breakfast", "lunch", "dinner", "snacks"] })
  @IsString()
  mealType: MealType;

  @ApiProperty({ description: "Date in YYYY-MM-DD format" })
  @IsString()
  date: string;

  @ApiPropertyOptional({ type: MoodStateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoodStateDto)
  moodBefore?: MoodStateDto;

  @ApiPropertyOptional({ type: MoodStateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoodStateDto)
  moodAfter?: MoodStateDto;

  @ApiProperty()
  @IsBoolean()
  wasEmotionalEating: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  hungerLevelBefore?: MoodLevel;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  satisfactionAfter?: MoodLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

// Query DTOs
export class MoodHistoryQueryDto {
  @ApiPropertyOptional({ description: "Start date in YYYY-MM-DD format" })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: "End date in YYYY-MM-DD format" })
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class PeriodQueryDto {
  @ApiPropertyOptional({ enum: ["week", "month"], default: "week" })
  @IsOptional()
  @IsString()
  period?: "week" | "month";
}

export class LimitQueryDto {
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;
}

export class CategoryQueryDto {
  @ApiPropertyOptional({ enum: ["mood", "eating", "stress", "general"] })
  @IsOptional()
  @IsString()
  category?: "mood" | "eating" | "stress" | "general";
}
