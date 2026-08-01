import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe } from "vite-plus/test";

import { runMigrations } from "../Migrations.ts";
import { columnNames, onFreshDatabase } from "./migrationTestSupport.ts";

const FAILURE_COLUMNS = [
  "title_regeneration_failure_request_id",
  "title_regeneration_failure_at",
  "title_regeneration_failure_error",
] as const;

const projectionThreadColumns = columnNames("projection_threads");

describe("036_ProjectionThreadTitleRegenerationFailure", () => {
  it.effect("adds the title regeneration failure columns", () =>
    onFreshDatabase(
      Effect.gen(function* () {
        yield* runMigrations({ toMigrationInclusive: 38 });

        const before = yield* projectionThreadColumns;
        for (const column of FAILURE_COLUMNS) {
          assert.ok(!before.includes(column), `${column} should not exist before 39`);
        }

        yield* runMigrations({ toMigrationInclusive: 39 });

        const after = yield* projectionThreadColumns;
        for (const column of FAILURE_COLUMNS) {
          assert.ok(after.includes(column), `${column} should exist after 39`);
        }
        // The pending columns stay separate so "in flight" keeps its meaning.
        assert.ok(after.includes("title_regeneration_request_id"));
        assert.ok(after.includes("title_regeneration_started_at"));
      }),
    ),
  );

  it.effect("skips columns that already exist", () =>
    onFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 38 });
        yield* sql`
          ALTER TABLE projection_threads
          ADD COLUMN title_regeneration_failure_at TEXT
        `;

        // Exercises the PRAGMA guard rather than the migrator's id bookkeeping:
        // without it this dies on "duplicate column name: …_failure_at".
        yield* runMigrations({ toMigrationInclusive: 39 });

        const columns = yield* projectionThreadColumns;
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
});
