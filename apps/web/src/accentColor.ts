export const DEFAULT_ACCENT_COLOR = "#2563eb";

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

/**
 * Returns true when `value` is a syntactically valid hex accent color
 * (3- or 6-digit hex with leading `#`). Unlike `normalizeAccentColor`,
 * this does not substitute a default for invalid values.
 */
export function isValidAccentColor(value: string | null | undefined): boolean {
  return HEX_COLOR_PATTERN.test(value?.trim() ?? "");
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

/** WCAG AA minimum contrast ratio for normal text. */
const WCAG_AA_CONTRAST_THRESHOLD = 4.5;

/**
 * Returns the foreground color that provides the best contrast against the
 * given accent color, or `null` if neither white nor dark text can achieve
 * the WCAG AA contrast threshold (4.5:1).
 */
function resolveAccentForegroundColor(color: string): "#ffffff" | "#111827" | null {
  const normalized = normalizeAccentColor(color);
  const whiteContrast = contrastRatio(normalized, "#ffffff");
  const darkContrast = contrastRatio(normalized, "#111827");
  const bestContrast = Math.max(whiteContrast, darkContrast);
  if (bestContrast < WCAG_AA_CONTRAST_THRESHOLD) {
    return null;
  }
  return darkContrast > whiteContrast ? "#111827" : "#ffffff";
}

export function applyAccentColorToDocument(color: string): void {
  if (typeof document === "undefined") {
    return;
  }

  const normalized = normalizeAccentColor(color);
  const foreground = resolveAccentForegroundColor(normalized);

  // If the accent has insufficient contrast with both white and dark text,
  // fall back to the default accent color which is known to be safe.
  const effectiveColor = foreground !== null ? normalized : DEFAULT_ACCENT_COLOR;
  const effectiveForeground =
    foreground ?? (resolveAccentForegroundColor(DEFAULT_ACCENT_COLOR) as "#ffffff" | "#111827");

  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--accent-color", effectiveColor);
  rootStyle.setProperty("--accent-color-foreground", effectiveForeground);
}
