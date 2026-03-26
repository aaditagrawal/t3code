import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Normalize the legacy "claudeCode" provider name to "claudeAgent" in all
 * persisted data. The fork originally used "claudeCode" as the provider kind
 * before upstream standardized on "claudeAgent". Migration 016 may have
 * already written "claudeCode" into modelSelection JSON if it ran before the
 * rename landed.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.modelSelection.provider', 'claudeAgent')
    WHERE json_extract(payload_json, '$.modelSelection.provider') = 'claudeCode'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.defaultModelSelection.provider', 'claudeAgent')
    WHERE json_extract(payload_json, '$.defaultModelSelection.provider') = 'claudeCode'
  `;

  yield* sql`
    UPDATE projection_threads
    SET model_selection_json = json_set(model_selection_json, '$.provider', 'claudeAgent')
    WHERE json_extract(model_selection_json, '$.provider') = 'claudeCode'
  `;

  yield* sql`
    UPDATE projection_projects
    SET default_model_selection_json = json_set(default_model_selection_json, '$.provider', 'claudeAgent')
    WHERE json_extract(default_model_selection_json, '$.provider') = 'claudeCode'
  `;

  yield* sql`
    UPDATE projection_thread_sessions
    SET provider_name = 'claudeAgent'
    WHERE provider_name = 'claudeCode'
  `;
});
