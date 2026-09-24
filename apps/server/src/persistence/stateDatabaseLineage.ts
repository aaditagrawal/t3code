/**
 * Live database filenames, oldest first. Startup adopts the newest file that
 * already exists when the current filename is missing, so a later rename still
 * finds the previous database. Append the new filename at the end when it changes.
 */
export const STATE_DATABASE_LINEAGE = ["state.sqlite", "statev2.sqlite"] as const;

export const LIVE_STATE_DATABASE_FILENAME: (typeof STATE_DATABASE_LINEAGE)[number] =
  STATE_DATABASE_LINEAGE[STATE_DATABASE_LINEAGE.length - 1] ?? "statev2.sqlite";

/** Newest previous filename first. An unknown destination adopts the whole lineage. */
export function adoptionSourceFilenames(destinationFilename: string): readonly string[] {
  const lineage = STATE_DATABASE_LINEAGE as readonly string[];
  const index = lineage.indexOf(destinationFilename);
  const older = index === -1 ? lineage : lineage.slice(0, Math.max(index, 0));
  return [...older].reverse();
}

/** Newest live filename first, for discovering an existing database. */
export function stateDatabaseCandidates(): readonly string[] {
  return [...STATE_DATABASE_LINEAGE].reverse();
}
