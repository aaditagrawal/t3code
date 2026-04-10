import type {
  Participant,
  ParticipantId,
  ParticipantRole,
  PresenceCursorKind,
  PresenceGetParticipantsInput,
  PresenceGetParticipantsResult,
  PresenceJoinInput,
  PresenceLeaveInput,
  PresenceShareInput,
  PresenceStreamEvent,
  PresenceUpdateCursorInput,
  SessionShare,
  SessionShareId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, ServiceMap, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface PresenceServiceShape {
  readonly join: (input: PresenceJoinInput) => Effect.Effect<Participant>;
  readonly leave: (input: PresenceLeaveInput) => Effect.Effect<void>;
  readonly updateCursor: (input: PresenceUpdateCursorInput) => Effect.Effect<void>;
  readonly share: (input: PresenceShareInput) => Effect.Effect<SessionShare>;
  readonly getParticipants: (
    input: PresenceGetParticipantsInput,
  ) => Effect.Effect<PresenceGetParticipantsResult>;
  readonly streamEvents: Stream.Stream<PresenceStreamEvent>;
}

export class PresenceService extends ServiceMap.Service<PresenceService, PresenceServiceShape>()(
  "t3/presence/Services/PresenceService",
) {}

/** Assign a deterministic pastel color per participant based on display name. */
function assignColor(name: string): string {
  const colors = [
    "#6366f1",
    "#8b5cf6",
    "#ec4899",
    "#f43f5e",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#06b6d4",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length]!;
}

const makePresenceService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pubsub = yield* PubSub.unbounded<PresenceStreamEvent>();

  // In-memory presence map: threadId -> Map<participantId, Participant>
  const presenceMap = new Map<string, Map<string, Participant>>();

  const getOrCreateThreadMap = (threadId: string): Map<string, Participant> => {
    let map = presenceMap.get(threadId);
    if (!map) {
      map = new Map();
      presenceMap.set(threadId, map);
    }
    return map;
  };

  const join: PresenceServiceShape["join"] = (input) =>
    Effect.gen(function* () {
      const id = crypto.randomUUID() as ParticipantId;
      const now = new Date().toISOString();
      const participant: Participant = {
        id,
        displayName: input.displayName,
        role: input.role as ParticipantRole,
        color: assignColor(input.displayName),
        cursor: "idle",
        activeThreadId: input.threadId,
        connectedAt: now,
        lastSeenAt: now,
      };
      getOrCreateThreadMap(input.threadId).set(id, participant);
      yield* PubSub.publish(pubsub, { type: "presence.joined" as const, participant });
      return participant;
    });

  const leave: PresenceServiceShape["leave"] = (input) =>
    Effect.gen(function* () {
      const threadMap = presenceMap.get(input.threadId);
      if (!threadMap) return;
      const existed = threadMap.delete(input.participantId);
      if (threadMap.size === 0) {
        presenceMap.delete(input.threadId);
      }
      if (!existed) return;
      yield* PubSub.publish(pubsub, {
        type: "presence.left" as const,
        participantId: input.participantId,
        threadId: input.threadId,
      });
    });

  const updateCursor: PresenceServiceShape["updateCursor"] = (input) =>
    Effect.gen(function* () {
      const threadMap = presenceMap.get(input.threadId);
      if (!threadMap) return;
      const participant = threadMap.get(input.participantId);
      if (!participant) return;
      const updated = {
        ...participant,
        cursor: input.cursor as PresenceCursorKind,
        lastSeenAt: new Date().toISOString(),
      };
      threadMap.set(input.participantId, updated);
      yield* PubSub.publish(pubsub, {
        type: "presence.cursor.updated" as const,
        participantId: input.participantId,
        cursor: input.cursor as PresenceCursorKind,
        threadId: input.threadId,
      });
    });

  const share: PresenceServiceShape["share"] = (input) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const existing = yield* sql<{
        id: string;
      }>`SELECT id FROM session_shares WHERE thread_id = ${input.threadId}`;
      const id = existing[0]?.id ?? (crypto.randomUUID() as SessionShareId);
      const ownerId = "system" as ParticipantId;
      yield* sql`INSERT OR REPLACE INTO session_shares (id, thread_id, owner_id, max_participants, is_public, created_at, expires_at)
        VALUES (${id}, ${input.threadId}, ${ownerId}, ${input.maxParticipants}, ${input.isPublic ? 1 : 0}, ${now}, NULL)`;
      const sessionShare: SessionShare = {
        id: id as SessionShareId,
        threadId: input.threadId,
        ownerId,
        participants: Array.from(presenceMap.get(input.threadId)?.values() ?? []),
        maxParticipants: input.maxParticipants,
        isPublic: input.isPublic,
        createdAt: now,
        expiresAt: null,
      };
      yield* PubSub.publish(pubsub, {
        type: "presence.share.created" as const,
        share: sessionShare,
      });
      return sessionShare;
    }).pipe(Effect.orDie);

  const getParticipants: PresenceServiceShape["getParticipants"] = (input) =>
    Effect.gen(function* () {
      const participants = Array.from(presenceMap.get(input.threadId)?.values() ?? []);
      const shareRows = yield* sql<{
        id: string;
        thread_id: string;
        owner_id: string;
        max_participants: number;
        is_public: number;
        created_at: string;
        expires_at: string | null;
      }>`SELECT * FROM session_shares WHERE thread_id = ${input.threadId}`;
      const shareRow = shareRows[0];
      const sessionShare: SessionShare | null = shareRow
        ? {
            id: shareRow.id as SessionShareId,
            threadId: shareRow.thread_id as ThreadId,
            ownerId: shareRow.owner_id as ParticipantId,
            participants,
            maxParticipants: shareRow.max_participants,
            isPublic: shareRow.is_public === 1,
            createdAt: shareRow.created_at,
            expiresAt: (shareRow.expires_at ?? null) as SessionShare["expiresAt"],
          }
        : null;
      return { participants, share: sessionShare };
    }).pipe(Effect.orDie);

  return {
    join,
    leave,
    updateCursor,
    share,
    getParticipants,
    streamEvents: Stream.fromPubSub(pubsub),
  };
});

export const PresenceServiceLive = Layer.effect(PresenceService, makePresenceService);
