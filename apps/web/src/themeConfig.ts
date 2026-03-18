import type { AppSettings } from "./appSettings";
import { isValidAccentColor, normalizeAccentColor } from "./accentColor";

// ── Default values ──────────────────────────────────────────────────────────
export const DEFAULT_UI_FONT = "";
export const DEFAULT_CODE_FONT = "";
export const DEFAULT_UI_FONT_SIZE = 0; // 0 = use CSS default
export const DEFAULT_CODE_FONT_SIZE = 0;
export const DEFAULT_CONTRAST = 0; // 0 = no adjustment
export const MIN_UI_FONT_SIZE = 10;
export const MAX_UI_FONT_SIZE = 24;
export const MIN_CODE_FONT_SIZE = 8;
export const MAX_CODE_FONT_SIZE = 24;
export const MIN_CONTRAST = -100;
export const MAX_CONTRAST = 100;

// ── Font families ───────────────────────────────────────────────────────────
const DEFAULT_UI_FONT_STACK =
  '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const DEFAULT_CODE_FONT_STACK =
  '"Geist Mono", "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

function buildFontStack(userFont: string, fallback: string): string {
  const trimmed = userFont.trim();
  if (!trimmed) return fallback;
  // If the user provided a comma-separated stack, keep it as-is
  if (trimmed.includes(",")) {
    return `${trimmed}, ${fallback}`;
  }
  // If the single font family contains spaces and isn't already quoted, quote it
  const quoted =
    trimmed.includes(" ") && !trimmed.startsWith('"') && !trimmed.startsWith("'")
      ? `"${trimmed}"`
      : trimmed;
  return `${quoted}, ${fallback}`;
}

function clampFontSize(size: number, min: number, max: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return Math.min(max, Math.max(min, Math.round(size)));
}

function clampContrast(contrast: number): number {
  if (!Number.isFinite(contrast)) return 0;
  return Math.min(MAX_CONTRAST, Math.max(MIN_CONTRAST, Math.round(contrast)));
}

// ── Apply to document ───────────────────────────────────────────────────────

export function applyThemeConfigToDocument(settings: AppSettings): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement.style;

  // Fonts
  const uiFontStack = buildFontStack(settings.uiFont, DEFAULT_UI_FONT_STACK);
  const codeFontStack = buildFontStack(settings.codeFont, DEFAULT_CODE_FONT_STACK);
  root.setProperty("--theme-ui-font", uiFontStack);
  root.setProperty("--theme-code-font", codeFontStack);

  // Font sizes
  const uiSize = clampFontSize(settings.uiFontSize, MIN_UI_FONT_SIZE, MAX_UI_FONT_SIZE);
  const codeSize = clampFontSize(settings.codeFontSize, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE);
  if (uiSize > 0) {
    root.setProperty("--theme-ui-font-size", `${uiSize}px`);
  } else {
    root.removeProperty("--theme-ui-font-size");
  }
  if (codeSize > 0) {
    root.setProperty("--theme-code-font-size", `${codeSize}px`);
  } else {
    root.removeProperty("--theme-code-font-size");
  }

  // Background/foreground overrides
  if (settings.backgroundColorOverride && isValidAccentColor(settings.backgroundColorOverride)) {
    root.setProperty(
      "--theme-background-override",
      normalizeAccentColor(settings.backgroundColorOverride),
    );
  } else {
    root.removeProperty("--theme-background-override");
  }
  if (settings.foregroundColorOverride && isValidAccentColor(settings.foregroundColorOverride)) {
    root.setProperty(
      "--theme-foreground-override",
      normalizeAccentColor(settings.foregroundColorOverride),
    );
  } else {
    root.removeProperty("--theme-foreground-override");
  }

  // Contrast adjustment
  const contrast = clampContrast(settings.contrast);
  if (contrast !== 0) {
    root.setProperty("--theme-contrast", String(contrast));
  } else {
    root.removeProperty("--theme-contrast");
  }

  // Translucency
  if (settings.translucency) {
    document.documentElement.classList.add("theme-translucent");
  } else {
    document.documentElement.classList.remove("theme-translucent");
  }
}
