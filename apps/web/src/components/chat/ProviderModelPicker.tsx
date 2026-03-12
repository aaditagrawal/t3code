import { type ModelSlug, type ProviderKind } from "@t3tools/contracts";
import {
  normalizeModelSlug,
  parseCursorModelSelection,
  resolveCursorPickerModelSlug,
} from "@t3tools/shared/model";
import { memo, useState } from "react";
import { PROVIDER_OPTIONS } from "../../session-logic";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import {
  AmpIcon,
  ClaudeAI,
  CursorIcon,
  Gemini,
  GitHubIcon,
  Icon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
} from "../Icons";
import { cn } from "~/lib/utils";
import { getAppModelOptions } from "../../appSettings";
import {
  getCursorModelFamilyOptions,
} from "@t3tools/shared/model";

export type ModelOptionEntry = {
  slug: string;
  name: string;
  pricingTier?: string;
  isCustom?: boolean;
};

type GroupedModelEntry = {
  readonly subProvider: string;
  readonly models: ReadonlyArray<ModelOptionEntry>;
};

export function getCustomModelOptionsByProvider(settings: {
  customCodexModels: readonly string[];
  customCopilotModels: readonly string[];
  customClaudeModels: readonly string[];
  customCursorModels: readonly string[];
  customOpencodeModels: readonly string[];
  customGeminiCliModels: readonly string[];
  customAmpModels: readonly string[];
  customKiloModels: readonly string[];
}): Record<ProviderKind, ReadonlyArray<ModelOptionEntry>> {
  const cursorFamilyOptions = getCursorModelFamilyOptions();
  return {
    codex: getAppModelOptions("codex", settings.customCodexModels),
    copilot: getAppModelOptions("copilot", settings.customCopilotModels),
    claudeCode: getAppModelOptions("claudeCode", settings.customClaudeModels),
    cursor: [
      ...cursorFamilyOptions,
      ...getAppModelOptions("cursor", settings.customCursorModels).filter(
        (option) =>
          option.isCustom && !cursorFamilyOptions.some((family) => family.slug === option.slug),
      ),
    ],
    opencode: getAppModelOptions("opencode", settings.customOpencodeModels),
    geminiCli: getAppModelOptions("geminiCli", settings.customGeminiCliModels),
    amp: getAppModelOptions("amp", settings.customAmpModels),
    kilo: getAppModelOptions("kilo", settings.customKiloModels),
  };
}

export function mergeDiscoveredModels(
  base: Record<ProviderKind, ReadonlyArray<ModelOptionEntry>>,
  discovered: Partial<Record<ProviderKind, ReadonlyArray<ModelOptionEntry> | undefined>>,
): Record<ProviderKind, ReadonlyArray<ModelOptionEntry>> {
  const result = { ...base };
  for (const [provider, models] of Object.entries(discovered) as Array<
    [ProviderKind, ReadonlyArray<ModelOptionEntry> | undefined]
  >) {
    if (!models || models.length === 0) continue;
    const normalizedModels =
      provider === "cursor"
        ? models.filter((model) => resolveCursorPickerModelSlug(model.slug) === model.slug)
        : models;
    const dedupedModels = Array.from(new Map(normalizedModels.map((m) => [m.slug, m])).values());
    const existing = new Set(base[provider]?.map((m) => m.slug));
    // For copilot, discovered models replace the static list but inherit
    // pricingTier from the static entries when the SDK doesn't provide it.
    if (provider === "copilot") {
      const baseTiers = new Map(
        (base[provider] ?? []).map((m) => [m.slug, m.pricingTier]),
      );
      const enriched = dedupedModels.map((m) => {
        if (m.pricingTier) return m;
        const tier = baseTiers.get(m.slug);
        return tier ? { ...m, pricingTier: tier } : m;
      });
      const customOnly = (base[provider] ?? []).filter(
        (m) => m.isCustom && !dedupedModels.some((d) => d.slug === m.slug),
      );
      result[provider] = [...enriched, ...customOnly];
      continue;
    }
    // Build a lookup of discovered models by slug so we can merge metadata
    // (e.g. pricingTier) into base entries and also add truly-new models.
    const discoveredBySlug = new Map(dedupedModels.map((m) => [m.slug, m]));
    const merged = (base[provider] ?? []).map((m) => {
      const disc = discoveredBySlug.get(m.slug);
      return disc ? { ...m, ...disc } : m;
    });
    // Append any discovered models that weren't already in the base list.
    const additions = dedupedModels.filter((m) => !existing.has(m.slug));
    result[provider] = [...additions, ...merged];
  }
  return result;
}

