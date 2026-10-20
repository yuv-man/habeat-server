import { FOOD_A_LITTLE_BETTER_V1 } from "./content/food-a-little-better.v1";
import { FOOD_A_LITTLE_BETTER_V2 } from "./content/food-a-little-better.v2";
import { ChallengeProgram } from "./content/program.types";

/**
 * Every program version ever shipped. Never remove an entry: enrollments pin
 * a version and must still resolve after a newer one ships.
 */
const ALL_VERSIONS: ChallengeProgram[] = [FOOD_A_LITTLE_BETTER_V1, FOOD_A_LITTLE_BETTER_V2];

/** Programs listed in discovery, in display order. */
const LISTED_IDS = ["food-a-little-better"];

export function getProgram(id: string, version?: number): ChallengeProgram | undefined {
  const versions = ALL_VERSIONS.filter((p) => p.id === id);
  if (version === undefined) {
    return versions.sort((a, b) => b.version - a.version)[0];
  }
  return versions.find((p) => p.version === version);
}

export function listPrograms(): ChallengeProgram[] {
  return LISTED_IDS.map((id) => getProgram(id)).filter(
    (p): p is ChallengeProgram => !!p,
  );
}

export function allProgramVersions(): readonly ChallengeProgram[] {
  return ALL_VERSIONS;
}
