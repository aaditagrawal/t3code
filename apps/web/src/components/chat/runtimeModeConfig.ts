import { ProviderDriverKind } from "@t3tools/contracts";
import { getRuntimeModeConfig, getRuntimeModeOptions } from "./runtimeModePresentation";

const defaultProvider = ProviderDriverKind.make("codex");
export const runtimeModeConfig = getRuntimeModeConfig(defaultProvider);
export const runtimeModeOptions = getRuntimeModeOptions(defaultProvider);
