import { BrainState } from "./decision/brain-state.types";

/**
 * Renders BrainState as the brief the meal generator receives.
 *
 * There is exactly one of these. Before the Brain existed the generator was
 * handed the behaviour analyst's prose directly; now that prose arrives
 * *inside* a state that has already reconciled it against a staged decision,
 * and this function is the only place that turns state into instructions.
 *
 * Ordering is deliberate: the committed behavioural instruction comes first,
 * because when the analyst's brief and the active intervention pull in
 * different directions the model follows whichever it read first.
 */
export const renderPlannerContext = (state: BrainState): string | null => {
  // An unreliable state is worse than none: the model will happily build a
  // whole week around a pattern seen twice.
  if (state.confidence === "insufficient") return null;

  const lines: string[] = [];
  const { decision, analysis } = state;

  if (decision.patternId && decision.mealStrategy) {
    lines.push(
      `ACTIVE BEHAVIOUR — ${decision.patternName} (${decision.patternId}), stage: ${decision.stage}.`,
      `MEAL STRATEGY (this is the requirement, not a suggestion): ${decision.mealStrategy}`,
    );

    if (decision.successMetric) {
      lines.push(`This week is judged on: ${decision.successMetric}`);
    }

    // The stage governs how hard the plan may push. Without this the model
    // reads "late-night eating" and reaches for restriction, which at the
    // awareness stage is precisely the wrong move.
    lines.push(stageGuidance(decision.stage));

    const evidence = state.patterns.find(
      (p) => p.patternId === decision.patternId,
    )?.evidence;
    if (evidence?.length) {
      lines.push(
        `Observed: ${evidence.map((e) => e.description).join(" ")}`,
      );
    }
  }

  const directives = analysis.directives;
  if (directives) {
    const notes: string[] = [];
    if (directives.maxPrepMinutes) {
      notes.push(`keep prep at or under ${directives.maxPrepMinutes} minutes`);
    }
    if (directives.simplifySlots.length) {
      notes.push(`simplify: ${directives.simplifySlots.join(", ")}`);
    }
    if (directives.flexibleSlots.length) {
      notes.push(`keep flexible: ${directives.flexibleSlots.join(", ")}`);
    }
    if (directives.weekendNeedsOwnShape) {
      notes.push("the weekend needs its own shape");
    }
    if (directives.increaseVariety) notes.push("increase variety");
    if (directives.reduceLateEating) notes.push("pull the last meal earlier");
    if (directives.emphasiseMacro) {
      notes.push(`emphasise ${directives.emphasiseMacro}`);
    }

    if (notes.length) lines.push(`PLANNING CONSTRAINTS: ${notes.join("; ")}.`);
    if (directives.notes.length) lines.push(...directives.notes);
  }

  if (analysis.plannerBrief) {
    lines.push(
      `COACH'S NOTES on this user, from a month of their logs:\n${analysis.plannerBrief}`,
    );
  }

  return lines.length ? lines.join("\n") : null;
};

const stageGuidance = (stage: string | null): string => {
  switch (stage) {
    case "awareness":
      return "STAGE RULE — awareness: do not restrict or remove anything yet. Keep meals familiar and easy to follow; the goal this week is that the user keeps logging, nothing more.";
    case "preparation":
      return "STAGE RULE — preparation: introduce one predictable, low-effort anchor. Change one thing, not the whole week.";
    case "replacement":
      return "STAGE RULE — replacement: actively substitute the problem behaviour with a concrete alternative the user can reach for.";
    case "reinforcement":
      return "STAGE RULE — reinforcement: keep what is working and make it easier to repeat. Avoid introducing new demands.";
    case "maintenance":
      return "STAGE RULE — maintenance: the change is established. Protect it with variety so the user does not drift back out of boredom.";
    default:
      return "STAGE RULE — hold the current approach.";
  }
};
