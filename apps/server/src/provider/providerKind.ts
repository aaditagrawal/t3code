/**
 * Fork-local `ProviderKind` closed string union.
 *
 * Upstream's #2277 refactor removed `ProviderKind` from `@t3tools/contracts`
 * in favor of the open branded `ProviderDriverKind`. The fork still ships
 * nine built-in driver names and needs a closed union for legacy-name
 * normalization in `OrchestrationEventStore`'s read path.
 */

const PROVIDER_KINDS = [
  "codex",
  "copilot",
  "claudeAgent",
  "cursor",
  "droid",
  "fx",
  "grok",
  "hermes",
  "opencode",
  "geminiCli",
  "amp",
  "kilo",
  "pi",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

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
