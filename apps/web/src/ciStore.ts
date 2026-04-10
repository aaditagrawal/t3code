import type {
  CIFeedbackPolicy,
  CIGetStatusInput,
  CIRun,
  CISetFeedbackPolicyInput,
  CITriggerRerunInput,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "./wsRpcClient";

export interface CIState {
  runsByProject: Record<string, CIRun[]>;
  feedbackPolicies: Record<string, CIFeedbackPolicy>;
  isLoading: boolean;
  error: string | null;
}

export interface CIStore extends CIState {
  fetchRuns: (input: CIGetStatusInput) => Promise<void>;
  triggerRerun: (input: CITriggerRerunInput) => Promise<void>;
  setFeedbackPolicy: (input: CISetFeedbackPolicyInput) => Promise<void>;
  clearError: () => void;
}

const initialState: CIState = {
  runsByProject: {},
  feedbackPolicies: {},
  isLoading: false,
  error: null,
};

export const useCIStore = create<CIStore>((set) => ({
  ...initialState,

  fetchRuns: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result = await client.ci.getStatus(input);
      set((s) => ({
        runsByProject: {
          ...s.runsByProject,
          [input.projectId]: result.runs as CIRun[],
        },
        isLoading: false,
      }));
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  triggerRerun: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      await client.ci.triggerRerun(input);
      set({ isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  setFeedbackPolicy: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const policy = await client.ci.setFeedbackPolicy(input);
      set((s) => ({
        feedbackPolicies: {
          ...s.feedbackPolicies,
          [input.projectId]: policy as CIFeedbackPolicy,
        },
        isLoading: false,
      }));
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

/** Subscribe to live CI events; returns an unsubscribe function. */
export function subscribeCIEvents(): () => void {
  const client = getWsRpcClient();
  return client.ci.onEvent((event) => {
    if (event.type === "ci.run.updated") {
      const run = event.run as CIRun;
      useCIStore.setState((s) => {
        const existing = s.runsByProject[run.projectId] ?? [];
        const updated = existing.some((r) => r.id === run.id)
          ? existing.map((r) => (r.id === run.id ? run : r))
          : [run, ...existing];
        return {
          runsByProject: { ...s.runsByProject, [run.projectId]: updated },
        };
      });
    }
  });
}
