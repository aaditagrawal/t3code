import { type ComponentProps } from "react";
import { type ProviderKind } from "@t3tools/contracts";

import { useAppSettings } from "../appSettings";
import { cn } from "../lib/utils";
import {
  type Icon,
  AmpIcon,
  ClaudeAI,
  CursorIcon,
  Gemini,
  GitHubIcon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
} from "./Icons";

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderKind, Icon> = {
  codex: OpenAI,
  copilot: GitHubIcon,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
  geminiCli: Gemini,
  amp: AmpIcon,
  kilo: KiloIcon,
};

export type ProviderLogoProps = Omit<ComponentProps<Icon>, "monochrome"> & {
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
      monochrome={isAccentAppearance}
      className={cn(className, settings.providerLogoAppearance === "grayscale" && "grayscale")}
      style={isAccentAppearance ? { ...style, color: accentColor } : style}
    />
  );
}
