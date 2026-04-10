import type { AuditEntry, AuditQueryInput, AuditQueryResult } from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "./wsRpcClient";

export interface AuditState {
  entries: AuditEntry[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface AuditStore extends AuditState {
  query: (input?: Partial<AuditQueryInput>) => Promise<void>;
  clearError: () => void;
}

const initialState: AuditState = {
  entries: [],
  total: 0,
  hasMore: false,
  isLoading: false,
  error: null,
};

export const useAuditStore = create<AuditStore>((set) => ({
  ...initialState,

  query: async (input = {}) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result: AuditQueryResult = await client.audit.query(input as AuditQueryInput);
      set({
        entries: result.entries as AuditEntry[],
        total: result.total,
        hasMore: result.hasMore,
        isLoading: false,
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

/** Subscribe to live audit events; returns an unsubscribe function. */
export function subscribeAuditEvents(): () => void {
  const client = getWsRpcClient();
  return client.audit.onEvent((event) => {
    if (event.type === "audit.entry") {
      useAuditStore.setState((s) => ({
        entries: [event.entry as AuditEntry, ...s.entries].slice(0, 500),
        total: s.total + 1,
      }));
    }
  });
}
