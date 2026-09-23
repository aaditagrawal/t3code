import {
  AcpSettings,
  AmpSettings,
  AcpRegistrySettings,
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
  readonly settingsSchema: ProviderSettingsSchema;
  readonly environmentFields?: readonly ProviderEnvironmentFieldDefinition[];
  /** Whether this driver has a built-in default instance backed by legacy settings. */
  readonly hasDefaultInstance?: boolean;
  /**
   * Optional short label rendered as a `variant="warning"` badge next to
   * the instance title. Used to flag drivers that still ship under an
   * early-access or preview gate — the flag is a property of the driver
   * kind (not a specific instance), so every instance of that driver —
   * built-in default or custom — advertises the same marker.
   */
  readonly badgeLabel?: string;
}

export interface ProviderEnvironmentFieldDefinition {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly sensitive?: boolean;
}

const PROVIDER_CLIENT_DEFINITIONS: readonly ProviderClientDefinition[] = [
  {
    value: ProviderDriverKind.make("acp"),
    label: "ACP Agent",
    settingsSchema: AcpSettings,
    badgeLabel: "Early Access",
  },
  {
    value: ProviderDriverKind.make("codex"),
    label: "Codex",
    settingsSchema: CodexSettings,
  },
  {
    value: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    settingsSchema: ClaudeSettings,
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    settingsSchema: CursorSettings,
    environmentFields: [
      {
        name: "CURSOR_API_KEY",
        label: "Cursor API key",
        description: "Optional. Overrides browser sign-in for this provider.",
        placeholder: "Paste API key",
        sensitive: true,
      },
    ],
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    settingsSchema: GrokSettings,
  },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    settingsSchema: OpenCodeSettings,
  },
  {
    value: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    settingsSchema: AntigravitySettings,
  },
  {
    value: ProviderDriverKind.make("droid"),
    label: "Droid",
    badgeLabel: "Early Access",
    settingsSchema: DroidSettings,
  },
  {
    value: ProviderDriverKind.make("fx"),
    label: "Fx",
    settingsSchema: FxSettings,
    badgeLabel: "Early Access",
  },
  {
    value: ProviderDriverKind.make("amp"),
    label: "Amp",
    settingsSchema: AmpSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("copilot"),
    label: "GitHub Copilot",
    settingsSchema: CopilotSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("geminiCli"),
    label: "Gemini CLI",
    settingsSchema: GeminiCliSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("kilo"),
    label: "Kilo Code",
    settingsSchema: KiloSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("hermes"),
    label: "Hermes",
    settingsSchema: HermesSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("ohMyPi"),
    label: "Oh My Pi",
    settingsSchema: OhMyPiSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("primeAgent"),
    label: "Prime Agent",
    settingsSchema: PrimeAgentSettings,
    badgeLabel: "Fork Extension",
  },
  {
    value: ProviderDriverKind.make("pi"),
    label: "Pi",
    badgeLabel: "Early Access",
    settingsSchema: PiSettings,
  },
  {
    value: ProviderDriverKind.make("acpRegistry"),
    label: "ACP Registry",
    badgeLabel: "Early Access",
    settingsSchema: AcpRegistrySettings,
    hasDefaultInstance: false,
  },
];

const PROVIDER_CLIENT_DEFINITION_BY_VALUE: Partial<
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
