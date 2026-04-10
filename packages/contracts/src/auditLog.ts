import { Schema } from "effect";
import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const AuditEntryId = makeEntityId("AuditEntryId");
export type AuditEntryId = typeof AuditEntryId.Type;

export const AuditActorKind = Schema.Literals(["user", "system", "provider"]);
export type AuditActorKind = typeof AuditActorKind.Type;

export const AuditSeverity = Schema.Literals(["info", "warning", "critical"]);
export type AuditSeverity = typeof AuditSeverity.Type;

export const AuditCategory = Schema.Literals([
  "session",
  "command",
  "approval",
  "auth",
  "config",
  "provider",
  "git",
  "file",
  "budget",
  "pipeline",
]);
export type AuditCategory = typeof AuditCategory.Type;

export const AuditEntry = Schema.Struct({
  id: AuditEntryId,
  timestamp: IsoDateTime,
  actor: AuditActorKind,
  actorId: Schema.NullOr(TrimmedNonEmptyString),
  category: AuditCategory,
  action: TrimmedNonEmptyString,
  severity: AuditSeverity,
  projectId: Schema.NullOr(ProjectId),
  threadId: Schema.NullOr(ThreadId),
  commandId: Schema.NullOr(CommandId),
  eventId: Schema.NullOr(EventId),
  summary: TrimmedNonEmptyString,
  detail: Schema.NullOr(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
});
export type AuditEntry = typeof AuditEntry.Type;

export const AuditQueryInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  threadId: Schema.optional(ThreadId),
  category: Schema.optional(AuditCategory),
  severity: Schema.optional(AuditSeverity),
  actor: Schema.optional(AuditActorKind),
  fromTimestamp: Schema.optional(IsoDateTime),
  toTimestamp: Schema.optional(IsoDateTime),
  limit: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 100)),
  offset: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
});
export type AuditQueryInput = typeof AuditQueryInput.Type;

export const AuditQueryResult = Schema.Struct({
  entries: Schema.Array(AuditEntry),
  total: NonNegativeInt,
  hasMore: Schema.Boolean,
});
export type AuditQueryResult = typeof AuditQueryResult.Type;

export const AuditExportInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  fromTimestamp: Schema.optional(IsoDateTime),
  toTimestamp: Schema.optional(IsoDateTime),
  format: Schema.Literals(["json", "csv"]).pipe(Schema.withDecodingDefault(() => "json" as const)),
});
export type AuditExportInput = typeof AuditExportInput.Type;

export const AuditStreamEvent = Schema.Struct({
  type: Schema.Literal("audit.entry"),
  entry: AuditEntry,
});
export type AuditStreamEvent = typeof AuditStreamEvent.Type;

export class AuditLogError extends Schema.TaggedErrorClass<AuditLogError>()("AuditLogError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}
