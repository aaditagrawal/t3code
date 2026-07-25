import type {
  ModelCapabilities,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  ServerProviderModel,
  ToolLifecycleItemType,
} from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { createModelCapabilities, normalizeModelSlug } from "@t3tools/shared/model";

import {
  buildBooleanOptionDescriptor,
  buildSelectOptionDescriptor,
  providerModelsFromSettings,
} from "../providerSnapshot.ts";
import type {
  CursorSdkModelListItem,
  CursorSdkModelParameterDefinition,
  CursorSdkModelParameterValue,
  CursorSdkModelSelection,
  CursorSdkModelVariant,
} from "./CursorSdkClient.ts";

export const CURSOR_DEFAULT_MODEL = "composer-2.5";
export const CURSOR_RESUME_VERSION = 2 as const;

const PROVIDER = ProviderDriverKind.make("cursor");
export const EMPTY_CURSOR_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export const CURSOR_FALLBACK_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: CURSOR_DEFAULT_MODEL,
    name: "Composer 2.5",
    isCustom: false,
    capabilities: EMPTY_CURSOR_CAPABILITIES,
  },
];

const PARAM_ID_ALIASES = new Map<string, string>([
  ["reasoning", "effort"],
  ["reasoningeffort", "effort"],
  ["effort", "effort"],
  ["thoughtlevel", "effort"],
  ["contextwindow", "context"],
  ["contextsize", "context"],
  ["context", "context"],
  ["fastmode", "fast"],
  ["fast", "fast"],
  ["thinking", "thinking"],
]);

const DESCRIPTOR_ID_ALIASES = new Map<string, string>([
  ["effort", "reasoning"],
  ["reasoning", "reasoning"],
  ["thoughtlevel", "reasoning"],
  ["context", "contextWindow"],
  ["contextwindow", "contextWindow"],
  ["contextsize", "contextWindow"],
  ["fast", "fastMode"],
  ["fastmode", "fastMode"],
  ["thinking", "thinking"],
]);

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parameterIdForSelection(id: string): string {
  return PARAM_ID_ALIASES.get(normalizeToken(id)) ?? id.trim();
}

function descriptorIdForParameter(id: string): string {
  return DESCRIPTOR_ID_ALIASES.get(normalizeToken(id)) ?? id.trim();
}

export function cursorSdkApiKey(environment?: NodeJS.ProcessEnv): string | undefined {
  return nonEmpty(environment?.CURSOR_API_KEY) ?? nonEmpty(process.env.CURSOR_API_KEY);
}

export function normalizeCursorSdkModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  if (!trimmed) {
    return CURSOR_DEFAULT_MODEL;
  }

  const bracketIndex = trimmed.indexOf("[");
  const withoutInlineParams =
    bracketIndex === -1 ? trimmed : (nonEmpty(trimmed.slice(0, bracketIndex)) ?? trimmed);
  const normalized = normalizeModelSlug(withoutInlineParams, PROVIDER) ?? withoutInlineParams;
  const lower = normalized.toLowerCase();
  if (
    lower === "auto" ||
    lower === "default" ||
    lower === "composer" ||
    lower === "composer-latest"
  ) {
    return CURSOR_DEFAULT_MODEL;
  }
  return normalized;
}

export function parseCursorInlineModelParams(
  model: string | null | undefined,
): ReadonlyArray<CursorSdkModelParameterValue> {
  const raw = model?.trim();
  if (!raw) {
    return [];
  }
  const match = raw.match(/\[([^\]]+)\]\s*$/);
  if (!match?.[1]) {
    return [];
  }
  return match[1].split(",").flatMap((part) => {
    const [rawId, ...rawValueParts] = part.split("=");
    const id = nonEmpty(rawId);
    const value = nonEmpty(rawValueParts.join("="));
    if (!id || !value) {
      return [];
    }
    return [{ id: parameterIdForSelection(id), value }];
  });
}

function selectionParams(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): ReadonlyArray<CursorSdkModelParameterValue> {
  return (selections ?? []).flatMap((selection) => {
    const id = parameterIdForSelection(selection.id);
    if (!id) {
      return [];
    }
    const rawValue = selection.value;
    const value = typeof rawValue === "boolean" ? String(rawValue) : nonEmpty(rawValue);
    if (!value) {
      return [];
    }
    return [{ id, value }];
  });
}

