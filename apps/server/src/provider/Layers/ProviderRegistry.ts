/**
 * ProviderRegistryLive - Aggregates server-side provider snapshots.
 *
 * The fork supports more runtime adapters than upstream's original provider
 * snapshot layer. This registry probes every supported provider so
 * `server.getConfig` and `server.providersUpdated` stay complete.
 *
 * @module ProviderRegistryLive
 */
import { execFile } from "node:child_process";

import {
  MODEL_OPTIONS_BY_PROVIDER,
  type ProviderKind,
  type ServerSettings as ContractServerSettings,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { Cause, Effect, Equal, Layer, PubSub, Ref, Stream } from "effect";

import { fetchAmpUsage } from "../../ampServerManager";
import { fetchGeminiCliUsage } from "../../geminiCliServerManager";
import { fetchKiloModels } from "../../kiloServerManager";
import { fetchOpenCodeModels } from "../../opencodeServerManager";
import { ServerSettingsService } from "../../serverSettings";
import { fetchCopilotModels } from "./CopilotAdapter";
import { ClaudeProviderLive } from "./ClaudeProvider";
import { CodexProviderLive } from "./CodexProvider";
import { fetchCursorModels } from "./CursorAdapter";
import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  type CommandResult,
  type ProviderProbeResult,
} from "../providerSnapshot";
import type { ClaudeProviderShape } from "../Services/ClaudeProvider";
import { ClaudeProvider } from "../Services/ClaudeProvider";
import type { CodexProviderShape } from "../Services/CodexProvider";
import { CodexProvider } from "../Services/CodexProvider";
import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry";

const ALL_PROVIDERS = [
  "codex",
  "copilot",
  "claudeAgent",
  "cursor",
  "opencode",
  "geminiCli",
  "amp",
  "kilo",
] as const satisfies ReadonlyArray<ProviderKind>;

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  codex: "Codex",
  copilot: "Copilot",
  claudeAgent: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
  geminiCli: "Gemini CLI",
  amp: "Amp",
  kilo: "Kilo",
};

const toBuiltInServerProviderModel = (
  model: (typeof MODEL_OPTIONS_BY_PROVIDER)[ProviderKind][number],
): ServerProviderModel => ({
  slug: model.slug,
  name: model.name,
  isCustom: false,
  capabilities: "capabilities" in model ? (model.capabilities ?? null) : null,
});

const BUILT_IN_MODELS_BY_PROVIDER = ALL_PROVIDERS.reduce(
  (acc, provider) => {
    acc[provider] = MODEL_OPTIONS_BY_PROVIDER[provider].map(toBuiltInServerProviderModel);
    return acc;
  },
  {} as Record<ProviderKind, ReadonlyArray<ServerProviderModel>>,
);

type ProviderWithBinary = Exclude<ProviderKind, "codex" | "claudeAgent">;
type ProviderSettingsShape = {
  readonly enabled: boolean;
  readonly customModels: ReadonlyArray<string>;
  readonly binaryPath?: string;
};
class ProviderSnapshotProbeError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ProviderSnapshotProbeError";
    this.cause = cause;
  }
}
type ProviderRegistryDeps = {
  readonly getSettings: Effect.Effect<ContractServerSettings, never>;
  readonly codexProvider: CodexProviderShape;
  readonly claudeProvider: ClaudeProviderShape;
};

const trimToUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const wrapProbeError = (cause: unknown) => new ProviderSnapshotProbeError(cause);
const unwrapProbeError = (error: unknown) =>
  error instanceof ProviderSnapshotProbeError ? error.cause : error;

const runVersionCommand = async (binaryPath: string): Promise<CommandResult> => {
  const tryArgs = async (args: ReadonlyArray<string>) =>
    new Promise<CommandResult>((resolve, reject) => {
      execFile(
        binaryPath,
        [...args],
        {
          env: process.env,
          timeout: 4_000,
          shell: process.platform === "win32",
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr, code: 0 });
        },
      );
    });

  return tryArgs(["--version"]).catch(() => tryArgs(["version"]));
};

function mergeBuiltInAndDiscoveredModels(
  provider: ProviderKind,
  discoveredModels: ReadonlyArray<{ slug: string; name: string }>,
): ReadonlyArray<ServerProviderModel> {
  const staticModels = BUILT_IN_MODELS_BY_PROVIDER[provider];
  const staticBySlug = new Map(staticModels.map((model) => [model.slug, model]));
  const merged: ServerProviderModel[] = [];
  const seen = new Set<string>();

  for (const model of discoveredModels) {
    const existing = staticBySlug.get(model.slug);
    merged.push({
      slug: model.slug,
      name: model.name,
      isCustom: false,
      capabilities: existing?.capabilities ?? null,
    });
    seen.add(model.slug);
  }

  for (const model of staticModels) {
    if (seen.has(model.slug)) {
      continue;
    }
    merged.push(model);
  }

  return merged;
}

