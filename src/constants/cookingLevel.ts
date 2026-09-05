/**
 * How much cooking the user is actually willing and able to do.
 *
 * Collected in KYC and editable in the profile. It binds the generator in two
 * ways: a hard ceiling on prep time, and a statement of which techniques the
 * plan may assume. Without it every user got the same 45-minute default, so a
 * beginner's week was full of dishes they would never make — the plan looked
 * fine and went uncooked.
 */
export type CookingLevel = "beginner" | "home-cook" | "confident";

export const COOKING_LEVELS: CookingLevel[] = [
  "beginner",
  "home-cook",
  "confident",
];

export interface CookingLevelSpec {
  /** Hard ceiling on prep time, in minutes, for any single meal. */
  maxPrepMinutes: number;
  /** Short label used in the prompt (not user-facing copy — the client owns that). */
  label: string;
  /** What the generator may and may not assume about technique. */
  guidance: string;
}

export const COOKING_LEVEL_SPECS: Record<CookingLevel, CookingLevelSpec> = {
  beginner: {
    maxPrepMinutes: 20,
    label: "beginner",
    guidance:
      "Assembly, one pan, or one oven tray only. Few ingredients, no marinating, no sauces built from scratch, no technique that needs timing two things at once.",
  },
  "home-cook": {
    maxPrepMinutes: 40,
    label: "comfortable home cook",
    guidance:
      "Standard everyday techniques are fine — sautéing, roasting, boiling, a simple sauce, up to two pans. Nothing that needs specialist equipment or long unattended cooking.",
  },
  confident: {
    maxPrepMinutes: 75,
    label: "confident cook",
    guidance:
      "Multi-step dishes are welcome — marinades, braising, baking, sauces built from scratch, several components plated together.",
  },
};

/** The prep-time ceiling for a level, or null when the user hasn't told us. */
export const prepCeilingFor = (
  level?: CookingLevel | string | null,
): number | null =>
  level && COOKING_LEVEL_SPECS[level as CookingLevel]
    ? COOKING_LEVEL_SPECS[level as CookingLevel].maxPrepMinutes
    : null;
