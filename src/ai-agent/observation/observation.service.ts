import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiObservation } from '../schemas/ai-observation.schema';
import { LlmService } from '../llm/llm.service';
import { Persona } from '../persona/personas';
import { Scenario } from '../scenario/scenarios';
import logger from '../../utils/logger';

const TYPES = ['usability', 'confusion', 'success', 'abandonment', 'engagement'];
const SEVERITIES = ['low', 'medium', 'high'];
const SENTIMENTS = ['positive', 'neutral', 'negative'];

@Injectable()
export class ObservationService {
  constructor(
    private readonly llm: LlmService,
    @InjectModel(AiObservation.name) private readonly observationModel: Model<any>,
  ) {}

  async analyzeAndSave(
    session: any,
    actions: any[],
    persona: Persona,
    scenario: Scenario,
  ): Promise<void> {
    if (!actions.length) {
      logger.warn(`[ObservationService] Session ${session._id} had no actions — nothing to analyse.`);
      return;
    }

    let observations: any[] = [];
    try {
      observations = await this.llm.analyze({ persona, scenario, actions });
    } catch (err) {
      logger.error(`[ObservationService] Analysis failed: ${(err as Error).message}`);
      return;
    }

    // The model occasionally invents enum values; drop rows Mongo would reject.
    const valid = observations.filter(
      (o) =>
        o?.feature &&
        o?.description &&
        TYPES.includes(o.type) &&
        SEVERITIES.includes(o.severity) &&
        SENTIMENTS.includes(o.sentiment),
    );

    if (valid.length !== observations.length) {
      logger.warn(
        `[ObservationService] Dropped ${observations.length - valid.length} malformed observation(s).`,
      );
    }
    if (!valid.length) return;

    await this.observationModel.insertMany(
      valid.map((obs) => ({
        sessionId: session._id,
        aiUserId: session.aiUserId,
        day: session.day,
        scenarioId: session.scenarioId,
        ...obs,
        evidence: Array.isArray(obs.evidence) ? obs.evidence : [],
      })),
    );
    logger.info(
      `[ObservationService] Saved ${valid.length} observation(s) for session ${session._id}.`,
    );
  }
}
