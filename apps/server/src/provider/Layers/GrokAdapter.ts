import {
  type GrokSettings,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  applyGrokAcpModelSelection,
  currentGrokModelIdFromSessionSetup,
  currentGrokReasoningEffortFromSessionSetup,
  makeGrokAcpRuntime,
  resolveGrokAcpBaseModelId,
} from "../acp/GrokAcpSupport.ts";
import {
  extractGrokPlanMarkdownFromToolCallData,
  extractXAiAskUserQuestions,
  extractXAiExitPlanMarkdown,
  makeXAiAskUserQuestionCancelledResponse,
  makeXAiAskUserQuestionResponse,
  makeXAiExitPlanModeCapturedResponse,
  promptResponseHasMissingXAiStopReason,
  XAiAskUserQuestionRequest,
  XAiExitPlanModeRequest,
} from "../acp/XAiAcpExtension.ts";
import {
  makeStandardAcpAdapter,
  standardAcpPromptSettlementBelongsToContext,
  type StandardAcpAdapterLiveOptions,
} from "./StandardAcpAdapter.ts";

export interface GrokAdapterLiveOptions extends StandardAcpAdapterLiveOptions {}

const DEFAULT_GROK_TURN_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_GROK_ACTIVE_TOOL_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1_000;
const decodeXAiExitPlanModeRequest = Schema.decodeUnknownSync(XAiExitPlanModeRequest);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isGrokEnterPlanModeToolCall(toolCall: {
  readonly title?: string;
  readonly data: Record<string, unknown>;
}): boolean {
  const title = toolCall.title?.trim().toLowerCase() ?? "";
  if (
    title === "enter_plan_mode" ||
    title === "plan: enter" ||
    title === "plan mode entered" ||
    title.includes("enter_plan_mode")
  ) {
    return true;
  }
  const rawInput = toolCall.data.rawInput;
  return isRecord(rawInput) && rawInput.variant === "EnterPlanMode";
}

export function nextGrokPlanModeActive(
  currentlyActive: boolean,
  toolCall: {
    readonly title?: string;
    readonly status?: "pending" | "inProgress" | "completed" | "failed";
    readonly data: Record<string, unknown>;
  },
): boolean {
  if (!isGrokEnterPlanModeToolCall(toolCall)) return currentlyActive;
  if (toolCall.status === "failed") return false;
  return toolCall.status === "completed" || toolCall.status === "inProgress"
    ? true
    : currentlyActive;
}

export function selectGrokPermissionOptionId(
  request: EffectAcpSchema.RequestPermissionRequest,
  decision: Exclude<ProviderApprovalDecision, "cancel">,
): string | undefined {
  const preferredKind =
    decision === "acceptForSession"
      ? "allow_always"
      : decision === "accept"
        ? "allow_once"
        : "reject_once";
  const preferredId = request.options
    .find((entry) => entry.kind === preferredKind)
    ?.optionId.trim();
  if (preferredId) return preferredId;
  return decision === "acceptForSession"
    ? request.options.find((entry) => entry.kind === "allow_once")?.optionId.trim() || undefined
    : undefined;
}

export const grokPromptSettlementBelongsToContext = standardAcpPromptSettlementBelongsToContext;

export function makeGrokAdapter(grokSettings: GrokSettings, options?: GrokAdapterLiveOptions) {
  return makeStandardAcpAdapter(
    {
      provider: ProviderDriverKind.make("grok"),
      defaultInstanceId: ProviderInstanceId.make("grok"),
      label: "Grok",
      makeRuntime: (input) =>
        makeGrokAcpRuntime({
          ...input,
          grokSettings,
          ...(options?.environment ? { environment: options.environment } : {}),
        }),
      normalizeModel: resolveGrokAcpBaseModelId,
      currentModelFromSetup: currentGrokModelIdFromSessionSetup,
      currentModelOptionsFromSetup: (setup) => ({
        reasoningEffort: currentGrokReasoningEffortFromSessionSetup(setup),
      }),
      requestedModelOptionsFromSelection: (selection) => ({
        reasoningEffort: getModelSelectionStringOptionValue(selection, "reasoningEffort"),
      }),
      applyModelSelection: (input) =>
        applyGrokAcpModelSelection({
          ...input,
          currentReasoningEffort: input.currentModelOptions.reasoningEffort,
          requestedReasoningEffort: input.requestedModelOptions.reasoningEffort,
        }),
      promptStopReason: (response) =>
        promptResponseHasMissingXAiStopReason(response) ? null : response.stopReason,
      userInput: {
        methods: ["x.ai/ask_user_question", "_x.ai/ask_user_question"],
        schema: XAiAskUserQuestionRequest,
        extractQuestions: extractXAiAskUserQuestions,
        makeAnsweredResponse: makeXAiAskUserQuestionResponse,
        makeCancelledResponse: makeXAiAskUserQuestionCancelledResponse,
        source: "acp.grok.extension",
      },
      proposedPlan: {
        methods: ["x.ai/exit_plan_mode", "_x.ai/exit_plan_mode"],
        schema: XAiExitPlanModeRequest,
        extractExitMarkdown: (params, fallback) =>
          extractXAiExitPlanMarkdown(decodeXAiExitPlanModeRequest(params), fallback),
        makeExitResponse: makeXAiExitPlanModeCapturedResponse,
        nextModeActive: nextGrokPlanModeActive,
        extractToolMarkdown: extractGrokPlanMarkdownFromToolCallData,
        source: "acp.grok.extension",
      },
      rememberSessionApprovals: true,
    },
    {
      ...options,
      turnInactivityTimeoutMs:
        options?.turnInactivityTimeoutMs ?? DEFAULT_GROK_TURN_INACTIVITY_TIMEOUT_MS,
      activeToolInactivityTimeoutMs:
        options?.activeToolInactivityTimeoutMs ?? DEFAULT_GROK_ACTIVE_TOOL_INACTIVITY_TIMEOUT_MS,
    },
  );
}
