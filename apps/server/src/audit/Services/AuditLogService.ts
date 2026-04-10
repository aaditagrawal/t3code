/**
 * AuditLogService - Service interface and Live layer for structured audit logging.
 *
 * Records security-relevant and operational events with actor, category,
 * and severity metadata. Supports paginated queries and live streaming.
 *
 * @module AuditLogService
 */
import type {
  AuditEntry,
  AuditQueryInput,
  AuditQueryResult,
  AuditStreamEvent,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, ServiceMap, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface AuditLogServiceShape {
  /**
   * Record a structured audit entry.
   *
   * Persists to the audit_log table and publishes to the live event stream.
   */
  readonly record: (entry: {
    readonly actor: AuditEntry["actor"];
    readonly actorId: string | null;
    readonly category: AuditEntry["category"];
    readonly action: string;
    readonly severity: AuditEntry["severity"];
    readonly projectId: string | null;
    readonly threadId: string | null;
    readonly commandId: string | null;
    readonly eventId: string | null;
    readonly summary: string;
    readonly detail: string | null;
    readonly metadata: Record<string, unknown>;
  }) => Effect.Effect<AuditEntry>;

  /**
   * Query audit entries with filters and pagination.
   */
  readonly query: (input: AuditQueryInput) => Effect.Effect<AuditQueryResult>;

  /**
   * Live stream of new audit entries.
   *
   * Each access creates a fresh PubSub subscription so multiple consumers
   * independently receive all events.
   */
  readonly streamEvents: Stream.Stream<AuditStreamEvent>;
}

export class AuditLogService extends ServiceMap.Service<AuditLogService, AuditLogServiceShape>()(
  "t3/audit/Services/AuditLogService",
) {}

const makeAuditLogService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pubsub = yield* PubSub.unbounded<AuditStreamEvent>();

  const record: AuditLogServiceShape["record"] = (input) =>
    Effect.gen(function* () {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const metadataJson = JSON.stringify(input.metadata);

      yield* sql`INSERT INTO audit_log (id, timestamp, actor, actor_id, category, action, severity, project_id, thread_id, command_id, event_id, summary, detail, metadata)
        VALUES (${id}, ${now}, ${input.actor}, ${input.actorId}, ${input.category}, ${input.action}, ${input.severity}, ${input.projectId}, ${input.threadId}, ${input.commandId}, ${input.eventId}, ${input.summary}, ${input.detail}, ${metadataJson})`;

      const entry: AuditEntry = {
        id: id as AuditEntry["id"],
        timestamp: now,
        actor: input.actor,
        actorId: (input.actorId ?? null) as AuditEntry["actorId"],
        category: input.category,
        action: input.action as AuditEntry["action"],
        severity: input.severity,
        projectId: (input.projectId ?? null) as AuditEntry["projectId"],
        threadId: (input.threadId ?? null) as AuditEntry["threadId"],
        commandId: (input.commandId ?? null) as AuditEntry["commandId"],
        eventId: (input.eventId ?? null) as AuditEntry["eventId"],
        summary: input.summary as AuditEntry["summary"],
        detail: (input.detail ?? null) as AuditEntry["detail"],
        metadata: input.metadata,
      };

      yield* PubSub.publish(pubsub, { type: "audit.entry" as const, entry });
      return entry;
    }).pipe(Effect.orDie);

  const query: AuditLogServiceShape["query"] = (input) =>
    Effect.gen(function* () {
      const conditions: Array<string> = [];
      if (input.projectId) conditions.push(`project_id = '${input.projectId}'`);
      if (input.threadId) conditions.push(`thread_id = '${input.threadId}'`);
      if (input.category) conditions.push(`category = '${input.category}'`);
      if (input.severity) conditions.push(`severity = '${input.severity}'`);
      if (input.actor) conditions.push(`actor = '${input.actor}'`);
      if (input.fromTimestamp) conditions.push(`timestamp >= '${input.fromTimestamp}'`);
      if (input.toTimestamp) conditions.push(`timestamp <= '${input.toTimestamp}'`);

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countResult = yield* sql.unsafe<{ total: number }>(
        `SELECT COUNT(*) as total FROM audit_log ${whereClause}`,
      );
      const total = Number(countResult[0]?.total ?? 0);

      const rows = yield* sql.unsafe<Record<string, unknown>>(
        `SELECT id, timestamp, actor, actor_id, category, action, severity, project_id, thread_id, command_id, event_id, summary, detail, metadata FROM audit_log ${whereClause} ORDER BY timestamp DESC LIMIT ${input.limit} OFFSET ${input.offset}`,
      );

      const entries: AuditEntry[] = rows.map((r) => ({
        id: r["id"] as AuditEntry["id"],
        timestamp: r["timestamp"] as string,
        actor: r["actor"] as AuditEntry["actor"],
        actorId: (r["actor_id"] ?? null) as AuditEntry["actorId"],
        category: r["category"] as AuditEntry["category"],
        action: r["action"] as AuditEntry["action"],
        severity: r["severity"] as AuditEntry["severity"],
        projectId: (r["project_id"] ?? null) as AuditEntry["projectId"],
        threadId: (r["thread_id"] ?? null) as AuditEntry["threadId"],
        commandId: (r["command_id"] ?? null) as AuditEntry["commandId"],
        eventId: (r["event_id"] ?? null) as AuditEntry["eventId"],
        summary: r["summary"] as AuditEntry["summary"],
        detail: (r["detail"] ?? null) as AuditEntry["detail"],
        metadata:
          typeof r["metadata"] === "string" ? JSON.parse(r["metadata"]) : (r["metadata"] ?? {}),
      }));

      return {
        entries,
        total: total as AuditQueryResult["total"],
        hasMore: input.offset + input.limit < total,
      } satisfies AuditQueryResult;
    }).pipe(Effect.orDie);

  return {
    record,
    query,
    get streamEvents(): AuditLogServiceShape["streamEvents"] {
      return Stream.fromPubSub(pubsub);
    },
  } satisfies AuditLogServiceShape;
});

export const AuditLogServiceLive = Layer.effect(AuditLogService, makeAuditLogService);
