import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  IsArray,
  IsBoolean,
  ValidateNested,
  ValidateIf,
} from "class-validator";
import { Type } from "class-transformer";

export class UserDataDto {
  @ApiProperty({ example: "John Doe" })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: "user@example.com", required: false })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ example: "", required: false })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty({ example: 30 })
  @IsNotEmpty()
  @IsNumber()
  age: number;

  @ApiProperty({ example: "male", enum: ["male", "female"] })
  @IsNotEmpty()
  @IsEnum(["male", "female"])
  gender: "male" | "female";

  @ApiProperty({ example: 175 })
  @IsNotEmpty()
  @IsNumber()
  height: number;

  @ApiProperty({ example: 70 })
  @IsNotEmpty()
  @IsNumber()
  weight: number;

  @ApiProperty({
    example: 3,
    required: false,
  })
  @IsNotEmpty()
  @IsNumber()
  workoutFrequency?: number;

  @ApiProperty({ example: 3, required: false })
  @IsOptional()
  @IsNumber()
  fastingHours?: number;

  @ApiProperty({ example: "16:00", required: false })
  @IsOptional()
  @IsString()
  fastingStartTime?: string;

  @ApiProperty({
    example: "gain-muscle",
    enum: [
      "keto",
      "healthy",
      "gain-muscle",
      "running",
      "lose-weight",
      "fasting",
    ],
  })
  @IsNotEmpty()
  @IsEnum([
    "keto",
    "healthy",
    "gain-muscle",
    "running",
    "lose-weight",
    "fasting",
  ])
  path:
    | "keto"
    | "healthy"
    | "gain-muscle"
    | "running"
    | "lose-weight"
    | "fasting";

  @ApiProperty({ example: 1576, required: false })
  @IsOptional()
  @IsNumber()
  bmr?: number;

  @ApiProperty({ example: 2443, required: false })
  @IsOptional()
  @IsNumber()
  tdee?: number;

  @ApiProperty({ example: 73, required: false })
  @IsOptional()
  @IsNumber()
  idealWeight?: number;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryRestrictions?: string[];

  @ApiProperty({
    type: [String],
    example: ["Italian", "Seafood", "Asian"],
    description: "Food preferences/cuisines from KYC (not actual meal IDs)",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  foodPreferences?: string[];

  @ApiProperty({
    type: [String],
    required: false,
    example: ["Cilantro", "Eggplant", "Tofu"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dislikes?: string[];

  @ApiProperty({
    example: "free",
    enum: ["free", "plus", "premium"],
    required: false,
  })
  @IsOptional()
  @IsEnum(["free", "plus", "premium"])
  subscriptionTier?: "free" | "plus" | "premium";

  @ApiProperty({ example: 73, required: false })
  @IsOptional()
  @IsNumber()
  targetWeight?: number;

  @ApiProperty({ type: Object, required: false, default: {} })
  @IsOptional()
  preferences?: { [key: string]: string | boolean | number };
}

export class SignupDto {
  @ApiProperty({
    example: "google",
    enum: ["google", "facebook"],
    required: false,
    description: "OAuth provider (optional, for OAuth signup)",
  })
  @IsOptional()
  @IsEnum(["google", "facebook"])
  provider?: "google" | "facebook";

  @ApiProperty({
    example: "google_id_token_here",
    required: false,
    description: "OAuth ID token (required if provider is specified)",
  })
  @ValidateIf((o) => o.provider !== undefined)
  @IsNotEmpty()
  @IsString()
  idToken?: string;

  @ApiProperty({ example: "user@example.com", required: false })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ example: "password123", required: false })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty({ type: UserDataDto })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => UserDataDto)
  userData: UserDataDto;
}
