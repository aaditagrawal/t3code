import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("029_BackfillForkProviderInstanceIds", (it) => {
  it.effect("backfills provider_instance_id for fork drivers across both routing tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Run all migrations up to (and including) 028 so the
      // `provider_instance_id` column exists but is left NULL for
      // historical rows.
      yield* runMigrations({ toMigrationInclusive: 30 });

      // Seed a project + thread for each fork driver to satisfy the
      // foreign-key relationships used by the projection tables.
      const forkKinds = ["amp", "copilot", "geminiCli", "kilo"] as const;
      for (const kind of forkKinds) {
        yield* sql`
            INSERT INTO projection_projects (
              project_id,
              title,
              workspace_root,
              scripts_json,
              created_at,
              updated_at,
              deleted_at,
              default_model_selection_json
            )
            VALUES (
              ${`project-${kind}`},
              ${`Project ${kind}`},
              ${`/tmp/project-${kind}`},
              '[]',
              '2026-01-01T00:00:00.000Z',
              '2026-01-01T00:00:00.000Z',
              NULL,
              NULL
            )
          `;

        yield* sql`
            INSERT INTO projection_threads (
              thread_id,
              project_id,
              title,
              model_selection_json,
              runtime_mode,
              interaction_mode,
              branch,
              worktree_path,
              latest_turn_id,
              created_at,
              updated_at,
              archived_at,
              deleted_at
            )
            VALUES (
              ${`thread-${kind}`},
              ${`project-${kind}`},
              ${`Thread ${kind}`},
              NULL,
              'full-access',
              'default',
              NULL,
              NULL,
              NULL,
              '2026-01-01T00:00:00.000Z',
              '2026-01-01T00:00:00.000Z',
              NULL,
              NULL
            )
          `;

        yield* sql`
            INSERT INTO projection_thread_sessions (
              thread_id,
              status,
              provider_name,
              provider_session_id,
              provider_thread_id,
              active_turn_id,
              last_error,
              updated_at,
              runtime_mode,
              provider_instance_id
            )
            VALUES (
              ${`thread-${kind}`},
              'running',
              ${kind},
              NULL,
              NULL,
              NULL,
              NULL,
              '2026-01-01T00:00:00.000Z',
              'full-access',
              NULL
            )
          `;

        yield* sql`
            INSERT INTO provider_session_runtime (
              thread_id,
              provider_name,
              adapter_key,
              runtime_mode,
              status,
              last_seen_at,
              resume_cursor_json,
              runtime_payload_json,
              provider_instance_id
            )
            VALUES (
              ${`thread-${kind}`},
              ${kind},
              ${kind},
              'full-access',
              'running',
              '2026-01-01T00:00:00.000Z',
              NULL,
              NULL,
              NULL
            )
          `;
      }

      // Also seed a non-fork (upstream) driver row to verify the
      // backfill leaves it untouched.
      yield* sql`
          INSERT INTO projection_projects (
            project_id,
            title,
            workspace_root,
            scripts_json,
            created_at,
            updated_at,
            deleted_at,
            default_model_selection_json
          )
          VALUES (
            'project-claude',
            'Project claude',
            '/tmp/project-claude',
            '[]',
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
            NULL,
            NULL
          )
        `;
      yield* sql`
          INSERT INTO projection_threads (
            thread_id,
            project_id,
            title,
            model_selection_json,
            runtime_mode,
            interaction_mode,
            branch,
            worktree_path,
            latest_turn_id,
            created_at,
            updated_at,
            archived_at,
            deleted_at
          )
          VALUES (
            'thread-claude',
            'project-claude',
            'Thread claude',
            NULL,
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
            NULL,
            NULL
          )
        `;
      yield* sql`
          INSERT INTO projection_thread_sessions (
            thread_id,
            status,
            provider_name,
            provider_session_id,
            provider_thread_id,
            active_turn_id,
            last_error,
            updated_at,
            runtime_mode,
            provider_instance_id
          )
          VALUES (
            'thread-claude',
            'running',
            'claudeAgent',
            NULL,
            NULL,
            NULL,
            NULL,
            '2026-01-01T00:00:00.000Z',
            'full-access',
            NULL
          )
        `;
      yield* sql`
          INSERT INTO provider_session_runtime (
            thread_id,
            provider_name,
            adapter_key,
            runtime_mode,
            status,
            last_seen_at,
            resume_cursor_json,
            runtime_payload_json,
            provider_instance_id
          )
          VALUES (
            'thread-claude',
            'claudeAgent',
            'claudeAgent',
            'full-access',
            'running',
            '2026-01-01T00:00:00.000Z',
            NULL,
            NULL,
            NULL
          )
        `;

      // Run migration 029.
      yield* runMigrations({ toMigrationInclusive: 31 });

      // Each fork row should now have its `provider_instance_id` set
      // to the matching driver kind (the default instance id).
      for (const kind of forkKinds) {
        const sessionRows = yield* sql<{ readonly providerInstanceId: string }>`
            SELECT provider_instance_id AS "providerInstanceId"
            FROM projection_thread_sessions
            WHERE thread_id = ${`thread-${kind}`}
          `;
        assert.deepStrictEqual(sessionRows, [{ providerInstanceId: kind }]);

        const runtimeRows = yield* sql<{ readonly providerInstanceId: string }>`
            SELECT provider_instance_id AS "providerInstanceId"
            FROM provider_session_runtime
            WHERE thread_id = ${`thread-${kind}`}
          `;
        assert.deepStrictEqual(runtimeRows, [{ providerInstanceId: kind }]);
      }

      // The upstream-driver row must be untouched (still NULL).
      const claudeSession = yield* sql<{
        readonly providerInstanceId: string | null;
      }>`
          SELECT provider_instance_id AS "providerInstanceId"
          FROM projection_thread_sessions
          WHERE thread_id = 'thread-claude'
        `;
      assert.deepStrictEqual(claudeSession, [{ providerInstanceId: null }]);

      const claudeRuntime = yield* sql<{
        readonly providerInstanceId: string | null;
      }>`
          SELECT provider_instance_id AS "providerInstanceId"
          FROM provider_session_runtime
          WHERE thread_id = 'thread-claude'
        `;
      assert.deepStrictEqual(claudeRuntime, [{ providerInstanceId: null }]);
    }),
  );

  it.effect("is idempotent — re-running does not overwrite already-set ids", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 30 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          scripts_json,
          created_at,
          updated_at,
          deleted_at,
          default_model_selection_json
        )
        VALUES (
          'project-amp-custom',
          'Project amp custom',
          '/tmp/project-amp-custom',
          '[]',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL,
          NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-amp-custom',
          'project-amp-custom',
          'Thread amp custom',
          NULL,
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL,
          NULL
        )
      `;
      // Pre-existing row already has a NON-DEFAULT instance id (e.g. user
      // ran a future custom-instance migration before this one).
      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          active_turn_id,
          last_error,
          updated_at,
          runtime_mode,
          provider_instance_id
        )
        VALUES (
          'thread-amp-custom',
          'running',
          'amp',
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          'full-access',
          'amp-custom'
        )
      `;
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id,
          provider_name,
          adapter_key,
          runtime_mode,
          status,
          last_seen_at,
          resume_cursor_json,
          runtime_payload_json,
          provider_instance_id
        )
        VALUES (
          'thread-amp-custom',
          'amp',
          'amp',
          'full-access',
          'running',
          '2026-01-01T00:00:00.000Z',
          NULL,
          NULL,
          'amp-custom'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 31 });

      const rows = yield* sql<{ readonly providerInstanceId: string }>`
        SELECT provider_instance_id AS "providerInstanceId"
        FROM projection_thread_sessions
        WHERE thread_id = 'thread-amp-custom'
      `;
      assert.deepStrictEqual(rows, [{ providerInstanceId: "amp-custom" }]);

      const runtimeRows = yield* sql<{ readonly providerInstanceId: string }>`
        SELECT provider_instance_id AS "providerInstanceId"
        FROM provider_session_runtime
        WHERE thread_id = 'thread-amp-custom'
      `;
      assert.deepStrictEqual(runtimeRows, [{ providerInstanceId: "amp-custom" }]);
    }),
  );
});
