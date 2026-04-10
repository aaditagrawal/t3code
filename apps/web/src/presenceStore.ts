import type {
  Participant,
  ParticipantId,
  PresenceCursorKind,
  PresenceGetParticipantsInput,
  PresenceJoinInput,
  PresenceLeaveInput,
  PresenceShareInput,
  PresenceUpdateCursorInput,
  SessionShare,
  ThreadId,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "./wsRpcClient";

export interface PresenceState {
  participantsByThread: Record<string, Participant[]>;
  sharesByThread: Record<string, SessionShare | null>;
  isLoading: boolean;
  error: string | null;
}

export interface PresenceStore extends PresenceState {
  join: (input: PresenceJoinInput) => Promise<Participant | null>;
  leave: (input: PresenceLeaveInput) => Promise<void>;
  updateCursor: (input: PresenceUpdateCursorInput) => Promise<void>;
  share: (input: PresenceShareInput) => Promise<SessionShare | null>;
  getParticipants: (input: PresenceGetParticipantsInput) => Promise<void>;
  clearError: () => void;
}

const initialState: PresenceState = {
  participantsByThread: {},
  sharesByThread: {},
  isLoading: false,
  error: null,
};

export const usePresenceStore = create<PresenceStore>((set) => ({
  ...initialState,

  join: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const participant = (await client.presence.join(input)) as Participant;
      set((s) => ({
        participantsByThread: {
          ...s.participantsByThread,
          [input.threadId]: [...(s.participantsByThread[input.threadId] ?? []), participant],
        },
        isLoading: false,
      }));
      return participant;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      return null;
    }
  },

  leave: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      await client.presence.leave(input);
      set((s) => {
        const { [input.threadId]: _removed, ...rest } = s.participantsByThread;
        return { participantsByThread: rest, isLoading: false };
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  updateCursor: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      await client.presence.updateCursor(input);
      set({ isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  share: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const sessionShare = (await client.presence.share(input)) as SessionShare;
      set((s) => ({
        sharesByThread: { ...s.sharesByThread, [input.threadId]: sessionShare },
        isLoading: false,
      }));
      return sessionShare;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      return null;
    }
  },

  getParticipants: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result = await client.presence.getParticipants(input);
      set((s) => ({
        participantsByThread: {
          ...s.participantsByThread,
          [input.threadId]: result.participants as Participant[],
        },
        sharesByThread: {
          ...s.sharesByThread,
          [input.threadId]: (result.share as SessionShare | null) ?? null,
        },
        isLoading: false,
      }));
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

/** Subscribe to live presence events; returns an unsubscribe function. */
export function subscribePresenceEvents(): () => void {
  const client = getWsRpcClient();
  return client.presence.onEvent((event) => {
    if (event.type === "presence.joined") {
      const participant = event.participant as Participant;
      const threadId = participant.activeThreadId;
      if (!threadId) return;
      usePresenceStore.setState((s) => ({
        participantsByThread: {
          ...s.participantsByThread,
          [threadId]: [
            ...(s.participantsByThread[threadId] ?? []).filter((p) => p.id !== participant.id),
            participant,
          ],
        },
      }));
    } else if (event.type === "presence.left") {
      const { participantId, threadId } = event as {
        participantId: ParticipantId;
        threadId: ThreadId;
      };
      usePresenceStore.setState((s) => ({
        participantsByThread: {
          ...s.participantsByThread,
          [threadId]: (s.participantsByThread[threadId] ?? []).filter(
            (p) => p.id !== participantId,
          ),
        },
      }));
    } else if (event.type === "presence.cursor.updated") {
      const { participantId, cursor, threadId } = event as {
        participantId: ParticipantId;
        cursor: PresenceCursorKind;
        threadId: ThreadId;
      };
      usePresenceStore.setState((s) => ({
        participantsByThread: {
          ...s.participantsByThread,
          [threadId]: (s.participantsByThread[threadId] ?? []).map((p) =>
            p.id === participantId ? { ...p, cursor } : p,
          ),
        },
      }));
    } else if (event.type === "presence.share.created") {
      const share = event.share as SessionShare;
      usePresenceStore.setState((s) => ({
        sharesByThread: { ...s.sharesByThread, [share.threadId]: share },
      }));
    }
  });
}
