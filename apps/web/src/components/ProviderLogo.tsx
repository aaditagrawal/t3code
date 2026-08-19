import { type ComponentProps } from "react";

import { useAppSettings } from "../appSettings";
import { cn } from "../lib/utils";
import type { ProviderKind } from "../providerKind";
import {
  type Icon,
  ACPRegistryIcon,
  AmpIcon,
  ClaudeAI,
  CursorIcon,
  DroidIcon,
  FxIcon,
  Gemini,
  GitHubIcon,
  GrokIcon,
  HermesIcon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
  PiAgentIcon,
} from "./Icons";

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderKind, Icon> = {
  acp: ACPRegistryIcon,
  codex: OpenAI,
  copilot: GitHubIcon,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  droid: DroidIcon,
  fx: FxIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  geminiCli: Gemini,
  amp: AmpIcon,
  kilo: KiloIcon,
  hermes: HermesIcon,
  pi: PiAgentIcon,
};

export type ProviderLogoProps = ComponentProps<Icon> & {
  provider: ProviderKind;
};

export function ProviderLogo({ provider, className, style, ...props }: ProviderLogoProps) {
  const { settings } = useAppSettings();
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[provider];
  const isAccentAppearance = settings.providerLogoAppearance === "accent";
  const accentColor = settings.providerAccentColors[provider] ?? settings.accentColor;

  return (
    <ProviderIcon
      {...props}
      className={cn(
        className,
        settings.providerLogoAppearance === "grayscale" && "grayscale",
        isAccentAppearance && "[&_path]:fill-[currentColor]",
      )}
      style={isAccentAppearance ? { ...style, color: accentColor } : style}
    />
  );
}
