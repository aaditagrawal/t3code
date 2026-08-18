import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  delete next.max_completion_tokens;
  delete next.max_tokens;
  return next;
}

export default function t3OpenRouterCompatibility(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, context) =>
    omitUnsafeOpenRouterMaxTokens(event.payload, context.model),
  );
}
