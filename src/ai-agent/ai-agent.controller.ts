import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AgentService } from './agent/agent.service';
import { AiTestUser } from './schemas/ai-test-user.schema';
import { AiSession } from './schemas/ai-session.schema';
import { AiAction } from './schemas/ai-action.schema';
import { AiObservation } from './schemas/ai-observation.schema';
import { SCENARIOS, WEEK_PLAN, Scenario, getScenariosForDay } from './scenario/scenarios';
import { PERSONAS } from './persona/personas';
import logger from '../utils/logger';

@Controller('ai-agent')
export class AiAgentController {
  constructor(
    private readonly agentService: AgentService,
    @InjectModel(AiTestUser.name) private readonly userModel: Model<any>,
    @InjectModel(AiSession.name) private readonly sessionModel: Model<any>,
    @InjectModel(AiAction.name) private readonly actionModel: Model<any>,
    @InjectModel(AiObservation.name) private readonly observationModel: Model<any>,
  ) {}

  // ─── Test users ──────────────────────────────────────────────────────────

  /** POST /ai-agent/users — register an AI test user (must already exist in the app). */
  @Post('users')
  async createUser(@Body() body: any) {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('email and password are required');
    }
    return this.userModel.findOneAndUpdate(
      { email: body.email },
      {
        name: body.name ?? 'Sarah AI',
        email: body.email,
        password: body.password,
        personaId: body.personaId ?? 'busy-health-beginner',
        startDate: new Date(),
        status: 'active',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  /** GET /ai-agent/users */
  @Get('users')
  async listUsers() {
    return this.userModel.find().sort({ createdAt: -1 });
  }

  /** GET /ai-agent/personas */
  @Get('personas')
  listPersonas() {
    return Object.values(PERSONAS).map((p) => ({
      id: p.id,
      name: p.name,
      age: p.age,
      occupation: p.occupation,
      tagline: p.tagline,
    }));
  }

  // ─── Scenario catalogue ──────────────────────────────────────────────────

  /** GET /ai-agent/scenarios — every scenario plus the simulated week. */
  @Get('scenarios')
  listScenarios() {
    return {
      week: Object.entries(WEEK_PLAN).map(([day, entry]) => ({
        day: Number(day),
        dayOfWeek: entry.dayOfWeek,
        scenarios: entry.scenarios,
      })),
      scenarios: Object.entries(SCENARIOS).map(([key, s]) => ({
        key,
        id: s.id,
        title: s.title,
        dayOfWeek: s.dayOfWeek,
        timeOfDay: s.timeOfDay,
        minutes: s.minutes,
        focus: s.focus,
      })),
    };
  }

  // ─── Running sessions ────────────────────────────────────────────────────

  /** POST /ai-agent/run — run one scenario. Body: { userId?, scenarioId? } */
  @Post('run')
  async run(@Body() body: { userId?: string; scenarioId?: string }) {
    const user = await this.resolveUser(body.userId);
    const scenario = this.resolveScenario(body.scenarioId ?? 'firstVisit');

    // Fire and forget — a session takes several minutes.
    this.agentService
      .runSession(user, scenario)
      .catch((err) => logger.error(`[AiAgent] Session failed: ${err.message}`));

    return {
      success: true,
      message: 'Session started in the background. Poll GET /ai-agent/sessions for progress.',
      user: user.email,
      scenario: { id: scenario.id, title: scenario.title },
    };
  }

  /**
   * POST /ai-agent/run-day — run every scenario scheduled for a day, in order.
   * Body: { userId?, day? }. Defaults to the user's current day, then advances it.
   */
  @Post('run-day')
  async runDay(@Body() body: { userId?: string; day?: number }) {
    const user = await this.resolveUser(body.userId);
    const day = body.day ?? user.currentDay ?? 1;
    const scenarios = getScenariosForDay(day);

    if (!scenarios.length) {
      throw new BadRequestException(
        `No scenarios scheduled for day ${day}. The week runs from day 1 (Monday) to day 7 (Sunday).`,
      );
    }

    void this.runSequentially(user, day, scenarios);

    return {
      success: true,
      message: `Running ${scenarios.length} session(s) for day ${day} in the background.`,
      user: user.email,
      day,
      dayOfWeek: WEEK_PLAN[day]?.dayOfWeek,
      scenarios: scenarios.map((s) => s.title),
    };
  }

  /**
   * POST /ai-agent/run-week — the whole simulated week, day 1 to day 7, in order.
   * This is long-running (roughly 20 sessions); it streams into MongoDB as it goes.
   */
  @Post('run-week')
  async runWeek(@Body() body: { userId?: string; fromDay?: number; toDay?: number }) {
    const user = await this.resolveUser(body.userId);
    const fromDay = body.fromDay ?? 1;
    const toDay = body.toDay ?? 7;

    void (async () => {
      for (let day = fromDay; day <= toDay; day++) {
        await this.runSequentially(user, day, getScenariosForDay(day));
      }
      logger.info(`[AiAgent] Finished simulated week for ${user.email}`);
    })();

    return {
      success: true,
      message: `Running days ${fromDay}-${toDay} in the background. This takes a while.`,
      user: user.email,
      totalSessions: Array.from({ length: toDay - fromDay + 1 }, (_, i) =>
        getScenariosForDay(fromDay + i).length,
      ).reduce((a, b) => a + b, 0),
    };
  }

  // ─── Inspecting results ──────────────────────────────────────────────────

  /** GET /ai-agent/sessions?limit=20 */
  @Get('sessions')
  async listSessions(@Query('limit') limit = '20') {
    return this.sessionModel
      .find()
      .sort({ startedAt: -1 })
      .limit(Math.min(Number(limit) || 20, 100))
      .select('day dayOfWeek timeOfDay scenarioId title status actionCount finishReason startedAt finishedAt')
      .lean();
  }

  /** GET /ai-agent/sessions/:id — the full session: actions, observations, memory. */
  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid session id');
    const session = await this.sessionModel.findById(id).lean();
    if (!session) throw new NotFoundException('Session not found');

    const [actions, observations] = await Promise.all([
      this.actionModel.find({ sessionId: id }).sort({ createdAt: 1 }).lean(),
      this.observationModel.find({ sessionId: id }).lean(),
    ]);

    return { session, actions, observations };
  }

  /** GET /ai-agent/observations?severity=high&sentiment=negative */
  @Get('observations')
  async listObservations(
    @Query('severity') severity?: string,
    @Query('sentiment') sentiment?: string,
    @Query('type') type?: string,
  ) {
    const filter: Record<string, string> = {};
    if (severity) filter.severity = severity;
    if (sentiment) filter.sentiment = sentiment;
    if (type) filter.type = type;
    return this.observationModel.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }

  /** GET /ai-agent/report — what the week actually told us, grouped by feature. */
  @Get('report')
  async report() {
    const [byFeature, bySeverity, sessions] = await Promise.all([
      this.observationModel.aggregate([
        {
          $group: {
            _id: '$feature',
            total: { $sum: 1 },
            negative: { $sum: { $cond: [{ $eq: ['$sentiment', 'negative'] }, 1, 0] } },
            high: { $sum: { $cond: [{ $eq: ['$severity', 'high'] }, 1, 0] } },
          },
        },
        { $sort: { high: -1, negative: -1 } },
      ]),
      this.observationModel.aggregate([{ $group: { _id: '$severity', count: { $sum: 1 } } }]),
      this.sessionModel.countDocuments(),
    ]);

    return { sessions, bySeverity, byFeature };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async resolveUser(userId?: string): Promise<any> {
    const query = userId ? { _id: userId } : { status: 'active' };
    // lean() — sessions copy the user with an overridden currentDay.
    const user = await this.userModel.findOne(query).sort({ createdAt: -1 })
      .lean<any>()
      .exec();
    if (!user) {
      throw new NotFoundException(
        'No active AI test user found. Create one via POST /ai-agent/users first.',
      );
    }
    return user;
  }

  /** Accepts either a SCENARIOS key ("quickLunch") or a scenario id ("quick-lunch"). */
  private resolveScenario(idOrKey: string): Scenario {
    const scenario =
      SCENARIOS[idOrKey] ?? Object.values(SCENARIOS).find((s) => s.id === idOrKey);
    if (!scenario) {
      throw new BadRequestException(
        `Unknown scenario "${idOrKey}". Available: ${Object.keys(SCENARIOS).join(', ')}`,
      );
    }
    return scenario;
  }

  /** Sessions within a day must not overlap — one browser, one Sarah. */
  private async runSequentially(user: any, day: number, scenarios: Scenario[]) {
    for (const [index, scenario] of scenarios.entries()) {
      const isLast = index === scenarios.length - 1;
      try {
        await this.agentService.runSession({ ...user, currentDay: day }, scenario, {
          advanceDay: isLast,
        });
      } catch (err) {
        logger.error(
          `[AiAgent] Day ${day} scenario "${scenario.title}" failed: ${(err as Error).message}`,
        );
      }
    }
  }
}
