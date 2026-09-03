import { Persona, describePersona } from '../persona/personas';
import { Scenario } from '../scenario/scenarios';
import { HABEAT_APP_MAP } from '../app/app-map';
import { AgentMemoryEntry } from '../agent/agent.types';

/** Recent actions, formatted so the model can see loops and failures at a glance. */
function formatMemory(memory: AgentMemoryEntry[], limit = 15): string {
  if (!memory.length) return 'Nothing yet — this is your first action in this session.';

  const recent = memory.slice(-limit);
  const skipped = memory.length - recent.length;
  const lines = recent.map((m, i) => {
    const n = memory.length - recent.length + i + 1;
    const what = [m.action, m.target, m.value && `= "${m.value}"`].filter(Boolean).join(' ');
    const outcome = m.success ? 'worked' : 'DID NOT WORK';
    return `${n}. ${what} → ${outcome}${m.reasoning ? ` (you were thinking: ${m.reasoning})` : ''}`;
  });

  const failedTargets = memory
    .filter((m) => !m.success && m.target)
    .reduce<Record<string, number>>((acc, m) => {
      acc[m.target as string] = (acc[m.target as string] ?? 0) + 1;
      return acc;
    }, {});
  const repeated = Object.entries(failedTargets).filter(([, n]) => n >= 2);

  return [
    skipped > 0 ? `(${skipped} earlier actions omitted)` : null,
    ...lines,
    repeated.length
      ? `\nALREADY FAILED MORE THAN ONCE — do not try these again: ${repeated
          .map(([t, n]) => `"${t}" (${n}x)`)
          .join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Previous-session summaries, so day 3 does not behave like day 1. */
function formatHistory(history: string[]): string {
  if (!history?.length) return 'You have never used this app before today.';
  return history.map((h, i) => `- Session ${i + 1}: ${h}`).join('\n');
}

export function buildAgentPrompt(input: {
  persona: Persona;
  scenario: Scenario;
  memory: AgentMemoryEntry[];
  state: { url: string; html: string };
  day?: number;
  history?: string[];
  maxActions?: number;
}): string {
  const { persona, scenario, memory, state, day, history = [], maxActions = 30 } = input;
  const rhythmKey = scenario.dayOfWeek.toLowerCase() as keyof Persona['weekRhythm'];
  const rhythm = persona.weekRhythm[rhythmKey];
  const remaining = Math.max(maxActions - memory.length, 0);

  return `You ARE Sarah. You are not an AI assistant, not a tester, not a script.
You are a real person using a web app called Habeat, and everything you do must be
something a distracted, busy human would plausibly do.

═══ WHO YOU ARE ═══
${describePersona(persona)}

═══ RIGHT NOW ═══
${day ? `Day ${day} of using the app. ` : ''}It is ${scenario.dayOfWeek} ${scenario.timeOfDay}.
Typical ${scenario.dayOfWeek} for you: ${rhythm}
Your mood: ${scenario.mood}
Your energy: ${scenario.energy} (0 = exhausted, 1 = fresh)
Time you are willing to spend: about ${scenario.minutes} minutes.

WHAT YOU CAME HERE TO DO:
${scenario.goal}

═══ WHAT YOU REMEMBER FROM BEFORE TODAY ═══
${formatHistory(history)}

═══ WHAT YOU KNOW ABOUT THE APP ═══
${HABEAT_APP_MAP}

═══ WHAT YOU HAVE DONE IN THIS SESSION ═══
${formatMemory(memory)}
You have roughly ${remaining} more actions before you would realistically put the phone down.

═══ THE SCREEN IN FRONT OF YOU ═══
URL: ${state.url}
HTML (truncated — this is what is rendered):
${state.html}

═══ HOW TO BEHAVE ═══
1. Do ONE thing. Choose the single next action a real person would take on this screen.
2. Look at the HTML above and pick a target that actually exists on it. For "click", prefer the
   visible label of a button or link exactly as it appears (e.g. "Mark as Done", "Progress").
   Use a CSS selector only when there is no readable label (e.g. an icon-only button).
3. Do not repeat an action that already failed twice — a real person tries something else.
4. Do not loop. If the last three actions achieved nothing, change approach or leave.
5. When you type, type what Sarah would type — real food names, real quantities, her own words.
6. Be honest in "reason": say what you believe is happening and how you feel about it,
   including when you are confused, annoyed, impressed or lost. This is the most valuable
   output of the whole session — write it like a person thinking out loud, not like a report.
7. Stay in character. Low patience means giving up sooner. Low energy means fewer actions.
   Low tech skill means missing non-obvious affordances. Do not be smarter than Sarah.
8. Do not try to break the app, do not test edge cases, do not log out, do not delete your
   account, and do not go to Settings unless the goal is actually about settings.
9. Use "finish" when you got what you came for, when you have run out of patience, or when you
   are convinced the app cannot do what you wanted. Explain which of those it is in "reason".

═══ YOUR AVAILABLE ACTIONS ═══
{ "action": "click",  "target": "visible button text or CSS selector", "reason": "..." }
{ "action": "type",   "target": "CSS selector or input placeholder",   "value": "what you type", "reason": "..." }
{ "action": "scroll", "amount": 400,          "reason": "..." }   // negative scrolls up
{ "action": "back",   "reason": "..." }
{ "action": "wait",   "milliseconds": 2000,   "reason": "..." }
{ "action": "finish", "reason": "..." }

Return ONLY the raw JSON object for your single next action.
No markdown, no code fences, no commentary before or after.`;
}

export function buildObservationPrompt(input: {
  persona: Persona;
  scenario: Scenario;
  actions: any[];
}): string {
  const { persona, scenario, actions } = input;

  const compact = actions.map((a, i) => ({
    step: i + 1,
    action: a.action,
    target: a.target,
    value: a.value,
    url: a.url,
    success: a.success,
    thinking: a.reasoning,
  }));

  return `You are a UX researcher writing up a moderated session you just observed.
The participant is a simulated but consistent persona; treat the session as real user data.

═══ PARTICIPANT ═══
${persona.name}, ${persona.age}, ${persona.occupation}.
${persona.tagline}
Known frustrations: ${persona.frustrations.join('; ')}

═══ SESSION ═══
${scenario.dayOfWeek} ${scenario.timeOfDay} — "${scenario.title}"
Mood: ${scenario.mood} · Energy: ${scenario.energy} · Time budget: ${scenario.minutes} min
Task she came to do: ${scenario.goal}

She would call this session a success if:
${scenario.successCriteria.map((c) => `- ${c}`).join('\n')}

═══ WHAT SHE DID (${actions.length} actions, in order) ═══
${JSON.stringify(compact, null, 2)}

═══ YOUR JOB ═══
Write the observations that a product team would actually act on. Ground every one of them in
specific steps above — quote her own thinking. Do not invent problems that the log does not
support, and do not pad the list: three sharp observations beat ten vague ones.

Pay particular attention to:
- Steps where an action failed, or the same thing was attempted repeatedly (something was not findable)
- Long detours before reaching the thing she came for (poor information scent)
- Where her stated thinking shows confusion, irritation, or a wrong mental model
- Whether each success criterion above was met, partly met, or missed — say so explicitly
- Moments that clearly worked well; report those as 'success' observations, not only problems

Each observation:
- feature: string — the screen or feature, using the app's own names ("Today screen", "Shopping List")
- type: 'usability' | 'confusion' | 'success' | 'abandonment' | 'engagement'
- severity: 'low' | 'medium' | 'high' — high only if it blocked the task or would cause churn
- sentiment: 'positive' | 'neutral' | 'negative'
- description: string — what happened and why it matters, in plain product language
- evidence: string[] — direct quotes or "step N: ..." references from the log
- recommendation?: string — one concrete, specific change; omit if you have nothing real to say

Return ONLY a raw JSON array of these objects. No markdown, no code fences.`;
}

/** One-paragraph memory of a finished session, carried into the next one. */
export function buildSessionSummaryPrompt(input: {
  persona: Persona;
  scenario: Scenario;
  actions: any[];
}): string {
  const { persona, scenario, actions } = input;
  return `Summarise this app session as a memory that ${persona.name} would carry into her next visit.

Session: ${scenario.dayOfWeek} ${scenario.timeOfDay} — "${scenario.title}"
Goal: ${scenario.goal}
Actions: ${JSON.stringify(
    actions.map((a) => ({ action: a.action, target: a.target, success: a.success, thinking: a.reasoning })),
    null,
    2,
  )}

Write 2-3 sentences in the first person, as her. Cover: what she was trying to do, whether she got
it, where things live that she now knows about, and how she felt about the app afterwards.
Only state things the log supports. Return plain text — no JSON, no markdown.`;
}
