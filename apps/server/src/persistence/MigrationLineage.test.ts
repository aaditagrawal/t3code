import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { makeRuntimeSqliteLayer } from "./Layers/RuntimeSqliteLayer.ts";
import { describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";

import {
  assertMigrationLineageCompatible,
  checkMigrationLineage,
  describeMigrationLineageVerdict,
  type KnownMigration,
  type RecordedMigration,
} from "./MigrationLineage.ts";
import { migrationManifest } from "./Migrations.ts";

const known: ReadonlyArray<KnownMigration> = [
  [1, "OrchestrationEvents"],
  [2, "OrchestrationCommandReceipts"],
  [3, "CheckpointDiffBlobs"],
];

const recorded = (...rows: ReadonlyArray<readonly [number, string]>): Array<RecordedMigration> =>
  rows.map(([id, name]) => ({ id, name }));

describe("checkMigrationLineage", () => {
  it("accepts a fresh database with no recorded migrations", () => {
    expect(checkMigrationLineage([], known)).toEqual({ _tag: "Compatible" });
  });

  it("accepts a database that exactly matches this build", () => {
    const verdict = checkMigrationLineage(
      recorded([1, "OrchestrationEvents"], [2, "OrchestrationCommandReceipts"]),
      known,
    );
    expect(verdict).toEqual({ _tag: "Compatible" });
  });

  it("accepts a database that lags behind this build", () => {
    // Only migration 1 applied; 2 and 3 are still pending and will be run.
    expect(checkMigrationLineage(recorded([1, "OrchestrationEvents"]), known)).toEqual({
      _tag: "Compatible",
    });
  });

  it("rejects a database written by a build with more migrations", () => {
    const verdict = checkMigrationLineage(
      recorded([1, "OrchestrationEvents"], [9, "SomethingFromAnotherBuild"]),
      known,
    );
    expect(verdict).toEqual({ _tag: "DatabaseAhead", recordedMaxId: 9, knownMaxId: 3 });
  });

  it("rejects a database where the same id records a different migration name", () => {
    // This is the fork-vs-upstream case: same name, different id, so some id
    // necessarily disagrees.
    const verdict = checkMigrationLineage(
      recorded([1, "OrchestrationEvents"], [2, "ProjectionThreadsPinned"]),
      known,
    );
    expect(verdict).toEqual({
      _tag: "LineageMismatch",
      id: 2,
      recordedName: "ProjectionThreadsPinned",
      expectedName: "OrchestrationCommandReceipts",
    });
  });

  it("reports the first mismatching id deterministically", () => {
    const verdict = checkMigrationLineage(recorded([2, "Wrong"], [3, "AlsoWrong"]), known);
    expect(verdict).toMatchObject({ _tag: "LineageMismatch", id: 2 });
  });

  it("accepts this build's own manifest replayed back", () => {
    const selfRecorded = migrationManifest.map(([id, name]) => ({ id, name }));
    expect(checkMigrationLineage(selfRecorded, migrationManifest)).toEqual({ _tag: "Compatible" });
  });

  it("rejects an upstream-shaped lineage against this build's manifest", () => {
    // Upstream records AuthAuthorizationScopes at 31; this fork has it at 34,
    // with ProjectionThreadShellArchiveIndexes at 33. Any upstream-written row
    // in the renumbered range disagrees with ours.
    const verdict = checkMigrationLineage(
      [{ id: 31, name: "AuthAuthorizationScopes" }],
      migrationManifest,
    );
    expect(verdict._tag).toBe("LineageMismatch");
  });
});

describe("describeMigrationLineageVerdict", () => {
  it("explains a database-ahead refusal and names the escape hatch", () => {
    const message = describeMigrationLineageVerdict({
      _tag: "DatabaseAhead",
      recordedMaxId: 41,
      knownMaxId: 36,
    });
    expect(message).toContain("41");
    expect(message).toContain("36");
    expect(message).toContain("T3CODE_HOME");
  });

  it("explains a lineage mismatch with both names", () => {
    const message = describeMigrationLineageVerdict({
      _tag: "LineageMismatch",
      id: 34,
      recordedName: "ProjectionThreadsSnoozed",
      expectedName: "AuthAuthorizationScopes",
    });
    expect(message).toContain("ProjectionThreadsSnoozed");
    expect(message).toContain("AuthAuthorizationScopes");
    expect(message).toContain("T3CODE_HOME");
  });
});

describe("assertMigrationLineageCompatible", () => {
  it.effect("accepts a database without a migrations table", () =>
    assertMigrationLineageCompatible(known).pipe(
      Effect.provide(makeRuntimeSqliteLayer({ filename: ":memory:" })),
    ),
  );

  it.effect("propagates unreadable migration history instead of treating it as fresh", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE effect_sql_migrations (migration_id integer primary key)`;
      const result = yield* Effect.exit(assertMigrationLineageCompatible(known));
      expect(result._tag).toBe("Failure");
    }).pipe(Effect.provide(makeRuntimeSqliteLayer({ filename: ":memory:" }))),
  );

  it.effect("rejects a conflicting recorded migration before migration execution", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE effect_sql_migrations (migration_id integer primary key, name text)`;
      yield* sql`INSERT INTO effect_sql_migrations VALUES (1, 'DifferentLineage')`;
      const result = yield* Effect.exit(assertMigrationLineageCompatible(known));
      expect(result._tag).toBe("Failure");
      expect(String(result)).toContain("MigrationLineageError");
    }).pipe(Effect.provide(makeRuntimeSqliteLayer({ filename: ":memory:" }))),
  );
});
