import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // ── Cost Tracking ──────────────────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS cost_entries (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      turn_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      thinking_tokens INTEGER NOT NULL DEFAULT 0,
      cost_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_cost_entries_thread ON cost_entries(thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_cost_entries_project ON cost_entries(project_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_cost_entries_created ON cost_entries(created_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS cost_budgets (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      limit_cents INTEGER NOT NULL,
      period_days INTEGER NOT NULL,
      current_spend_cents INTEGER NOT NULL DEFAULT 0,
      alert_threshold_percent INTEGER NOT NULL DEFAULT 80,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // ── Audit Log ──────────────────────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_id TEXT,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      project_id TEXT,
      thread_id TEXT,
      command_id TEXT,
      event_id TEXT,
      summary TEXT NOT NULL,
      detail TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log(category)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_audit_log_severity ON audit_log(severity)
  `;

  // ── CI/CD Integration ──────────────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS ci_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      thread_id TEXT,
      turn_id TEXT,
      provider TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      status TEXT NOT NULL,
      conclusion TEXT,
      jobs TEXT NOT NULL DEFAULT '[]',
      html_url TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_ci_runs_project ON ci_runs(project_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_ci_runs_branch ON ci_runs(branch)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS ci_feedback_policies (
      project_id TEXT PRIMARY KEY,
      on_failure TEXT NOT NULL DEFAULT 'notify',
      auto_fix_max_attempts INTEGER NOT NULL DEFAULT 3,
      watch_branches TEXT NOT NULL DEFAULT '[]'
    )
  `;

  // ── Pipelines ──────────────────────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS pipeline_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      project_id TEXT NOT NULL,
      stages TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pipeline_defs_project ON pipeline_definitions(project_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS pipeline_executions (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      stages TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pipeline_exec_pipeline ON pipeline_executions(pipeline_id)
  `;

  // ── Workflow Templates ─────────────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      variables TEXT NOT NULL DEFAULT '[]',
      steps TEXT NOT NULL DEFAULT '[]',
      is_built_in INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // ── Task Decomposition ─────────────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_trees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      root_prompt TEXT NOT NULL,
      tasks TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_trees_project ON task_trees(project_id)
  `;

  // ── Project Memory ─────────────────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      thread_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      relevance_score REAL NOT NULL DEFAULT 0.5,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memory_entries_project ON memory_entries(project_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memory_entries_kind ON memory_entries(kind)
  `;

  yield* sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      title,
      content,
      tags,
      content=memory_entries,
      content_rowid=rowid
    )
  `;

  yield* sql.unsafe(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory_entries BEGIN
      INSERT INTO memory_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
    END
  `);

  yield* sql.unsafe(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memory_entries BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
    END
  `);

  yield* sql.unsafe(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON memory_entries BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
      INSERT INTO memory_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
    END
  `);

  // ── Presence / Session Sharing ─────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS session_shares (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      max_participants INTEGER NOT NULL DEFAULT 10,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_session_shares_thread ON session_shares(thread_id)
  `;

  // ── Routing Rules ──────────────────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS routing_rules (
      name TEXT PRIMARY KEY,
      project_id TEXT,
      strategy TEXT NOT NULL,
      preferred_providers TEXT NOT NULL DEFAULT '[]',
      excluded_providers TEXT NOT NULL DEFAULT '[]',
      task_patterns TEXT NOT NULL DEFAULT '[]',
      failover_policy TEXT NOT NULL DEFAULT '{}',
      priority INTEGER NOT NULL DEFAULT 0
    )
  `;
});
