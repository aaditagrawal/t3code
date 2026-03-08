export const DEFAULT_ACCENT_COLOR = "#2563eb";

export const ACCENT_COLOR_PRESETS = [
  { label: "Blue", value: "#2563eb" },
  { label: "Emerald", value: "#059669" },
  { label: "Amber", value: "#d97706" },
  { label: "Rose", value: "#e11d48" },
  { label: "Violet", value: "#7c3aed" },
] as const;

const HEX_COLOR_PATTERN = /^#(?<value>[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeAccentColor(value: string | null | undefined): string {
  const trimmedValue = value?.trim() ?? "";
  const parsed = HEX_COLOR_PATTERN.exec(trimmedValue);
  if (!parsed) {
    return DEFAULT_ACCENT_COLOR;
  }

  const hexValue = parsed.groups?.value?.toLowerCase() ?? "";
  if (hexValue.length === 3) {
    const [r, g, b] = hexValue;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return `#${hexValue}`;
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const normalized = normalizeAccentColor(color);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function toLinearChannel(channel: number): number {
  const normalized = channel / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const rgb = hexToRgb(color);
  return (
    0.2126 * toLinearChannel(rgb.r) +
    0.7152 * toLinearChannel(rgb.g) +
    0.0722 * toLinearChannel(rgb.b)
  );
}

function contrastRatio(a: string, b: string): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function resolveAccentForegroundColor(color: string): "#ffffff" | "#111827" {
  const normalized = normalizeAccentColor(color);
  const whiteContrast = contrastRatio(normalized, "#ffffff");
  const darkContrast = contrastRatio(normalized, "#111827");
  return darkContrast > whiteContrast ? "#111827" : "#ffffff";
}

export function resolveAccentColorRgba(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  const safeAlpha = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`;
}

export function applyAccentColorToDocument(color: string): void {
  if (typeof document === "undefined") {
    return;
  }

  const normalized = normalizeAccentColor(color);
  const foreground = resolveAccentForegroundColor(normalized);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--accent-color", normalized);
  rootStyle.setProperty("--accent-color-foreground", foreground);
}