function groupModelsBySubProvider(
  models: ReadonlyArray<ModelOptionEntry>,
): ReadonlyArray<GroupedModelEntry> {
  const groupOrder: string[] = [];
  const groupMap = new Map<string, { displayName: string; models: ModelOptionEntry[] }>();
  const ungrouped: ModelOptionEntry[] = [];

  for (const model of models) {
    const slashIndex = model.slug.indexOf("/");
    if (slashIndex > 0) {
      const subProviderId = model.slug.slice(0, slashIndex);
      const nameSlashIndex = model.name.indexOf(" / ");
      const subProviderName = nameSlashIndex > 0 ? model.name.slice(0, nameSlashIndex) : subProviderId;
      const modelName = nameSlashIndex > 0 ? model.name.slice(nameSlashIndex + 3) : model.name;

      let group = groupMap.get(subProviderId);
      if (!group) {
        group = { displayName: subProviderName, models: [] };
        groupMap.set(subProviderId, group);
        groupOrder.push(subProviderId);
      }
      group.models.push({
        slug: model.slug,
        name: modelName,
        ...(model.pricingTier != null && { pricingTier: model.pricingTier }),
        ...(model.isCustom != null && { isCustom: model.isCustom }),
      });
    } else {
      ungrouped.push(model);
    }
  }

  const result: GroupedModelEntry[] = groupOrder.map((id) => {
    const group = groupMap.get(id)!;
    return { subProvider: group.displayName, models: group.models };
  });
  if (ungrouped.length > 0) {
    result.push({ subProvider: "Other", models: ungrouped });
  }
  return result;
}

function resolveModelForProviderPicker(
  provider: ProviderKind,
  value: string,
  options: ReadonlyArray<{ slug: string; name: string }>,
): ModelSlug | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmedValue);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmedValue.toLowerCase());
  if (byName) {
    return byName.slug;
  }

  const normalized = normalizeModelSlug(trimmedValue, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  if (resolved) {
    return resolved.slug;
  }

  if (provider === "cursor") {
    return parseCursorModelSelection(normalized).family;
  }

  return null;
}

