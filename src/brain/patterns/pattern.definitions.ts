import { PatternCategory } from "./pattern.types";

/**
 * The catalogue of behaviours Habeat knows how to recognise.
 *
 * IDs are permanent and are stored on user documents, cited by interventions
 * and referenced in evidence — renumbering one silently rewrites history, so
 * new patterns take the next free ID and retired ones are marked, never
 * reused.
 */
export interface PatternDefinition {
  id: string;
  name: string;
  description: string;
  category: PatternCategory;
  /** Below this many days of data the detector must not report at all. */
  minimumDataDays: number;
  /** Interventions that address this pattern, in stage order. */
  interventions: string[];
  stages: string[];
}

const FULL_LADDER = [
  "awareness",
  "preparation",
  "replacement",
  "reinforcement",
  "maintenance",
];

export const PATTERN_DEFINITIONS: PatternDefinition[] = [
  {
    id: "P01",
    name: "Irregular meals",
    description:
      "Meals occur at highly inconsistent times or important meals are frequently skipped.",
    category: "timing",
    minimumDataDays: 7,
    interventions: ["I01", "I02", "I03"],
    stages: FULL_LADDER,
  },
  {
    id: "P02",
    name: "All-or-nothing days",
    description:
      "A single missed meal tends to take the rest of the day with it, rather than the next meal happening normally.",
    category: "planning",
    minimumDataDays: 7,
    interventions: ["I10", "I11", "I12"],
    stages: FULL_LADDER,
  },
  {
    id: "P04",
    name: "Late-night eating",
    description: "A recurring pattern of eating late in the evening or at night.",
    category: "timing",
    minimumDataDays: 7,
    interventions: ["I04", "I05", "I06"],
    stages: FULL_LADDER,
  },
  {
    id: "P08",
    name: "Frequent takeaway",
    description:
      "Takeaway meals occur frequently, especially when planning or preparation is difficult.",
    category: "planning",
    minimumDataDays: 7,
    interventions: ["I07", "I08", "I09"],
    stages: FULL_LADDER,
  },
];

export const patternById = (id: string): PatternDefinition | undefined =>
  PATTERN_DEFINITIONS.find((p) => p.id === id);
