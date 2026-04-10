import type {
  MemoryAddInput,
  MemoryEntry,
  MemoryForgetInput,
  MemoryListInput,
  MemorySearchInput,
  MemorySearchResult,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "./wsRpcClient";

export interface MemoryState {
  entriesByProject: Record<string, MemoryEntry[]>;
  searchResults: MemorySearchResult[];
  searchQueryTime: number;
  isLoading: boolean;
  error: string | null;
}

export interface MemoryStore extends MemoryState {
  search: (input: MemorySearchInput) => Promise<void>;
  add: (input: MemoryAddInput) => Promise<MemoryEntry | null>;
  forget: (input: MemoryForgetInput) => Promise<void>;
  list: (input: MemoryListInput) => Promise<void>;
  index: (projectId: string, forceReindex?: boolean) => Promise<void>;
  clearSearchResults: () => void;
  clearError: () => void;
}

const initialState: MemoryState = {
  entriesByProject: {},
  searchResults: [],
  searchQueryTime: 0,
  isLoading: false,
  error: null,
};

export const useMemoryStore = create<MemoryStore>((set) => ({
  ...initialState,

  search: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result = await client.memory.search(input);
      set({
        searchResults: result.results as MemorySearchResult[],
        searchQueryTime: result.queryTime,
        isLoading: false,
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  add: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const entry = (await client.memory.add(input)) as MemoryEntry;
      set((s) => ({
        entriesByProject: {
          ...s.entriesByProject,
          [input.projectId]: [entry, ...(s.entriesByProject[input.projectId] ?? [])],
        },
        isLoading: false,
      }));
      return entry;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      return null;
    }
  },

  forget: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      await client.memory.forget(input);
      set((s) => {
        const updated: Record<string, MemoryEntry[]> = {};
        for (const [projectId, entries] of Object.entries(s.entriesByProject)) {
          updated[projectId] = entries.filter((e) => e.id !== input.entryId);
        }
        return { entriesByProject: updated, isLoading: false };
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  list: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result = await client.memory.list(input);
      set((s) => ({
        entriesByProject: {
          ...s.entriesByProject,
          [input.projectId]: result.entries as MemoryEntry[],
        },
        isLoading: false,
      }));
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  index: async (projectId, forceReindex = false) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      await client.memory.index({ projectId: projectId as any, forceReindex });
      set({ isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  clearSearchResults: () => set({ searchResults: [] }),
  clearError: () => set({ error: null }),
}));
