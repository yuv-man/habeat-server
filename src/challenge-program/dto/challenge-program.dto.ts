import { Allow, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * The global ValidationPipe whitelists properties, so every field the client
 * may send needs a decorator here. Answer shape is checked per action kind in
 * enrollment.rules.ts → validateAnswer.
 */

/** The user's local date (YYYY-MM-DD); the server clamps it to ±1 day of its own. */
class WithToday {
  @IsOptional()
  @IsString()
  today?: string;
}

export class EnrollDto extends WithToday {
  @IsOptional()
  @IsBoolean()
  continueFromLeft?: boolean;
}

export class LessonEventDto extends WithToday {
  @IsIn(["opened", "read"])
  event: "opened" | "read";
}

export class ActionDto extends WithToday {
  @IsIn(["started", "done", "partly", "skipped"])
  status: "started" | "done" | "partly" | "skipped";

  @IsOptional()
  @Allow()
  answer?: unknown;

  /** Answers to the day's optional questions, by index. Checked in enrollment.rules. */
  @IsOptional()
  @Allow()
  extras?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  outcome?: string;
}

export class TodayDto extends WithToday {}
