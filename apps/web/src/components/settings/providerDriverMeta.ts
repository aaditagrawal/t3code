import {
  AcpSettings,
  AmpSettings,
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  CopilotSettings,
  CursorSettings,
  DroidSettings,
  FxSettings,
  GeminiCliSettings,
  GrokSettings,
  HermesSettings,
  KiloSettings,
  PrimeAgentSettings,
  OhMyPiSettings,
  OpenCodeSettings,
  PiSettings,
  ProviderDriverKind,
} from "@t3tools/contracts";
import type * as Schema from "effect/Schema";
import {
  ACPRegistryIcon,
  AmpIcon,
  AntigravityIcon,
  ClaudeAI,
  CopilotIcon,
  CursorIcon,
  DroidIcon,
  FxIcon,
  GeminiCliIcon,
  GrokIcon,
  HermesIcon,
  type Icon,
  KiloIcon,
  PrimeAgentIcon,
  OhMyPiIcon,
  OpenAI,
  OpenCodeIcon,
  PiAgentIcon,
} from "../Icons";

type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Top;

/**
 * Browser-safe provider definition. This is deliberately shaped like the
 * future provider package client export: the core web app gets a schema with
 * field annotations plus provider-level presentation metadata, then renders
 * settings generically.
 */
export interface ProviderClientDefinition {
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly icon: Icon;
  readonly settingsSchema: ProviderSettingsSchema;
  /**
   * Optional short label rendered as a `variant="warning"` badge next to
   * the instance title. Used to flag drivers that still ship under an
   * early-access or preview gate — the flag is a property of the driver
   * kind (not a specific instance), so every instance of that driver —
   * built-in default or custom — advertises the same marker.
   */
  readonly badgeLabel?: string;
}

export const PROVIDER_CLIENT_DEFINITIONS: readonly ProviderClientDefinition[] = [
  {
    value: ProviderDriverKind.make("primeAgent"),
    label: "Prime Agent",
    icon: PrimeAgentIcon,
    settingsSchema: PrimeAgentSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("acp"),
    label: "ACP Agent",
    icon: ACPRegistryIcon,
    settingsSchema: AcpSettings,
    badgeLabel: "Early Access",
  },
  {
    value: ProviderDriverKind.make("codex"),
    label: "Codex",
    icon: OpenAI,
    settingsSchema: CodexSettings,
  },
  {
    value: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    icon: ClaudeAI,
    settingsSchema: ClaudeSettings,
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    icon: CursorIcon,
    badgeLabel: "Early Access",
    settingsSchema: CursorSettings,
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    icon: GrokIcon,
    badgeLabel: "Early Access",
    settingsSchema: GrokSettings,
  },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    icon: OpenCodeIcon,
    settingsSchema: OpenCodeSettings,
  },
  {
    value: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    icon: AntigravityIcon,
    settingsSchema: AntigravitySettings,
  },
  {
    value: ProviderDriverKind.make("droid"),
    label: "Droid",
    icon: DroidIcon,
    badgeLabel: "Early Access",
    settingsSchema: DroidSettings,
  },
  {
    value: ProviderDriverKind.make("fx"),
    label: "Fx",
    icon: FxIcon,
    settingsSchema: FxSettings,
    badgeLabel: "Early Access",
  },
  {
    value: ProviderDriverKind.make("amp"),
    label: "Amp",
    icon: AmpIcon,
    settingsSchema: AmpSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("copilot"),
    label: "GitHub Copilot",
    icon: CopilotIcon,
    settingsSchema: CopilotSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("geminiCli"),
    label: "Gemini CLI",
    icon: GeminiCliIcon,
    settingsSchema: GeminiCliSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("kilo"),
    label: "Kilo Code",
    icon: KiloIcon,
    settingsSchema: KiloSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("hermes"),
    label: "Hermes",
    icon: HermesIcon,
    settingsSchema: HermesSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("pi"),
    label: "Pi",
    icon: PiAgentIcon,
    settingsSchema: PiSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("ohMyPi"),
    label: "Oh My Pi",
    icon: OhMyPiIcon,
    settingsSchema: OhMyPiSettings,
    badgeLabel: "Fork Extension",
  },
];

export const PROVIDER_CLIENT_DEFINITION_BY_VALUE: Partial<
  Record<ProviderDriverKind, ProviderClientDefinition>
> = Object.fromEntries(
  PROVIDER_CLIENT_DEFINITIONS.map((definition) => [definition.value, definition]),
);

export const DRIVER_OPTIONS = PROVIDER_CLIENT_DEFINITIONS;
export const DRIVER_OPTION_BY_VALUE = PROVIDER_CLIENT_DEFINITION_BY_VALUE;
export type DriverOption = ProviderClientDefinition;

/**
 * Look up the driver metadata for an instance's `driver` field. Accepts
 * Returns `undefined` for fork / unknown drivers so callers can decide how
 * to render them — typically by falling back to a generic card.
 */
export function getDriverOption(driver: ProviderDriverKind | undefined): DriverOption | undefined {
  if (driver === undefined) return undefined;
  return PROVIDER_CLIENT_DEFINITION_BY_VALUE[driver];
}
