// Migrator compares IDs only. Verify their recorded names before applying changes.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface RecordedMigration {
  readonly id: number;
  readonly name: string;
}

export type KnownMigration = readonly [id: number, name: string];

export type MigrationLineageVerdict =
  | { readonly _tag: "Compatible" }
  | { readonly _tag: "DatabaseAhead"; readonly recordedMaxId: number; readonly knownMaxId: number }
  | {
      readonly _tag: "LineageMismatch";
      readonly id: number;
      readonly recordedName: string;
      readonly expectedName: string;
    };

export class MigrationLineageError extends Schema.TaggedErrorClass<MigrationLineageError>()(
  "MigrationLineageError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export function checkMigrationLineage(
  recorded: ReadonlyArray<RecordedMigration>,
  known: ReadonlyArray<KnownMigration>,
): MigrationLineageVerdict {
  if (recorded.length === 0 || known.length === 0) {
    return { _tag: "Compatible" };
  }

  const knownById = new Map(known.map(([id, name]) => [id, name]));
  const knownMaxId = Math.max(...known.map(([id]) => id));
  const recordedMaxId = Math.max(...recorded.map((row) => row.id));

  if (recordedMaxId > knownMaxId) {
    return { _tag: "DatabaseAhead", recordedMaxId, knownMaxId };
  }

  for (const row of recorded) {
    const expectedName = knownById.get(row.id);
    // Migration 40 repairs this pre-review form of migration 39.
    const repairedHistoricalName =
      row.id === 39 &&
      row.name === "ProjectionThreadTitleRegenerationError" &&
      expectedName === "ProjectionThreadTitleRegenerationFailure";
    if (expectedName !== undefined && expectedName !== row.name && !repairedHistoricalName) {
      return {
        _tag: "LineageMismatch",
        id: row.id,
        recordedName: row.name,
        expectedName,
      };
    }
  }

  return { _tag: "Compatible" };
}

const SHARED_ADVICE =
  "This usually means the same ~/.t3 state directory was opened by both this build and a different build of T3 Code (for example the upstream release). Point one of them at its own state directory with T3CODE_HOME (and T3CODE_PORT) before starting it again.";

export function describeMigrationLineageVerdict(
  verdict: Exclude<MigrationLineageVerdict, { _tag: "Compatible" }>,
): string {
  switch (verdict._tag) {
    case "DatabaseAhead":
      return `Refusing to start: the database records migration ${verdict.recordedMaxId}, but this build only knows migrations up to ${verdict.knownMaxId}. Use the same or a newer version of the build that last opened this database, or point this build at a separate state directory with T3CODE_HOME.`;
    case "LineageMismatch":
      return `Refusing to start: the database records migration ${verdict.id} as "${verdict.recordedName}", but this build expects "${verdict.expectedName}" at that id. The two builds have incompatible migration histories. ${SHARED_ADVICE}`;
  }
}

const MIGRATIONS_TABLE = "effect_sql_migrations";

export const assertMigrationLineageCompatible = Effect.fn("assertMigrationLineageCompatible")(
  function* (known: ReadonlyArray<KnownMigration>) {
    const sql = yield* SqlClient.SqlClient;

    const tables =
      yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${MIGRATIONS_TABLE}`;
    if (tables.length === 0) return;
    const rows = yield* sql<{
      readonly migration_id: number;
      readonly name: string;
    }>`SELECT migration_id, name FROM ${sql(MIGRATIONS_TABLE)} ORDER BY migration_id`;

    const recorded = rows.map((row) => ({ id: Number(row.migration_id), name: row.name }));
    const verdict = checkMigrationLineage(recorded, known);
    if (verdict._tag === "Compatible") {
      return;
    }

    return yield* new MigrationLineageError({
      detail: describeMigrationLineageVerdict(verdict),
    });
  },
);
