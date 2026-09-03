export type AgentAction =
  | { action: 'click'; target: string; reason: string }
  | { action: 'type'; target: string; value: string; reason: string }
  | { action: 'scroll'; amount: number; reason: string }
  | { action: 'back'; reason: string }
  | { action: 'wait'; milliseconds: number; reason: string }
  | { action: 'finish'; reason: string };

export interface AgentState {
  url: string;
  html: string;
  screenshot?: string;
}

export interface AgentMemoryEntry {
  action: string;
  target?: string;
  value?: string;
  url?: string;
  success: boolean;
  reasoning?: string;
}
