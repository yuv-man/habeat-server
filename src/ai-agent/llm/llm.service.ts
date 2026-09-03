import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateTextWithRateLimit } from '../../utils/gemini-rate-limiter';
import { AgentAction, AgentMemoryEntry } from '../agent/agent.types';
import { Persona } from '../persona/personas';
import { Scenario } from '../scenario/scenarios';
import {
  buildAgentPrompt,
  buildObservationPrompt,
  buildSessionSummaryPrompt,
} from './llm.prompts';
import logger from '../../utils/logger';

@Injectable()
export class LlmService {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY') ?? '';
    this.model = this.config.get<string>('AI_AGENT_MODEL') ?? 'gemini-2.5-flash';
  }

  async decide(input: {
    persona: Persona;
    scenario: Scenario;
    memory: AgentMemoryEntry[];
    state: { url: string; html: string };
    day?: number;
    history?: string[];
    maxActions?: number;
  }): Promise<AgentAction> {
    const prompt = buildAgentPrompt(input);
    const raw = await generateTextWithRateLimit(this.apiKey, this.model, prompt);
    const parsed = this.parseJson(raw);
    if (!parsed || typeof parsed.action !== 'string') {
      logger.warn(`[LlmService] Unparseable decision, ending session. Raw: ${raw?.slice(0, 300)}`);
      return { action: 'finish', reason: 'The model returned an action I could not understand.' };
    }
    return parsed as AgentAction;
  }

  async analyze(input: {
    persona: Persona;
    scenario: Scenario;
    actions: any[];
  }): Promise<any[]> {
    const prompt = buildObservationPrompt(input);
    const raw = await generateTextWithRateLimit(this.apiKey, this.model, prompt);
    const parsed = this.parseJson(raw);
    if (Array.isArray(parsed)) return parsed;
    return parsed?.observations ?? [];
  }

  /** Short first-person memory of the session, carried into the next one. */
  async summarize(input: {
    persona: Persona;
    scenario: Scenario;
    actions: any[];
  }): Promise<string> {
    const prompt = buildSessionSummaryPrompt(input);
    const raw = await generateTextWithRateLimit(this.apiKey, this.model, prompt);
    return (raw ?? '').trim();
  }

  /**
   * Models wrap JSON in fences, prose, or both. Strip fences, then fall back to
   * the first balanced {...} or [...] in the text. Returns null if nothing parses.
   */
  private parseJson(text: string): any {
    if (!text) return null;
    const cleaned = text
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      /* fall through */
    }

    const start = cleaned.search(/[[{]/);
    if (start === -1) return null;
    const open = cleaned[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === open) depth++;
      else if (cleaned[i] === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}
