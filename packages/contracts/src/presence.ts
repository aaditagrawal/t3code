import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const SessionShareId = makeEntityId("SessionShareId");
export type SessionShareId = typeof SessionShareId.Type;
export const ParticipantId = makeEntityId("ParticipantId");
export type ParticipantId = typeof ParticipantId.Type;

export const ParticipantRole = Schema.Literals(["owner", "collaborator", "viewer"]);
export type ParticipantRole = typeof ParticipantRole.Type;

export const PresenceCursorKind = Schema.Literals(["viewing", "typing", "idle"]);
export type PresenceCursorKind = typeof PresenceCursorKind.Type;

export const Participant = Schema.Struct({
  id: ParticipantId,
  displayName: TrimmedNonEmptyString,
  role: ParticipantRole,
  color: TrimmedNonEmptyString,
  cursor: PresenceCursorKind.pipe(Schema.withDecodingDefault(() => "idle" as const)),
  activeThreadId: Schema.NullOr(ThreadId),
  connectedAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
});
export type Participant = typeof Participant.Type;

export const SessionShare = Schema.Struct({
  id: SessionShareId,
  threadId: ThreadId,
  ownerId: ParticipantId,
  participants: Schema.Array(Participant),
  maxParticipants: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 10)),
  isPublic: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  createdAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
});
export type SessionShare = typeof SessionShare.Type;

export const PresenceJoinInput = Schema.Struct({
  threadId: ThreadId,
  displayName: TrimmedNonEmptyString,
  role: ParticipantRole.pipe(Schema.withDecodingDefault(() => "viewer" as const)),
});
export type PresenceJoinInput = typeof PresenceJoinInput.Type;

export const PresenceLeaveInput = Schema.Struct({
  threadId: ThreadId,
});
export type PresenceLeaveInput = typeof PresenceLeaveInput.Type;

export const PresenceUpdateCursorInput = Schema.Struct({
  threadId: ThreadId,
  cursor: PresenceCursorKind,
});
export type PresenceUpdateCursorInput = typeof PresenceUpdateCursorInput.Type;

export const PresenceShareInput = Schema.Struct({
  threadId: ThreadId,
  isPublic: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  maxParticipants: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 10)),
});
export type PresenceShareInput = typeof PresenceShareInput.Type;

export const PresenceGetParticipantsInput = Schema.Struct({
  threadId: ThreadId,
});
export type PresenceGetParticipantsInput = typeof PresenceGetParticipantsInput.Type;

export const PresenceGetParticipantsResult = Schema.Struct({
  participants: Schema.Array(Participant),
  share: Schema.NullOr(SessionShare),
});
export type PresenceGetParticipantsResult = typeof PresenceGetParticipantsResult.Type;

export const PresenceStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("presence.joined"), participant: Participant }),
  Schema.Struct({
    type: Schema.Literal("presence.left"),
    participantId: ParticipantId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("presence.cursor.updated"),
    participantId: ParticipantId,
    cursor: PresenceCursorKind,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("presence.share.created"),
    share: SessionShare,
  }),
]);
export type PresenceStreamEvent = typeof PresenceStreamEvent.Type;

export class PresenceError extends Schema.TaggedErrorClass<PresenceError>()("PresenceError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}
