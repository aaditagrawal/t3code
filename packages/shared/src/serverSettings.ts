import {
  ServerSettings,
  type AmpModelOptions,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type CopilotModelOptions,
  type CursorModelOptions,
  type GeminiCliModelOptions,
  type KiloModelOptions,
  type OpenCodeModelOptions,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { Schema } from "effect";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";

/** Narrow schema that only decodes the observability subtree, avoiding
 *  validation failures from unrelated ServerSettings fields. */
const ObservabilitySubtreeJson = fromLenientJson(
  Schema.Struct({
    observability: Schema.optional(
      Schema.Struct({
        otlpTracesUrl: Schema.optional(Schema.String),
        otlpMetricsUrl: Schema.optional(Schema.String),
      }),
    ),
  }),
);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?:
    | {
        readonly otlpTracesUrl?: string | undefined;
        readonly otlpMetricsUrl?: string | undefined;
      }
    | undefined;
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  try {
    const decoded = Schema.decodeUnknownSync(ObservabilitySubtreeJson)(raw);
    return extractPersistedServerObservabilitySettings(decoded);
  } catch {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.provider !== undefined || patch.model !== undefined));
}

const withModelSelectionOptions = <Options>(options: Options | undefined) =>
  options ? { options } : {};

/**
 * Applies a server settings patch while treating textGenerationModelSelection as
 * replace-on-provider/model updates. This prevents stale nested options from
 * surviving a reset patch that intentionally omits options.
 */
export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const next = deepMerge(current, patch);
  if (!selectionPatch || !shouldReplaceTextGenerationModelSelection(selectionPatch)) {
    return next;
  }

  const provider = selectionPatch.provider ?? current.textGenerationModelSelection.provider;
  const model = selectionPatch.model ?? current.textGenerationModelSelection.model;

  const makeSelection = (): ServerSettings["textGenerationModelSelection"] => {
    switch (provider) {
      case "codex":
        return {
          provider,
          model,
          ...withModelSelectionOptions(selectionPatch.options as CodexModelOptions | undefined),
        };
      case "claudeAgent":
        return {
          provider,
          model,
          ...withModelSelectionOptions(selectionPatch.options as ClaudeModelOptions | undefined),
        };
      case "cursor":
        return {
          provider,
          model,
          ...withModelSelectionOptions(selectionPatch.options as CursorModelOptions | undefined),
        };
      case "opencode":
        return {
          provider,
          model,
          ...withModelSelectionOptions(selectionPatch.options as OpenCodeModelOptions | undefined),
        };
      case "copilot":
        return {
          provider,
          model,
          ...withModelSelectionOptions(selectionPatch.options as CopilotModelOptions | undefined),
        };
      case "geminiCli":
        return {
          provider,
          model,
          ...withModelSelectionOptions(selectionPatch.options as GeminiCliModelOptions | undefined),
        };
      case "amp":
        return {
          provider,
          model,
          ...withModelSelectionOptions(selectionPatch.options as AmpModelOptions | undefined),
        };
      case "kilo":
        return {
          provider,
          model,
          ...withModelSelectionOptions(selectionPatch.options as KiloModelOptions | undefined),
        };
    }
  };

  return {
    ...next,
    textGenerationModelSelection: makeSelection(),
  };
}
