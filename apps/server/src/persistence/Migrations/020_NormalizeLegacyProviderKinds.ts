import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Normalize legacy provider names in persisted data.
 *
 * Historical rows may still contain:
 * - "claudeCode" before upstream standardized on "claudeAgent"
 * - "gemini" before the fork standardized on "geminiCli"
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rewrites = [
    ["claudeCode", "claudeAgent"],
    ["gemini", "geminiCli"],
  ] as const;

  for (const [legacyProvider, canonicalProvider] of rewrites) {
    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_set(payload_json, '$.modelSelection.provider', ${canonicalProvider})
      WHERE json_extract(payload_json, '$.modelSelection.provider') = ${legacyProvider}
    `;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_set(payload_json, '$.defaultModelSelection.provider', ${canonicalProvider})
      WHERE json_extract(payload_json, '$.defaultModelSelection.provider') = ${legacyProvider}
    `;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_set(payload_json, '$.provider', ${canonicalProvider})
      WHERE json_extract(payload_json, '$.provider') = ${legacyProvider}
    `;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_set(payload_json, '$.defaultProvider', ${canonicalProvider})
      WHERE json_extract(payload_json, '$.defaultProvider') = ${legacyProvider}
    `;

    yield* sql`
      UPDATE projection_threads
      SET model_selection_json = json_set(model_selection_json, '$.provider', ${canonicalProvider})
      WHERE json_extract(model_selection_json, '$.provider') = ${legacyProvider}
    `;

    yield* sql`
      UPDATE projection_projects
      SET default_model_selection_json = json_set(default_model_selection_json, '$.provider', ${canonicalProvider})
      WHERE json_extract(default_model_selection_json, '$.provider') = ${legacyProvider}
    `;

    yield* sql`
      UPDATE projection_thread_sessions
      SET provider_name = ${canonicalProvider}
      WHERE provider_name = ${legacyProvider}
    `;

    yield* sql`
      UPDATE provider_session_runtime
      SET provider_name = ${canonicalProvider}
      WHERE provider_name = ${legacyProvider}
    `;
  }
});
