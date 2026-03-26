import { Schema } from "effect";

export const APP_PROVIDER_LOGO_APPEARANCE_OPTIONS = [
  {
    value: "original",
    label: "Default color",
    description: "Use each provider's native logo colors.",
  },
  {
    value: "grayscale",
    label: "Grayscale",
    description: "Desaturate provider logos while keeping their original shapes.",
  },
  {
    value: "accent",
    label: "Accent color",
    description: "Tint every provider logo with your global or per-provider accent color.",
  },
] as const;

export type AppProviderLogoAppearance =
  (typeof APP_PROVIDER_LOGO_APPEARANCE_OPTIONS)[number]["value"];

export const AppProviderLogoAppearanceSchema = Schema.Literals(["original", "grayscale", "accent"]);

export const TIMESTAMP_FORMAT_OPTIONS = ["locale", "12-hour", "24-hour"] as const;
export type TimestampFormat = (typeof TIMESTAMP_FORMAT_OPTIONS)[number];
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";
