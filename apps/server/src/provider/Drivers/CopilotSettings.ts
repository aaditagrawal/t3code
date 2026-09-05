import { CustomModelSetting } from "@t3tools/contracts";
/**
 * CopilotSettings — local typed config schema for the GitHub Copilot driver.
 *
 * This module owns the driver-side schema temporarily; the canonical home
 * is `packages/contracts/src/settings.ts`, but until that lands the driver
 * needs a typed `Schema.Codec<CopilotSettings, unknown>` for its
 * `configSchema` SPI slot. The shape mirrors what we expect to publish in
 * contracts (see `INTEGRATION_copilot.md`).
 *
 * Fields:
 *   - `enabled`        — Master switch; default `true` (matches the legacy
 *                         GenericProviderSettings entry).
 *   - `binaryPath`     — Path to the Copilot CLI binary; empty defaults to
 *                         the bundled CLI (see `copilotCliPath.ts`).
 *   - `configDir`      — Optional override for the Copilot config dir.
 *   - `customModels`   — User-added model slugs, names, and capability descriptors.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const CopilotSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: Schema.Trim.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  configDir: Schema.Trim.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  customModels: Schema.Array(CustomModelSetting).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type CopilotSettings = typeof CopilotSettings.Type;
