import type {
  CostAlert,
  CostBudget,
  CostEntry,
  CostGetSummaryInput,
  CostSummary,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "./wsRpcClient";

export interface CostState {
  summary: CostSummary | null;
  budgets: CostBudget[];
  recentEntries: CostEntry[];
  recentAlerts: CostAlert[];
  isLoading: boolean;
  error: string | null;
}

export interface CostStore extends CostState {
  fetchSummary: (input?: CostGetSummaryInput) => Promise<void>;
  fetchBudgets: (projectId?: string) => Promise<void>;
  clearError: () => void;
}

const initialState: CostState = {
  summary: null,
  budgets: [],
  recentEntries: [],
  recentAlerts: [],
  isLoading: false,
  error: null,
};

export const useCostStore = create<CostStore>((set) => ({
  ...initialState,

  fetchSummary: async (input = {}) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const summary = await client.cost.getSummary(
        input as Parameters<typeof client.cost.getSummary>[0],
      );
      set({ summary, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchBudgets: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result = await client.cost.getBudgets(projectId ? { projectId: projectId as any } : {});
      set({ budgets: (result as { budgets: CostBudget[] }).budgets, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

/** Subscribe to live cost events; returns an unsubscribe function. */
export function subscribeCostEvents(): () => void {
  const client = getWsRpcClient();
  return client.cost.onEvent((event) => {
    if (event.type === "cost.entry") {
      useCostStore.setState((s) => ({
        recentEntries: [event.entry, ...s.recentEntries].slice(0, 200),
      }));
    } else if (event.type === "cost.alert") {
      useCostStore.setState((s) => ({
        recentAlerts: [event.alert, ...s.recentAlerts].slice(0, 50),
      }));
    } else if (event.type === "cost.budget.updated") {
      useCostStore.setState((s) => ({
        budgets: s.budgets.some((b) => b.id === event.budget.id)
          ? s.budgets.map((b) => (b.id === event.budget.id ? event.budget : b))
          : [...s.budgets, event.budget],
      }));
    }
  });
}
