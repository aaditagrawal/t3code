import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("020_NormalizeLegacyProviderKinds", (it) => {
  it.effect("rewrites legacy provider names across persisted tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 19 });

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
          'project-legacy-provider',
          'Legacy provider project',
          '/tmp/project-legacy-provider',
          '[]',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL,
          '{"provider":"gemini","model":"gemini-2.5-pro"}'
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
          'thread-legacy-provider',
          'project-legacy-provider',
          'Legacy provider thread',
          '{"provider":"claudeCode","model":"claude-sonnet-4-6"}',
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
          runtime_mode
        )
        VALUES (
          'thread-legacy-provider',
          'running',
          'gemini',
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          'full-access'
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
          runtime_payload_json
        )
        VALUES (
          'thread-legacy-provider',
          'claudeCode',
          'claudeCode',
          'full-access',
          'running',
          '2026-01-01T00:00:00.000Z',
          NULL,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          'event-legacy-provider',
          'thread',
          'thread-legacy-provider',
          1,
          'thread.created',
          '2026-01-01T00:00:00.000Z',
          'command-legacy-provider',
          NULL,
          NULL,
          'server',
          '{"provider":"gemini","defaultProvider":"claudeCode","modelSelection":{"provider":"gemini","model":"gemini-2.5-pro"},"defaultModelSelection":{"provider":"claudeCode","model":"claude-sonnet-4-6"}}',
          '{}'
        )
      `;

      yield* runMigrations();

      const normalizedProject = yield* sql<{ readonly provider: string }>`
        SELECT json_extract(default_model_selection_json, '$.provider') AS "provider"
        FROM projection_projects
        WHERE project_id = 'project-legacy-provider'
      `;
      assert.deepStrictEqual(normalizedProject, [{ provider: "geminiCli" }]);

      const normalizedThread = yield* sql<{ readonly provider: string }>`
        SELECT json_extract(model_selection_json, '$.provider') AS "provider"
        FROM projection_threads
        WHERE thread_id = 'thread-legacy-provider'
      `;
      assert.deepStrictEqual(normalizedThread, [{ provider: "claudeAgent" }]);

      const normalizedThreadSession = yield* sql<{ readonly providerName: string }>`
        SELECT provider_name AS "providerName"
        FROM projection_thread_sessions
        WHERE thread_id = 'thread-legacy-provider'
      `;
      assert.deepStrictEqual(normalizedThreadSession, [{ providerName: "geminiCli" }]);

      const normalizedRuntime = yield* sql<{ readonly providerName: string }>`
        SELECT provider_name AS "providerName"
        FROM provider_session_runtime
        WHERE thread_id = 'thread-legacy-provider'
      `;
      assert.deepStrictEqual(normalizedRuntime, [{ providerName: "claudeAgent" }]);

      const normalizedEvent = yield* sql<{
        readonly provider: string;
        readonly defaultProvider: string;
        readonly modelSelectionProvider: string;
        readonly defaultModelSelectionProvider: string;
      }>`
        SELECT
          json_extract(payload_json, '$.provider') AS "provider",
          json_extract(payload_json, '$.defaultProvider') AS "defaultProvider",
          json_extract(payload_json, '$.modelSelection.provider') AS "modelSelectionProvider",
          json_extract(payload_json, '$.defaultModelSelection.provider') AS "defaultModelSelectionProvider"
        FROM orchestration_events
        WHERE event_id = 'event-legacy-provider'
      `;
      assert.deepStrictEqual(normalizedEvent, [
        {
          provider: "geminiCli",
          defaultProvider: "claudeAgent",
          modelSelectionProvider: "geminiCli",
          defaultModelSelectionProvider: "claudeAgent",
        },
      ]);
    }),
  );
});
