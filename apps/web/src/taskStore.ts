import type {
  TaskDecomposeInput,
  TaskExecuteInput,
  TaskListTreesInput,
  TaskNode,
  TaskTree,
  TaskTreeId,
  TaskUpdateStatusInput,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "./wsRpcClient";

export interface TaskState {
  trees: Record<string, TaskTree>;
  isLoading: boolean;
  error: string | null;
}

export interface TaskStore extends TaskState {
  decompose: (input: TaskDecomposeInput) => Promise<TaskTree | null>;
  listTrees: (input: TaskListTreesInput) => Promise<void>;
  getTree: (treeId: TaskTreeId) => Promise<void>;
  updateStatus: (input: TaskUpdateStatusInput) => Promise<void>;
  executeTree: (input: TaskExecuteInput) => Promise<void>;
  clearError: () => void;
}

const initialState: TaskState = {
  trees: {},
  isLoading: false,
  error: null,
};

export const useTaskStore = create<TaskStore>((set) => ({
  ...initialState,

  decompose: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const tree = (await client.task.decompose(input)) as TaskTree;
      set((s) => ({ trees: { ...s.trees, [tree.id]: tree }, isLoading: false }));
      return tree;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      return null;
    }
  },

  listTrees: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result = await client.task.listTrees(input);
      const treesById = Object.fromEntries((result.trees as TaskTree[]).map((t) => [t.id, t]));
      set((s) => ({ trees: { ...s.trees, ...treesById }, isLoading: false }));
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  getTree: async (treeId) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const tree = (await client.task.getTree({ treeId })) as TaskTree;
      set((s) => ({ trees: { ...s.trees, [tree.id]: tree }, isLoading: false }));
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  updateStatus: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      await client.task.updateStatus(input);
      set({ isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  executeTree: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      await client.task.execute(input);
      set({ isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

/** Subscribe to live task events; returns an unsubscribe function. */
export function subscribeTaskEvents(): () => void {
  const client = getWsRpcClient();
  return client.task.onEvent((event) => {
    if (event.type === "task.tree.updated") {
      const tree = event.tree as TaskTree;
      useTaskStore.setState((s) => ({ trees: { ...s.trees, [tree.id]: tree } }));
    } else if (event.type === "task.node.updated") {
      const { treeId, node } = event as { treeId: string; node: TaskNode };
      useTaskStore.setState((s) => {
        const tree = s.trees[treeId];
        if (!tree) return {};
        const updatedTasks = tree.tasks.some((t) => t.id === node.id)
          ? tree.tasks.map((t) => (t.id === node.id ? node : t))
          : [...tree.tasks, node];
        return { trees: { ...s.trees, [treeId]: { ...tree, tasks: updatedTasks } } };
      });
    }
  });
}
