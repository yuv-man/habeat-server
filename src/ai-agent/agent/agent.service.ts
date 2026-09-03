import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BrowserService } from '../browser/browser.service';
import { LlmService } from '../llm/llm.service';
import { ObservationService } from '../observation/observation.service';
import { AiSession } from '../schemas/ai-session.schema';
import { AiAction } from '../schemas/ai-action.schema';
import { AiTestUser } from '../schemas/ai-test-user.schema';
import { getPersona } from '../persona/personas';
import { Scenario } from '../scenario/scenarios';
import { AgentMemoryEntry } from './agent.types';
import logger from '../../utils/logger';

/** How many previous sessions Sarah "remembers" when she opens the app again. */
const MEMORY_SESSIONS = 3;

/** Hard ceiling regardless of how long the scenario says she has. */
const MAX_ACTIONS_CEILING = 40;
const MIN_ACTIONS = 8;

/** A person does not click 30 times in 4 seconds — pause between actions. */
const THINK_TIME_MS = { min: 400, max: 1400 };

@Injectable()
export class AgentService {
  constructor(
    private readonly browser: BrowserService,
    private readonly llm: LlmService,
    private readonly observation: ObservationService,
    @InjectModel(AiSession.name) private readonly sessionModel: Model<any>,
    @InjectModel(AiAction.name) private readonly actionModel: Model<any>,
    @InjectModel(AiTestUser.name) private readonly userModel: Model<any>,
  ) {}

  async runSession(
    user: any,
    scenario: Scenario,
    options: { advanceDay?: boolean } = {},
  ): Promise<any> {
    const persona = getPersona(user.personaId);
    const day = user.currentDay ?? 1;
    // Roughly three actions per minute of the scenario's time budget.
    const maxActions = Math.min(
      MAX_ACTIONS_CEILING,
      Math.max(MIN_ACTIONS, Math.round(scenario.minutes * 3)),
    );

    logger.info(
      `[AgentService] Day ${day} · ${scenario.dayOfWeek} ${scenario.timeOfDay} · "${scenario.title}" ` +
        `for ${persona.name} (${user._id}), up to ${maxActions} actions`,
    );

    const session = await this.sessionModel.create({
      aiUserId: user._id,
      day,
      scenarioId: scenario.id,
      title: scenario.title,
      dayOfWeek: scenario.dayOfWeek,
      timeOfDay: scenario.timeOfDay,
      mood: scenario.mood,
      goal: scenario.goal,
      startedAt: new Date(),
      status: 'running',
      actionCount: 0,
      maxActions,
    });

    const history = await this.recentMemories(user._id);
    const memory: AgentMemoryEntry[] = [];
    const actionDocs: any[] = [];
    let finishReason = 'Ran out of patience (hit the action limit).';

    try {
      await this.browser.start();
      await this.browser.login(user.email, user.password);

      for (let i = 0; i < maxActions; i++) {
        const state = await this.browser.getState();

        const agentAction = await this.llm.decide({
          persona,
          scenario,
          memory,
          state,
          day,
          history,
          maxActions,
        });

        logger.info(
          `[AgentService] ${i + 1}/${maxActions} ${agentAction.action}` +
            ('target' in agentAction ? ` "${agentAction.target}"` : '') +
            ` — ${agentAction.reason}`,
        );

        if (agentAction.action === 'finish') {
          finishReason = agentAction.reason;
          break;
        }

        let success = false;

        switch (agentAction.action) {
          case 'click': {
            // The model usually gives a visible label; try text first, then CSS.
            success = await this.browser.clickText(agentAction.target);
            if (!success) success = await this.browser.click(agentAction.target);
            break;
          }
          case 'type': {
            success = await this.browser.type(agentAction.target, agentAction.value);
            break;
          }
          case 'scroll': {
            success = await this.browser.scroll(agentAction.amount);
            break;
          }
          case 'back': {
            success = await this.browser.goBack();
            break;
          }
          case 'wait': {
            await this.browser.wait(Math.min(agentAction.milliseconds ?? 1000, 10000));
            success = true;
            break;
          }
        }

        memory.push({
          action: agentAction.action,
          target: 'target' in agentAction ? agentAction.target : undefined,
          value: 'value' in agentAction ? agentAction.value : undefined,
          url: state.url,
          success,
          reasoning: agentAction.reason,
        });

        const actionDoc = await this.actionModel.create({
          sessionId: session._id,
          aiUserId: user._id,
          day,
          action: agentAction.action,
          target: 'target' in agentAction ? agentAction.target : undefined,
          value: 'value' in agentAction ? agentAction.value : undefined,
          reasoning: agentAction.reason,
          url: state.url,
          success,
        });
        actionDocs.push(actionDoc);

        await session.updateOne({ actionCount: i + 1 });
        await this.think();
      }

      // Remember this session for the next one.
      let summary = '';
      try {
        summary = await this.llm.summarize({ persona, scenario, actions: actionDocs });
      } catch (err) {
        logger.warn(`[AgentService] Could not summarise session: ${(err as Error).message}`);
      }

      await session.updateOne({
        status: 'completed',
        finishedAt: new Date(),
        finishReason,
        summary,
      });
      logger.info(
        `[AgentService] Session ${session._id} completed — ${actionDocs.length} actions. ${finishReason}`,
      );

      await this.observation.analyzeAndSave(session, actionDocs, persona, scenario);

      if (options.advanceDay) {
        await this.userModel.updateOne({ _id: user._id }, { $set: { currentDay: day + 1 } });
        logger.info(`[AgentService] Advanced ${persona.name} to day ${day + 1}`);
      }

      return session;
    } catch (err) {
      const message = (err as Error).message;
      logger.error(`[AgentService] Session ${session._id} failed: ${message}`);
      await session.updateOne({ status: 'failed', finishedAt: new Date(), error: message });
      throw err;
    } finally {
      await this.browser.stop();
    }
  }

  /** Summaries of this user's last few completed sessions, oldest first. */
  private async recentMemories(aiUserId: any): Promise<string[]> {
    const sessions = await this.sessionModel
      .find({ aiUserId, status: 'completed', summary: { $nin: [null, ''] } })
      .sort({ startedAt: -1 })
      .limit(MEMORY_SESSIONS)
      .lean();
    return sessions.reverse().map((s: any) => s.summary);
  }

  private async think(): Promise<void> {
    const { min, max } = THINK_TIME_MS;
    await this.browser.wait(min + Math.floor(Math.random() * (max - min)));
  }
}
