import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNearContextLimit(value: unknown, contextWindow: number): boolean {
  return typeof value === "number" && value > contextWindow / 2;
}

export function omitUnsafeOpenRouterMaxTokens(
  payload: unknown,
  model: ExtensionContext["model"],
): unknown | undefined {
  if (
    model?.provider !== "openrouter" ||
    model.api !== "openai-completions" ||
    model.maxTokens < model.contextWindow ||
    !isJsonObject(payload)
  ) {
    return undefined;
  }

  const next = { ...payload };
  let changed = false;
  if (isNearContextLimit(next.max_completion_tokens, model.contextWindow)) {
    delete next.max_completion_tokens;
    changed = true;
  }
  if (isNearContextLimit(next.max_tokens, model.contextWindow)) {
    delete next.max_tokens;
    changed = true;
  }
  return changed ? next : undefined;
}

export default function t3OpenRouterCompatibility(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, context) =>
    omitUnsafeOpenRouterMaxTokens(event.payload, context.model),
  );
}
