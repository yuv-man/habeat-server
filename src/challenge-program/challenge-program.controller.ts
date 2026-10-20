import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { getLocalDateKey } from "../utils/helpers";
import { ActionDto, EnrollDto, LessonEventDto, TodayDto } from "./dto/challenge-program.dto";
import { daysBetween, isDateKey } from "./enrollment.rules";
import { EnrollmentService } from "./enrollment.service";

/**
 * The user's local calendar day. Unlocks are per local day, and the server has
 * no per-user timezone yet, so the client sends its date. Anything further
 * than a day from the server's own date is ignored, so a wrong clock can't
 * unlock the journey early.
 */
export function resolveToday(clientToday?: string, now = new Date()): string {
  const serverToday = getLocalDateKey(now);
  if (isDateKey(clientToday) && Math.abs(daysBetween(serverToday, clientToday)) <= 1) {
    return clientToday;
  }
  return serverToday;
}

const userIdOf = (req: any): string => req.user._id.toString();

@Controller("programs")
@UseGuards(AuthGuard("jwt"))
export class ProgramController {
  constructor(private readonly enrollmentService: EnrollmentService) {}

  @Get()
  list() {
    return { success: true, data: { programs: this.enrollmentService.listPrograms() } };
  }

  @Get(":id")
  preview(@Param("id") id: string) {
    return { success: true, data: this.enrollmentService.getPreview(id) };
  }

  @Post(":id/enroll")
  async enroll(@Request() req: any, @Param("id") id: string, @Body() body: EnrollDto) {
    const data = await this.enrollmentService.enroll(userIdOf(req), id, resolveToday(body.today), {
      continueFromLeft: body.continueFromLeft,
    });
    return { success: true, data };
  }
}

@Controller("enrollments")
@UseGuards(AuthGuard("jwt"))
export class EnrollmentController {
  constructor(private readonly enrollmentService: EnrollmentService) {}

  @Get("active")
  async active(@Request() req: any, @Query() query: TodayDto) {
    const data = await this.enrollmentService.getActive(userIdOf(req), resolveToday(query.today));
    return { success: true, data };
  }

  @Get("history")
  async history(@Request() req: any) {
    return { success: true, data: { enrollments: await this.enrollmentService.getHistory(userIdOf(req)) } };
  }

  @Post(":id/days/:day/lesson")
  async lesson(
    @Request() req: any,
    @Param("id") id: string,
    @Param("day", ParseIntPipe) day: number,
    @Body() body: LessonEventDto,
  ) {
    const data = await this.enrollmentService.recordLesson(
      userIdOf(req),
      id,
      day,
      body.event,
      resolveToday(body.today),
    );
    return { success: true, data };
  }

  @Get(":id/days/:day")
  async day(@Request() req: any, @Param("id") id: string, @Param("day", ParseIntPipe) day: number) {
    return { success: true, data: await this.enrollmentService.getDay(userIdOf(req), id, day) };
  }

  @Post(":id/days/:day/action")
  async action(
    @Request() req: any,
    @Param("id") id: string,
    @Param("day", ParseIntPipe) day: number,
    @Body() body: ActionDto,
  ) {
    const { today, ...input } = body;
    const data = await this.enrollmentService.recordAction(
      userIdOf(req),
      id,
      day,
      { ...input, source: "manual" },
      resolveToday(today),
    );
    return { success: true, data };
  }

  @Post(":id/pause")
  async pause(@Request() req: any, @Param("id") id: string, @Body() body: TodayDto) {
    return { success: true, data: await this.enrollmentService.pause(userIdOf(req), id, resolveToday(body.today)) };
  }

  @Post(":id/resume")
  async resume(@Request() req: any, @Param("id") id: string, @Body() body: TodayDto) {
    return { success: true, data: await this.enrollmentService.resume(userIdOf(req), id, resolveToday(body.today)) };
  }

  @Post(":id/leave")
  async leave(@Request() req: any, @Param("id") id: string) {
    return { success: true, data: await this.enrollmentService.leave(userIdOf(req), id) };
  }
}
