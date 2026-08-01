import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe } from "vite-plus/test";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

/**
 * Each case gets its own database.
 *
 * The shared-layer idiom used elsewhere in this directory hands every case in a
 * block the same in-memory database, so once one case migrates to the head id
 * the migrator skips every later `runMigrations` call — the bodies under test
 * never execute again and the cases pass vacuously. That is exactly the failure
 * mode being guarded against here, so the database has to be per-case.
 */
const onFreshDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.provide(effect, NodeSqliteClient.layerMemory());

/** Raw PRAGMA rows, not a Set — a Set cannot express a duplicate column. */
const columnNames = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  return columns.map((column) => column.name);
});

const FAILURE_COLUMNS = [
  "title_regeneration_failure_request_id",
  "title_regeneration_failure_at",
  "title_regeneration_failure_error",
] as const;

describe("037_RepairProjectionThreadTitleRegenerationFailure", () => {
  it.effect("adds the failure columns to a database that applied the pre-review 39", () =>
    onFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // Reproduce the shape migration 39 had before it was rewritten: one
        // `title_regeneration_error` column, recorded under the old name. The
        // migrator skips by id without comparing names, so the rewritten 39 is
        // treated as already applied and never runs.
        yield* runMigrations({ toMigrationInclusive: 38 });
        yield* sql`
          ALTER TABLE projection_threads
          ADD COLUMN title_regeneration_error TEXT
        `;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (39, 'ProjectionThreadTitleRegenerationError')
        `;

        // The defect itself: 39 is skipped, so the columns are genuinely absent.
        const beforeRepair = yield* columnNames;
        for (const column of FAILURE_COLUMNS) {
          assert.ok(
            !beforeRepair.includes(column),
            `${column} should be missing before the repair`,
          );
        }

        const executed = yield* runMigrations({ toMigrationInclusive: 40 });
        assert.deepStrictEqual(
          executed.map(([id]) => id),
          [40],
        );

        const afterRepair = yield* columnNames;
        for (const column of FAILURE_COLUMNS) {
          assert.ok(afterRepair.includes(column), `${column} should exist after the repair`);
        }
      }),
    ),
  );

  it.effect("no-ops on a fresh database where 39 already added the columns", () =>
    onFreshDatabase(
      Effect.gen(function* () {
        // Without the PRAGMA guard this dies on "duplicate column name": on a
        // fresh install 39 and 40 run in the same pass, 39 having just added
        // every column 40 adds.
        const executed = yield* runMigrations({ toMigrationInclusive: 40 });
        assert.ok(executed.some(([id]) => id === 40));

        const columns = yield* columnNames;
        for (const column of FAILURE_COLUMNS) {
          assert.strictEqual(
            columns.filter((name) => name === column).length,
            1,
            `${column} should exist exactly once`,
          );
        }
      }),
    ),
  );

  it.effect("leaves the pending columns untouched", () =>
    onFreshDatabase(
      Effect.gen(function* () {
        yield* runMigrations({ toMigrationInclusive: 40 });

        // The repair must not disturb the pending record, whose separation from
        // the failure state is what keeps older clients working.
        const columns = yield* columnNames;
        assert.ok(columns.includes("title_regeneration_request_id"));
        assert.ok(columns.includes("title_regeneration_started_at"));
      }),
    ),
  );
});
