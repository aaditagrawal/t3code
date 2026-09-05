import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("021_RepairProjectionThreadProposedPlanImplementationColumns", (it) => {
  it.effect(
    "repairs missing proposed plan implementation columns when migration history is ahead",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 13 });

        yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (14, 'ProjectionThreadProposedPlanImplementation'),
          (15, 'ProjectionTurnsSourceProposedPlan'),
          (16, 'CanonicalizeModelSelections'),
          (17, 'ProjectionThreadsArchivedAt'),
          (18, 'ProjectionThreadsArchivedAtIndex'),
          (19, 'ProjectionSnapshotLookupIndexes'),
          (20, 'AuthAccessManagement'),
          (21, 'AuthSessionClientMetadata'),
          (22, 'AuthSessionLastConnectedAt'),
          (23, 'NormalizeLegacyProviderKinds')
      `;

        const columnsBeforeRepair = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_proposed_plans)
      `;
        assert.ok(!columnsBeforeRepair.some((column) => column.name === "implemented_at"));
        assert.ok(
          !columnsBeforeRepair.some((column) => column.name === "implementation_thread_id"),
        );

        // Only run through the repair migration itself (registered id 24).
        // Running the rest of the chain (e.g. migration #28 touches
        // `model_selection_json`) would fail because the faked-as-ran
        // migration 16 never actually executed in this scenario, so the
        // column doesn't exist. The test only asserts the repair migration's
        // own behavior, so stopping after it is safe and accurate.
        yield* runMigrations({ toMigrationInclusive: 24 });

        const columnsAfterRepair = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_proposed_plans)
      `;
        assert.ok(columnsAfterRepair.some((column) => column.name === "implemented_at"));
        assert.ok(columnsAfterRepair.some((column) => column.name === "implementation_thread_id"));
      }),
  );
});
