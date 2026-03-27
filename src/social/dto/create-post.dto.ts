import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum,
  IsNumber,
  ValidateNested,
  MaxLength,
} from "class-validator";
import { Type } from "class-transformer";
import { PostType, PostVisibility } from "../schemas/social-post.schema";

class PostContentDto {
  @ApiProperty({ example: "7-Day Streak!" })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ example: "Achieved a 7-day tracking streak", required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  stats?: Record<string, any>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  badgeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  badgeName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  badgeIcon?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  streakDays?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  habitScore?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  weeklyData?: {
    daysTracked?: number;
    consistencyScore?: number;
    avgCalories?: number;
  };

  @ApiProperty({ required: false })
  @IsOptional()
  cbtData?: {
    moodsLogged?: number;
    exercisesCompleted?: number;
    moodImprovement?: number;
  };
}

export class CreatePostDto {
  @ApiProperty({ enum: PostType, example: PostType.STREAK })
  @IsNotEmpty()
  @IsEnum(PostType)
  type: PostType;

  @ApiProperty({ type: PostContentDto })
  @ValidateNested()
  @Type(() => PostContentDto)
  @IsNotEmpty()
  content: PostContentDto;

  @ApiProperty({ enum: PostVisibility, default: PostVisibility.PUBLIC })
  @IsOptional()
  @IsEnum(PostVisibility)
  visibility?: PostVisibility;

  @ApiProperty({ example: "Feeling great!", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  caption?: string;
}
