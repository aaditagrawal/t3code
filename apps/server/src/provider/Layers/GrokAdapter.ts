import { type GrokSettings, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import {
  applyGrokAcpModelSelection,
  currentGrokModelIdFromSessionSetup,
  makeGrokAcpRuntime,
  resolveGrokAcpBaseModelId,
} from "../acp/GrokAcpSupport.ts";
import {
  extractXAiAskUserQuestions,
  makeXAiAskUserQuestionCancelledResponse,
  makeXAiAskUserQuestionResponse,
  promptResponseHasMissingXAiStopReason,
  XAiAskUserQuestionRequest,
} from "../acp/XAiAcpExtension.ts";
import {
  makeStandardAcpAdapter,
  standardAcpPromptSettlementBelongsToContext,
  type StandardAcpAdapterLiveOptions,
} from "./StandardAcpAdapter.ts";

export interface GrokAdapterLiveOptions extends StandardAcpAdapterLiveOptions {}

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
      applyModelSelection: applyGrokAcpModelSelection,
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
    },
    options,
  );
}
