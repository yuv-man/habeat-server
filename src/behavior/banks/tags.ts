/**
 * The tag vocabularies the pattern and suggestion banks are keyed on.
 *
 * Derived from the banks themselves so the two can never drift: a tag the
 * analyst is offered is, by construction, one that selects a real row.
 */

import { PATTERN_BANK } from "./patterns.bank";
import { SUGGESTION_BANK } from "./suggestions.bank";

const unique = (values: string[]): string[] => [...new Set(values)].sort();

export const PATTERN_TAGS = unique(PATTERN_BANK.flatMap((p) => p.tags));

export const SUGGESTION_TAGS = unique(SUGGESTION_BANK.flatMap((s) => s.tags));
