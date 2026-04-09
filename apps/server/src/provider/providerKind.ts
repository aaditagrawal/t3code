import type { ProviderKind } from "@t3tools/contracts";

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

const LEGACY_PROVIDER_KIND_ALIASES = {
  claudeCode: "claudeAgent",
  gemini: "geminiCli",
} as const satisfies Record<string, ProviderKind>;

const PROVIDER_KIND_SET = new Set<ProviderKind>(PROVIDER_KINDS);

export function normalizePersistedProviderKindName(providerName: string): ProviderKind | null {
  const normalized =
    LEGACY_PROVIDER_KIND_ALIASES[providerName as keyof typeof LEGACY_PROVIDER_KIND_ALIASES] ??
    providerName;

  return PROVIDER_KIND_SET.has(normalized as ProviderKind) ? (normalized as ProviderKind) : null;
}
