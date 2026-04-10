import type {
  ProviderHealth,
  RoutingDecision,
  RoutingGetRulesResult,
  RoutingRule,
  RoutingSetRulesInput,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "./wsRpcClient";

export interface RoutingState {
  providerHealth: ProviderHealth[];
  rules: RoutingRule[];
  recentDecisions: RoutingDecision[];
  isLoading: boolean;
  error: string | null;
}

export interface RoutingStore extends RoutingState {
  fetchHealth: () => Promise<void>;
  fetchRules: () => Promise<void>;
  setRules: (input: RoutingSetRulesInput) => Promise<void>;
  clearError: () => void;
}

const initialState: RoutingState = {
  providerHealth: [],
  rules: [],
  recentDecisions: [],
  isLoading: false,
  error: null,
};

export const useRoutingStore = create<RoutingStore>((set) => ({
  ...initialState,

  fetchHealth: async () => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result = await client.routing.getHealth();
      set({ providerHealth: result.providers as ProviderHealth[], isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchRules: async () => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result: RoutingGetRulesResult = await client.routing.getRules();
      set({ rules: result.rules as RoutingRule[], isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  setRules: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result = await client.routing.setRules(input);
      set({ rules: result.rules as RoutingRule[], isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

/** Subscribe to live routing events; returns an unsubscribe function. */
export function subscribeRoutingEvents(): () => void {
  const client = getWsRpcClient();
  return client.routing.onEvent((event) => {
    if (event.type === "routing.health.updated") {
      const health = event.health as ProviderHealth;
      useRoutingStore.setState((s) => ({
        providerHealth: s.providerHealth.some((h) => h.provider === health.provider)
          ? s.providerHealth.map((h) => (h.provider === health.provider ? health : h))
          : [...s.providerHealth, health],
      }));
    } else if (event.type === "routing.decision") {
      const decision = event.decision as RoutingDecision;
      useRoutingStore.setState((s) => ({
        recentDecisions: [decision, ...s.recentDecisions].slice(0, 100),
      }));
    }
  });
}
