// Re-export model selection utilities from customModels where the fork
// maintains the canonical 8-provider implementations.  Upstream introduced
// this module with only codex + claudeAgent; the fork keeps the full set in
// customModels.ts to avoid duplication.
export {
  type AppModelOption,
  type ProviderCustomModelConfig,
  MAX_CUSTOM_MODEL_LENGTH,
  MODEL_PROVIDER_SETTINGS,
  normalizeCustomModelSlugs,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  patchCustomModels,
  getCustomModelsByProvider,
  getAppModelOptions,
  resolveAppModelSelection,
  getCustomModelOptionsByProvider,
} from "./customModels";
