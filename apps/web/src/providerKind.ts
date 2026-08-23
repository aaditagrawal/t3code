/**
 * Fork-local `ProviderKind` closed string union.
 *
 * Upstream's #2277 refactor removed the `ProviderKind` union from
 * `@t3tools/contracts` in favor of `ProviderDriverKind` (an open branded
 * slug). The fork still relies on a closed union of built-in provider names
 * it ships adapters for — used as keys in `Record<ProviderKind, …>` shapes
 * and as the discriminator in exhaustive `switch` statements throughout the
 * web app.
 *
 * This module preserves that closed union so existing call sites compile
 * unchanged. New code that needs to interop with the runtime instance
 * registry should prefer `ProviderDriverKind` from `@t3tools/contracts`.
 */

export const PROVIDER_KINDS = [
  "acp",
  "codex",
  "copilot",
  "claudeAgent",
  "cursor",
  "droid",
  "fx",
  "grok",
  "opencode",
  "geminiCli",
  "amp",
  "kilo",
  "hermes",
  "pi",
  "ohMyPi",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

const PROVIDER_KIND_SET: ReadonlySet<string> = new Set<string>(PROVIDER_KINDS);

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === "string" && PROVIDER_KIND_SET.has(value);
}
