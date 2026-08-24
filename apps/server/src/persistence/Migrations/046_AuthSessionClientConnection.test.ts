import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe } from "vite-plus/test";

import { runMigrations } from "../Migrations.ts";
import { onFreshDatabase } from "./migrationTestSupport.ts";

describe("046_AuthSessionClientConnection", () => {
  it.effect("upgrades an existing fork database without reusing migration IDs", () =>
    onFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 45 });
        const executed = yield* runMigrations({ toMigrationInclusive: 46 });

        const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
          PRAGMA table_info(auth_sessions)
        `;
        const surface = columns.find((column) => column.name === "client_surface");
        const appVersion = columns.find((column) => column.name === "client_app_version");

        assert.equal(surface?.name, "client_surface");
        assert.equal(surface?.notnull, 0);
        assert.equal(appVersion?.name, "client_app_version");
        assert.equal(appVersion?.notnull, 0);
        assert.deepEqual(executed, [[46, "AuthSessionClientConnection"]]);
      }),
    ),
  );

  it.effect("creates the columns on a fresh database and is idempotent", () =>
    onFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const executed = yield* runMigrations({ toMigrationInclusive: 46 });
        const repeated = yield* runMigrations({ toMigrationInclusive: 46 });
        const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
          PRAGMA table_info(auth_sessions)
        `;

        assert.deepEqual(executed.at(-1), [46, "AuthSessionClientConnection"]);
        assert.deepEqual(repeated, []);
        assert.equal(columns.filter((column) => column.name === "client_surface").length, 1);
        assert.equal(columns.filter((column) => column.name === "client_app_version").length, 1);
      }),
    ),
  );
});
