import type {
  WorkflowCreateInput,
  WorkflowDeleteInput,
  WorkflowExecuteInput,
  WorkflowListInput,
  WorkflowTemplate,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "./wsRpcClient";

export interface WorkflowState {
  templates: WorkflowTemplate[];
  isLoading: boolean;
  error: string | null;
}

export interface WorkflowStore extends WorkflowState {
  fetchTemplates: (input?: WorkflowListInput) => Promise<void>;
  createTemplate: (input: WorkflowCreateInput) => Promise<WorkflowTemplate | null>;
  deleteTemplate: (input: WorkflowDeleteInput) => Promise<void>;
  executeWorkflow: (input: WorkflowExecuteInput) => Promise<void>;
  clearError: () => void;
}

const initialState: WorkflowState = {
  templates: [],
  isLoading: false,
  error: null,
};

export const useWorkflowStore = create<WorkflowStore>((set) => ({
  ...initialState,

  fetchTemplates: async (input = {}) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result = await client.workflow.list(input as WorkflowListInput);
      set({ templates: result.templates as WorkflowTemplate[], isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  createTemplate: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const template = (await client.workflow.create(input)) as WorkflowTemplate;
      set((s) => ({ templates: [...s.templates, template], isLoading: false }));
      return template;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      return null;
    }
  },

  deleteTemplate: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      await client.workflow.delete(input);
      set((s) => ({
        templates: s.templates.filter((t) => t.id !== input.templateId),
        isLoading: false,
      }));
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  executeWorkflow: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      await client.workflow.execute(input);
      set({ isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
