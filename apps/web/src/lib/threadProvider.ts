import { type ProviderKind } from "@t3tools/contracts";
import { getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";
import type { Thread } from "../types";

const PROVIDER_KINDS = [
  "codex",
  "copilot",
  "claudeAgent",
  "cursor",
  "opencode",
  "geminiCli",
  "amp",
  "kilo",
] as const satisfies ReadonlyArray<ProviderKind>;

const PROVIDER_KIND_SET = new Set<ProviderKind>(PROVIDER_KINDS);

const CODEX_MODEL_SLUGS = new Set<string>(getModelOptions("codex").map((option) => option.slug));
const COPILOT_MODEL_SLUGS = new Set<string>(
  getModelOptions("copilot").map((option) => option.slug),
);
const CLAUDE_MODEL_SLUGS = new Set<string>(
  getModelOptions("claudeAgent").map((option) => option.slug),
);
const CURSOR_MODEL_SLUGS = new Set<string>(getModelOptions("cursor").map((option) => option.slug));
const OPENCODE_MODEL_SLUGS = new Set<string>(
  getModelOptions("opencode").map((option) => option.slug),
);
const GEMINI_CLI_MODEL_SLUGS = new Set<string>(
  getModelOptions("geminiCli").map((option) => option.slug),
);
const AMP_MODEL_SLUGS = new Set<string>(getModelOptions("amp").map((option) => option.slug));
const KILO_MODEL_SLUGS = new Set<string>(getModelOptions("kilo").map((option) => option.slug));
const CURSOR_DISTINCT_MODEL_SLUGS = new Set(
  [...CURSOR_MODEL_SLUGS].filter(
    (slug) =>
      !CODEX_MODEL_SLUGS.has(slug) &&
      !COPILOT_MODEL_SLUGS.has(slug) &&
      !CLAUDE_MODEL_SLUGS.has(slug) &&
      !OPENCODE_MODEL_SLUGS.has(slug),
  ),
);
const AMP_DISTINCT_MODEL_SLUGS = new Set(
  [...AMP_MODEL_SLUGS].filter(
    (slug) =>
      !CODEX_MODEL_SLUGS.has(slug) &&
      !COPILOT_MODEL_SLUGS.has(slug) &&
      !CLAUDE_MODEL_SLUGS.has(slug) &&
      !CURSOR_MODEL_SLUGS.has(slug) &&
      !OPENCODE_MODEL_SLUGS.has(slug) &&
      !GEMINI_CLI_MODEL_SLUGS.has(slug) &&
      !KILO_MODEL_SLUGS.has(slug),
  ),
);

export function toProviderKind(providerName: string | null | undefined): ProviderKind | null {
  if (!providerName) return null;
  return PROVIDER_KIND_SET.has(providerName as ProviderKind)
    ? (providerName as ProviderKind)
    : null;
}

export function inferProviderForThreadModel(input: {
  readonly model: string;
  readonly sessionProviderName: string | null;
}): ProviderKind {
  const sessionProvider = toProviderKind(input.sessionProviderName);
  if (sessionProvider) {
    return sessionProvider;
  }

  const normalizedCopilot = normalizeModelSlug(input.model, "copilot");
  if (normalizedCopilot && COPILOT_MODEL_SLUGS.has(normalizedCopilot)) {
    return "copilot";
  }

  const normalizedGeminiCli = normalizeModelSlug(input.model, "geminiCli");
  if (normalizedGeminiCli && GEMINI_CLI_MODEL_SLUGS.has(normalizedGeminiCli)) {
    return "geminiCli";
  }

  const normalizedAmp = normalizeModelSlug(input.model, "amp");
  if (normalizedAmp && AMP_DISTINCT_MODEL_SLUGS.has(normalizedAmp)) {
    return "amp";
  }

  const normalizedCursor = normalizeModelSlug(input.model, "cursor");
  if (normalizedCursor && CURSOR_DISTINCT_MODEL_SLUGS.has(normalizedCursor)) {
    return "cursor";
  }

  const normalizedClaude = normalizeModelSlug(input.model, "claudeAgent");
  if (normalizedClaude && CLAUDE_MODEL_SLUGS.has(normalizedClaude)) {
    return "claudeAgent";
  }

  const normalizedCodex = normalizeModelSlug(input.model, "codex");
  if (normalizedCodex && CODEX_MODEL_SLUGS.has(normalizedCodex)) {
    return "codex";
  }

  const normalizedOpencode = normalizeModelSlug(input.model, "opencode");
  if (normalizedOpencode && OPENCODE_MODEL_SLUGS.has(normalizedOpencode)) {
    return "opencode";
  }

  const normalizedKilo = normalizeModelSlug(input.model, "kilo");
  if (normalizedKilo && KILO_MODEL_SLUGS.has(normalizedKilo)) {
    return "kilo";
  }

  if (input.model.includes("/")) {
    return "opencode";
  }

  if (input.model.trim().startsWith("composer-") || input.model.trim().endsWith("-thinking")) {
    return "cursor";
  }

  return input.model.trim().startsWith("claude-") ? "claudeAgent" : "codex";
}

export function resolveThreadProvider(thread: Pick<Thread, "model" | "session">): ProviderKind {
  return inferProviderForThreadModel({
    model: thread.model,
    sessionProviderName: thread.session?.provider ?? null,
  });
}