export function formatPricingTier(tier: string): string {
  // Normalize to uppercase X suffix: "1x" -> "1X", "0.3x" -> "0.3X"
  return tier.replace(/x$/i, "X");
}

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderKind, Icon> = {
  codex: OpenAI,
  copilot: GitHubIcon,
  claudeCode: ClaudeAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
  geminiCli: Gemini,
  amp: AmpIcon,
  kilo: KiloIcon,
};

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter((option) => option.available);
const UNAVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter((option) => !option.available);
const COMING_SOON_PROVIDER_OPTIONS: ReadonlyArray<{ id: string; label: string; icon: Icon }> = [];

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ModelOptionEntry>>;
  compact?: boolean;
  disabled?: boolean;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const selectedProviderOptions = props.modelOptionsByProvider[props.provider];
  const selectedModelOption = selectedProviderOptions.find((option) => option.slug === props.model);
  const selectedModelLabel = selectedModelOption?.name ?? props.model;
  const selectedPricingTier = selectedModelOption?.pricingTier;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.provider];

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "min-w-0 shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80",
              props.compact ? "max-w-42" : "sm:px-3",
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn("flex min-w-0 items-center gap-2", props.compact ? "max-w-36" : undefined)}
        >
          <ProviderIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              props.provider === "claudeCode" ? "" : "text-muted-foreground/70",
            )}
          />
          <span className="truncate">{selectedModelLabel}</span>
          {selectedPricingTier ? (
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {formatPricingTier(selectedPricingTier)}
            </span>
          ) : null}
          <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        {AVAILABLE_PROVIDER_OPTIONS.map((option) => {
          const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
          const isDisabledByProviderLock =
            props.lockedProvider !== null && props.lockedProvider !== option.value;
          const providerModels = props.modelOptionsByProvider[option.value];
          const onModelSelect = (value: string) => {
            if (props.disabled) return;
            if (isDisabledByProviderLock) return;
            if (!value) return;
            const resolvedModel = resolveModelForProviderPicker(option.value, value, providerModels);
            if (!resolvedModel) return;
            props.onProviderModelChange(option.value, resolvedModel);
            setIsMenuOpen(false);
          };

          // OpenCode / Kilo: two-tiered picker grouped by sub-provider
          if (option.value === "opencode" || option.value === "kilo") {
            const groups = groupModelsBySubProvider(providerModels);
            return (
              <MenuSub key={option.value}>
                <MenuSubTrigger disabled={isDisabledByProviderLock}>
                  <OptionIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground/85"
                  />
                  {option.label}
                </MenuSubTrigger>
                <MenuSubPopup className="[--available-height:min(24rem,70vh)]">
                  {groups.length === 0 ? (
                    <MenuItem disabled>
                      <span className="text-muted-foreground/60 text-xs">No models discovered</span>
                    </MenuItem>
                  ) : (
                    groups.map((group) => (
                      <MenuSub key={group.subProvider}>
                        <MenuSubTrigger>{group.subProvider}</MenuSubTrigger>
                        <MenuSubPopup className="[--available-height:min(24rem,70vh)]">
                          <MenuGroup>
                            <MenuRadioGroup
                              value={props.provider === option.value ? props.model : ""}
                              onValueChange={onModelSelect}
                            >
                              {group.models.map((modelOption) => (
                                <MenuRadioItem
                                  key={modelOption.slug}
                                  value={modelOption.slug}
                                  onClick={() => setIsMenuOpen(false)}
                                >
                                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                    <span className="truncate">{modelOption.name}</span>
                                    {modelOption.pricingTier ? (
                                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                                        {formatPricingTier(modelOption.pricingTier)}
                                      </span>
                                    ) : null}
                                  </span>
                                </MenuRadioItem>
                              ))}
                            </MenuRadioGroup>
                          </MenuGroup>
                        </MenuSubPopup>
                      </MenuSub>
                    ))
                  )}
                </MenuSubPopup>
              </MenuSub>
            );
          }

          return (
            <MenuSub key={option.value}>
              <MenuSubTrigger disabled={isDisabledByProviderLock}>
                <OptionIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground/85"
                />
                {option.label}
              </MenuSubTrigger>
              <MenuSubPopup className="[--available-height:min(24rem,70vh)]">
                <MenuGroup>
                  <MenuRadioGroup
                    value={props.provider === option.value ? props.model : ""}
                    onValueChange={onModelSelect}
                  >
                    {providerModels.map((modelOption) => (
                      <MenuRadioItem
                        key={`${option.value}:${modelOption.slug}`}
                        value={modelOption.slug}
                        onClick={() => setIsMenuOpen(false)}
                      >
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                          <span className="truncate">{modelOption.name}</span>
                          {modelOption.pricingTier ? (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                              {formatPricingTier(modelOption.pricingTier)}
                            </span>
                          ) : null}
                        </span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </MenuSubPopup>
            </MenuSub>
          );
        })}
        {UNAVAILABLE_PROVIDER_OPTIONS.length > 0 && <MenuDivider />}
        {UNAVAILABLE_PROVIDER_OPTIONS.map((option) => {
          const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
          return (
            <MenuItem key={option.value} disabled>
              <OptionIcon
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 opacity-80",
                  option.value === "claudeCode" ? "" : "text-muted-foreground/85",
                )}
              />
              <span>{option.label}</span>
              <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                Coming soon
              </span>
            </MenuItem>
          );
        })}
        {UNAVAILABLE_PROVIDER_OPTIONS.length === 0 && <MenuDivider />}
        {COMING_SOON_PROVIDER_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          return (
            <MenuItem key={option.id} disabled>
              <OptionIcon aria-hidden="true" className="size-4 shrink-0 opacity-80" />
              <span>{option.label}</span>
              <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                Coming soon
              </span>
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
});