function buildDisabledSnapshot(
  provider: ProviderKind,
  settings: ProviderSettingsShape,
  models: ReadonlyArray<ServerProviderModel>,
): ServerProvider {
  return buildServerProvider({
    provider,
    enabled: settings.enabled,
    checkedAt: new Date().toISOString(),
    models,
    probe: {
      installed: true,
      version: null,
      status: "ready",
      authStatus: "unknown",
    },
  });
}

function buildWarningSnapshot(input: {
  provider: ProviderKind;
  settings: ProviderSettingsShape;
  models: ReadonlyArray<ServerProviderModel>;
  installed: boolean;
  version?: string | null;
  message: string;
}): ServerProvider {
  return buildServerProvider({
    provider: input.provider,
    enabled: input.settings.enabled,
    checkedAt: new Date().toISOString(),
    models: input.models,
    probe: {
      installed: input.installed,
      version: input.version ?? null,
      status: "warning",
      authStatus: "unknown",
      message: input.message,
    },
  });
}

function buildReadySnapshot(input: {
  provider: ProviderKind;
  settings: ProviderSettingsShape;
  models: ReadonlyArray<ServerProviderModel>;
  version?: string | null;
  authStatus?: ProviderProbeResult["authStatus"];
  message?: string;
}): ServerProvider {
  return buildServerProvider({
    provider: input.provider,
    enabled: input.settings.enabled,
    checkedAt: new Date().toISOString(),
    models: input.models,
    probe: {
      installed: true,
      version: input.version ?? null,
      status: "ready",
      authStatus: input.authStatus ?? "unknown",
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

const runBinaryBackedSnapshot = (
  provider: ProviderWithBinary,
  settings: ProviderSettingsShape,
  fetchDiscoveredModels?:
    | ((binaryPath: string | undefined) => Promise<ReadonlyArray<{ slug: string; name: string }>>)
    | undefined,
) =>
  Effect.gen(function* () {
    const binaryPath = trimToUndefined(settings.binaryPath);
    const discoveredModels =
      binaryPath && fetchDiscoveredModels
        ? yield* Effect.tryPromise({
            try: () => fetchDiscoveredModels(binaryPath),
            catch: wrapProbeError,
          }).pipe(
            Effect.catchCause((cause) => {
              const error = unwrapProbeError(Cause.squash(cause));
              if (isCommandMissingCause(error)) {
                return Effect.succeed<ReadonlyArray<{ slug: string; name: string }>>([]);
              }
              return Effect.failCause(cause);
            }),
          )
        : [];

    const baseModels =
      discoveredModels.length > 0
        ? mergeBuiltInAndDiscoveredModels(provider, discoveredModels)
        : BUILT_IN_MODELS_BY_PROVIDER[provider];
    const models = providerModelsFromSettings(baseModels, provider, settings.customModels);

    if (!settings.enabled) {
      return buildDisabledSnapshot(provider, settings, models);
    }

    if (!binaryPath && !fetchDiscoveredModels) {
      return buildWarningSnapshot({
        provider,
        settings,
        models,
        installed: true,
        message: `${PROVIDER_LABELS[provider]} runtime is enabled, but installation status is not probed yet.`,
      });
    }

    if (!binaryPath && fetchDiscoveredModels) {
      return buildWarningSnapshot({
        provider,
        settings,
        models,
        installed: true,
        message: `${PROVIDER_LABELS[provider]} is enabled, but no binary path is configured for probing.`,
      });
    }

    const versionProbe = binaryPath
      ? yield* Effect.tryPromise({
          try: () => runVersionCommand(binaryPath),
          catch: wrapProbeError,
        }).pipe(
          Effect.map((result) => parseGenericCliVersion(`${result.stdout}\n${result.stderr}`)),
          Effect.catchCause((cause) =>
            isCommandMissingCause(unwrapProbeError(Cause.squash(cause)))
              ? Effect.succeed<string | null>(null)
              : Effect.failCause(cause),
          ),
        )
      : null;

    return buildReadySnapshot({
      provider,
      settings,
      models,
      version: versionProbe,
    });
  }).pipe(
    Effect.catchCause((cause) => {
      const error = unwrapProbeError(Cause.squash(cause));
      const models = providerModelsFromSettings(
        BUILT_IN_MODELS_BY_PROVIDER[provider],
        provider,
        settings.customModels,
      );
      if (isCommandMissingCause(error)) {
        return Effect.succeed(
          buildWarningSnapshot({
            provider,
            settings,
            models,
            installed: false,
            message: `${PROVIDER_LABELS[provider]} CLI not found on PATH.`,
          }),
        );
      }
      return Effect.succeed(
        buildWarningSnapshot({
          provider,
          settings,
          models,
          installed: true,
          message:
            error instanceof Error
              ? error.message
              : `Could not probe ${PROVIDER_LABELS[provider]}.`,
        }),
      );
    }),
  );

const loadProviderSnapshot = (deps: ProviderRegistryDeps, provider: ProviderKind) =>
  Effect.gen(function* () {
    const settings = yield* deps.getSettings;

    switch (provider) {
      case "codex":
        return yield* deps.codexProvider.getSnapshot;
      case "claudeAgent":
        return yield* deps.claudeProvider.getSnapshot;
      case "copilot":
        return yield* runBinaryBackedSnapshot("copilot", settings.providers.copilot, (binaryPath) =>
          fetchCopilotModels(binaryPath).then((models) =>
            (models ?? []).map((model) => ({ slug: model.slug, name: model.name })),
          ),
        );
      case "cursor":
        return yield* runBinaryBackedSnapshot("cursor", settings.providers.cursor, (binaryPath) =>
          fetchCursorModels(binaryPath ? { binaryPath } : {}).then((models) => [...models]),
        );
      case "opencode":
        return yield* runBinaryBackedSnapshot(
          "opencode",
          settings.providers.opencode,
          (binaryPath) =>
            fetchOpenCodeModels(binaryPath ? { binaryPath } : {}).then((models) => [...models]),
        );
      case "kilo":
        return yield* runBinaryBackedSnapshot("kilo", settings.providers.kilo, (binaryPath) =>
          fetchKiloModels(binaryPath ? { binaryPath } : {}).then((models) => [...models]),
        );
      case "geminiCli":
        void fetchGeminiCliUsage();
        return yield* runBinaryBackedSnapshot("geminiCli", settings.providers.geminiCli);
      case "amp":
        void fetchAmpUsage();
        return yield* runBinaryBackedSnapshot("amp", settings.providers.amp);
    }
  });

const loadProviders = (deps: ProviderRegistryDeps, providers: ReadonlyArray<ProviderKind>) =>
  Effect.forEach(providers, (provider) => loadProviderSnapshot(deps, provider), {
    concurrency: "unbounded",
  });

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => !Equal.equals(previousProviders, nextProviders);

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const codexProvider = yield* CodexProvider;
    const claudeProvider = yield* ClaudeProvider;
    const deps: ProviderRegistryDeps = {
      getSettings: serverSettings.getSettings.pipe(Effect.orDie),
      codexProvider,
      claudeProvider,
    };
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
      PubSub.shutdown,
    );
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(
      yield* loadProviders(deps, ALL_PROVIDERS),
    );

    const syncProviders = (
      providers: ReadonlyArray<ProviderKind> = ALL_PROVIDERS,
      options?: { readonly publish?: boolean },
    ) =>
      Effect.gen(function* () {
        const previousProviders = yield* Ref.get(providersRef);
        const previousByProvider = new Map(
          previousProviders.map((provider) => [provider.provider, provider]),
        );
        const nextSnapshots = yield* loadProviders(deps, providers);
        const mergedProviders = ALL_PROVIDERS.map(
          (provider) =>
            nextSnapshots.find((snapshot) => snapshot.provider === provider) ??
            previousByProvider.get(provider),
        ).filter((provider): provider is ServerProvider => provider !== undefined);
        yield* Ref.set(providersRef, mergedProviders);

        if (
          options?.publish !== false &&
          haveProvidersChanged(previousProviders, mergedProviders)
        ) {
          yield* PubSub.publish(changesPubSub, mergedProviders);
        }

        return mergedProviders;
      });

    yield* Stream.runForEach(serverSettings.streamChanges, () => syncProviders()).pipe(
      Effect.forkScoped,
    );
    yield* Effect.forever(
      Effect.sleep("60 seconds").pipe(Effect.flatMap(() => syncProviders())),
    ).pipe(Effect.forkScoped);

    return {
      getProviders: syncProviders(ALL_PROVIDERS, { publish: false }).pipe(
        Effect.tapError(Effect.logError),
        Effect.orElseSucceed(() => []),
      ),
      refresh: (provider?: ProviderKind) =>
        syncProviders(provider ? [provider] : ALL_PROVIDERS).pipe(
          Effect.tapError(Effect.logError),
          Effect.orElseSucceed(() => []),
        ),
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderRegistryShape;
  }),
).pipe(Layer.provideMerge(CodexProviderLive), Layer.provideMerge(ClaudeProviderLive));