export function toCursorSdkModelSelection(
  model: string | null | undefined,
  selections?: ReadonlyArray<ProviderOptionSelection> | null,
): CursorSdkModelSelection {
  const params = [...parseCursorInlineModelParams(model), ...selectionParams(selections)];
  const dedupedParams = new Map<string, CursorSdkModelParameterValue>();
  for (const param of params) {
    dedupedParams.set(param.id, param);
  }
  const resolvedParams = [...dedupedParams.values()];
  return {
    id: normalizeCursorSdkModelId(model),
    ...(resolvedParams.length > 0 ? { params: resolvedParams } : {}),
  };
}

function defaultParamValue(
  parameter: CursorSdkModelParameterDefinition,
  variants: ReadonlyArray<CursorSdkModelVariant> | undefined,
): string | undefined {
  const defaultVariant = variants?.find((variant) => variant.isDefault);
  const variantValue = defaultVariant?.params.find((param) => param.id === parameter.id)?.value;
  return nonEmpty(variantValue) ?? nonEmpty(parameter.values[0]?.value);
}

function isBooleanParameter(parameter: CursorSdkModelParameterDefinition): boolean {
  const values = new Set(parameter.values.map((entry) => entry.value.toLowerCase()));
  return values.has("true") && values.has("false");
}

function labelForDescriptor(id: string, fallback: string | undefined): string {
  const explicit = nonEmpty(fallback);
  if (explicit) {
    return explicit;
  }
  switch (id) {
    case "reasoning":
      return "Reasoning";
    case "contextWindow":
      return "Context";
    case "fastMode":
      return "Fast mode";
    case "thinking":
      return "Thinking";
    default:
      return id;
  }
}

function descriptorFromParameter(
  parameter: CursorSdkModelParameterDefinition,
  variants: ReadonlyArray<CursorSdkModelVariant> | undefined,
): ProviderOptionDescriptor | undefined {
  const descriptorId = descriptorIdForParameter(parameter.id);
  if (!descriptorId || parameter.values.length === 0) {
    return undefined;
  }
  const label = labelForDescriptor(descriptorId, parameter.displayName);
  const defaultValue = defaultParamValue(parameter, variants);

  if (isBooleanParameter(parameter)) {
    return buildBooleanOptionDescriptor({
      id: descriptorId,
      label,
      ...(defaultValue === "true"
        ? { currentValue: true }
        : defaultValue === "false"
          ? { currentValue: false }
          : {}),
    });
  }

  return buildSelectOptionDescriptor({
    id: descriptorId,
    label,
    options: parameter.values.map((entry) => ({
      value: entry.value,
      label: entry.displayName ?? entry.value,
      ...(defaultValue === entry.value ? { isDefault: true } : {}),
    })),
  });
}

export function buildCursorCapabilitiesFromSdkModel(
  model: CursorSdkModelListItem | null | undefined,
): ModelCapabilities {
  const descriptors = (model?.parameters ?? []).flatMap((parameter) => {
    const descriptor = descriptorFromParameter(parameter, model?.variants);
    return descriptor ? [descriptor] : [];
  });
  return createModelCapabilities({ optionDescriptors: descriptors });
}

export function buildCursorDiscoveredModelsFromSdkModels(
  models: ReadonlyArray<CursorSdkModelListItem>,
  customModels: ReadonlyArray<string> = [],
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  const discovered = models.flatMap((model) => {
    const slug = nonEmpty(model.id);
    if (!slug || seen.has(slug)) {
      return [];
    }
    seen.add(slug);
    return [
      {
        slug,
        name: nonEmpty(model.displayName) ?? slug,
        isCustom: false,
        capabilities: buildCursorCapabilitiesFromSdkModel(model),
      } satisfies ServerProviderModel,
    ];
  });

  const builtInModels = discovered.length > 0 ? discovered : CURSOR_FALLBACK_MODELS;
  return providerModelsFromSettings(
    builtInModels,
    customModels,
    EMPTY_CURSOR_CAPABILITIES,
  );
}

export function toCursorToolItemType(toolName: string): ToolLifecycleItemType {
  const normalized = toolName.toLowerCase();
  if (
    normalized.includes("shell") ||
    normalized.includes("bash") ||
    normalized.includes("command") ||
    normalized === "terminal"
  ) {
    return "command_execution";
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("patch") ||
    normalized.includes("delete") ||
    normalized.includes("file")
  ) {
    return "file_change";
  }
  if (normalized.includes("mcp")) {
    return "mcp_tool_call";
  }
  if (normalized.includes("web") || normalized.includes("search") || normalized.includes("grep")) {
    return "web_search";
  }
  if (normalized.includes("image")) {
    return "image_view";
  }
  if (
    normalized.includes("task") ||
    normalized.includes("agent") ||
    normalized.includes("subagent")
  ) {
    return "collab_agent_tool_call";
  }
  return "dynamic_tool_call";
}
