const DEFAULT_TERMINAL_FONT_FAMILY = [
  '"Symbols Nerd Font Mono"',
  '"Symbols Nerd Font"',
  '"JetBrainsMono Nerd Font Mono"',
  '"JetBrainsMonoNL Nerd Font Mono"',
  '"Hack Nerd Font Mono"',
  '"SauceCodePro Nerd Font Mono"',
  '"FiraCode Nerd Font Mono"',
  '"MesloLGS NF"',
  '"CaskaydiaMono Nerd Font Mono"',
  '"Geist Mono"',
  '"SF Mono"',
  '"SFMono-Regular"',
  "Consolas",
  '"Liberation Mono"',
  "Menlo",
  "monospace",
].join(", ");

export function resolveTerminalFontFamily(): string {
  if (typeof window === "undefined") {
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }

  const configured = getComputedStyle(document.documentElement)
    .getPropertyValue("--terminal-font-family")
    .trim();

  return configured.length > 0 ? configured : DEFAULT_TERMINAL_FONT_FAMILY;
}

