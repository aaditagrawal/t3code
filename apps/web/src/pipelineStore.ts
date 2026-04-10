import type {
  PipelineCreateInput,
  PipelineDefinition,
  PipelineExecution,
  PipelineExecuteInput,
  PipelineListInput,
  PipelineStageExecution,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "./wsRpcClient";

export interface PipelineState {
  pipelinesByProject: Record<string, PipelineDefinition[]>;
  executions: Record<string, PipelineExecution>;
  isLoading: boolean;
  error: string | null;
}

export interface PipelineStore extends PipelineState {
  fetchPipelines: (input: PipelineListInput) => Promise<void>;
  createPipeline: (input: PipelineCreateInput) => Promise<PipelineDefinition | null>;
  executePipeline: (input: PipelineExecuteInput) => Promise<PipelineExecution | null>;
  getExecution: (executionId: string) => Promise<void>;
  cancelExecution: (executionId: string) => Promise<void>;
  clearError: () => void;
}

const initialState: PipelineState = {
  pipelinesByProject: {},
  executions: {},
  isLoading: false,
  error: null,
};

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  ...initialState,

  fetchPipelines: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const result = await client.pipeline.list(input);
      set((s) => ({
        pipelinesByProject: {
          ...s.pipelinesByProject,
          [input.projectId]: result.pipelines as PipelineDefinition[],
        },
        isLoading: false,
      }));
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  createPipeline: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const pipeline = (await client.pipeline.create(input)) as PipelineDefinition;
      set((s) => ({
        pipelinesByProject: {
          ...s.pipelinesByProject,
          [input.projectId]: [...(s.pipelinesByProject[input.projectId] ?? []), pipeline],
        },
        isLoading: false,
      }));
      return pipeline;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      return null;
    }
  },

  executePipeline: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const execution = (await client.pipeline.execute(input)) as PipelineExecution;
      set((s) => ({
        executions: { ...s.executions, [execution.id]: execution },
        isLoading: false,
      }));
      return execution;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      return null;
    }
  },

  getExecution: async (executionId) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      const execution = (await client.pipeline.getExecution({
        executionId: executionId as any,
      })) as PipelineExecution;
      set((s) => ({
        executions: { ...s.executions, [execution.id]: execution },
        isLoading: false,
      }));
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  cancelExecution: async (executionId) => {
    set({ isLoading: true, error: null });
    try {
      const client = getWsRpcClient();
      await client.pipeline.cancel({ executionId: executionId as any });
      set((s) => {
        const existing = s.executions[executionId];
        if (!existing) return { isLoading: false };
        return {
          executions: {
            ...s.executions,
            [executionId]: { ...existing, status: "cancelled" as const },
          },
          isLoading: false,
        };
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

/** Subscribe to live pipeline events; returns an unsubscribe function. */
export function subscribePipelineEvents(): () => void {
  const client = getWsRpcClient();
  return client.pipeline.onEvent((event) => {
    if (event.type === "pipeline.execution.updated") {
      const execution = event.execution as PipelineExecution;
      usePipelineStore.setState((s) => ({
        executions: { ...s.executions, [execution.id]: execution },
      }));
    } else if (event.type === "pipeline.stage.updated") {
      const { executionId, stage } = event as {
        executionId: string;
        stage: PipelineStageExecution;
      };
      usePipelineStore.setState((s) => {
        const existing = s.executions[executionId];
        if (!existing) return {};
        const updatedStages = existing.stages.some((st) => st.stageId === stage.stageId)
          ? existing.stages.map((st) => (st.stageId === stage.stageId ? stage : st))
          : [...existing.stages, stage];
        return {
          executions: {
            ...s.executions,
            [executionId]: { ...existing, stages: updatedStages },
          },
        };
      });
    }
  });
}
