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
import { Cause, Effect, Layer, PubSub, Ref, Stream } from "effect";

import { fetchAmpUsage } from "../../ampServerManager";
import { fetchGeminiCliUsage } from "../../geminiCliServerManager";
import { fetchKiloModels } from "../../kiloServerManager";
import { fetchOpenCodeModels } from "../../opencodeServerManager";
import { ServerSettingsService } from "../../serverSettings";
import { fetchCopilotModels } from "./CopilotAdapter";
import { resolveBundledCopilotCliPath } from "./copilotCliPath";
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
  readonly configDir?: string;
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
      auth: { status: "unknown" },
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
      auth: { status: "unknown" },
      message: input.message,
    },
  });
}

function buildReadySnapshot(input: {
  provider: ProviderKind;
  settings: ProviderSettingsShape;
  models: ReadonlyArray<ServerProviderModel>;
  version?: string | null;
  auth?: ProviderProbeResult["auth"];
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
      auth: input.auth ?? { status: "unknown" },
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

const runBinaryBackedSnapshot = (
  provider: ProviderWithBinary,
  settings: ProviderSettingsShape,
  options?: {
    readonly fetchDiscoveredModels?:
      | ((binaryPath: string | undefined) => Promise<ReadonlyArray<{ slug: string; name: string }>>)
      | undefined;
    readonly resolveProbeBinaryPath?:
      | ((binaryPath: string | undefined) => string | undefined)
      | undefined;
  },
) =>
  Effect.gen(function* () {
    const fallbackModels = providerModelsFromSettings(
      BUILT_IN_MODELS_BY_PROVIDER[provider],
      provider,
      settings.customModels,
    );

    if (!settings.enabled) {
      return buildDisabledSnapshot(provider, settings, fallbackModels);
    }

    const configuredBinaryPath = trimToUndefined(settings.binaryPath);
    const binaryPath =
      options?.resolveProbeBinaryPath?.(configuredBinaryPath) ?? configuredBinaryPath;
    const discoveredModels = options?.fetchDiscoveredModels
      ? yield* Effect.tryPromise({
          try: () => options.fetchDiscoveredModels?.(binaryPath) ?? Promise.resolve([]),
          catch: wrapProbeError,
        })
      : [];

    const baseModels =
      discoveredModels.length > 0
        ? mergeBuiltInAndDiscoveredModels(provider, discoveredModels)
        : BUILT_IN_MODELS_BY_PROVIDER[provider];
    const models = providerModelsFromSettings(baseModels, provider, settings.customModels);

    if (!binaryPath && !options?.fetchDiscoveredModels) {
      return buildWarningSnapshot({
        provider,
        settings,
        models,
        installed: true,
        message: `${PROVIDER_LABELS[provider]} runtime is enabled, but installation status is not probed yet.`,
      });
    }

    const versionProbe = binaryPath
      ? yield* Effect.tryPromise({
          try: () => runVersionCommand(binaryPath),
          catch: wrapProbeError,
        }).pipe(
          Effect.map((result) => parseGenericCliVersion(`${result.stdout}\n${result.stderr}`)),
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

const loadProviderSnapshot = (
  deps: ProviderRegistryDeps,
  provider: ProviderKind,
  options?: { readonly forceRefreshManagedProviders?: boolean },
) =>
  Effect.gen(function* () {
    const settings = yield* deps.getSettings;

    switch (provider) {
      case "codex":
        return yield* options?.forceRefreshManagedProviders
          ? deps.codexProvider.refresh
          : deps.codexProvider.getSnapshot;
      case "claudeAgent":
        return yield* options?.forceRefreshManagedProviders
          ? deps.claudeProvider.refresh
          : deps.claudeProvider.getSnapshot;
      case "copilot":
        return yield* runBinaryBackedSnapshot("copilot", settings.providers.copilot, {
          fetchDiscoveredModels: (binaryPath) =>
            fetchCopilotModels(binaryPath).then((models) =>
              (models ?? []).map((model) => ({ slug: model.slug, name: model.name })),
            ),
          resolveProbeBinaryPath: (binaryPath) =>
            binaryPath ?? resolveBundledCopilotCliPath() ?? "copilot",
        });
      case "cursor":
        return yield* runBinaryBackedSnapshot("cursor", settings.providers.cursor, {
          fetchDiscoveredModels: (binaryPath) =>
            fetchCursorModels(binaryPath ? { binaryPath } : {}).then((models) => [...models]),
          resolveProbeBinaryPath: (binaryPath) => binaryPath ?? "agent",
        });
      case "opencode":
        return yield* runBinaryBackedSnapshot("opencode", settings.providers.opencode, {
          fetchDiscoveredModels: (binaryPath) =>
            fetchOpenCodeModels(binaryPath ? { binaryPath } : {}).then((models) => [...models]),
          resolveProbeBinaryPath: (binaryPath) => binaryPath ?? "opencode",
        });
      case "kilo":
        return yield* runBinaryBackedSnapshot("kilo", settings.providers.kilo, {
          fetchDiscoveredModels: (binaryPath) =>
            fetchKiloModels(binaryPath ? { binaryPath } : {}).then((models) => [...models]),
          resolveProbeBinaryPath: (binaryPath) => binaryPath ?? "kilo",
        });
      case "geminiCli":
        if (settings.providers.geminiCli.enabled) {
          void fetchGeminiCliUsage();
        }
        return yield* runBinaryBackedSnapshot("geminiCli", settings.providers.geminiCli);
      case "amp":
        if (settings.providers.amp.enabled) {
          void fetchAmpUsage();
        }
        return yield* runBinaryBackedSnapshot("amp", settings.providers.amp);
    }
  });

const loadProviders = (
  deps: ProviderRegistryDeps,
  providers: ReadonlyArray<ProviderKind>,
  options?: { readonly forceRefreshManagedProviders?: boolean },
) =>
  Effect.forEach(providers, (provider) => loadProviderSnapshot(deps, provider, options), {
    concurrency: "unbounded",
  });

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => {
  if (previousProviders.length !== nextProviders.length) {
    return true;
  }

  return previousProviders.some((previousProvider, index) => {
    const nextProvider = nextProviders[index];
    if (!nextProvider) {
      return true;
    }

    return (
      JSON.stringify(toComparableProviderSnapshot(previousProvider)) !==
      JSON.stringify(toComparableProviderSnapshot(nextProvider))
    );
  });
};

const toComparableProviderSnapshot = (provider: ServerProvider) => ({
  provider: provider.provider,
  enabled: provider.enabled,
  installed: provider.installed,
  version: provider.version,
  status: provider.status,
  auth: provider.auth,
  message: provider.message ?? null,
  models: provider.models,
  quotaSnapshots: provider.quotaSnapshots ?? null,
});

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
    const mergeProvidersAtomically = (
      merge: (
        currentProviders: ReadonlyArray<ServerProvider>,
        currentByProvider: ReadonlyMap<ProviderKind, ServerProvider>,
      ) => ReadonlyArray<ServerProvider>,
    ) =>
      Ref.modify(providersRef, (currentProviders) => {
        const currentByProvider = new Map(
          currentProviders.map((provider) => [provider.provider, provider] as const),
        );
        const mergedProviders = merge(currentProviders, currentByProvider);

        return [
          {
            previousProviders: currentProviders,
            mergedProviders,
          },
          mergedProviders,
        ] as const;
      });

    const applyManagedProviderSnapshot = (snapshot: ServerProvider) =>
      Effect.gen(function* () {
        const { previousProviders, mergedProviders } = yield* mergeProvidersAtomically(
          (_, currentByProvider) =>
            ALL_PROVIDERS.map(
              (provider) =>
                (provider === snapshot.provider ? snapshot : currentByProvider.get(provider)) ??
                undefined,
            ).filter((provider): provider is ServerProvider => provider !== undefined),
        );

        if (haveProvidersChanged(previousProviders, mergedProviders)) {
          yield* PubSub.publish(changesPubSub, mergedProviders);
        }
      });

    const syncProviders = (
      providers: ReadonlyArray<ProviderKind> = ALL_PROVIDERS,
      options?: { readonly publish?: boolean },
    ) =>
      Effect.gen(function* () {
        const nextSnapshots = yield* loadProviders(deps, providers, {
          forceRefreshManagedProviders: true,
        });
        const nextSnapshotsByProvider = new Map(
          nextSnapshots.map((provider) => [provider.provider, provider] as const),
        );
        const { previousProviders, mergedProviders } = yield* mergeProvidersAtomically(
          (_, currentByProvider) =>
            ALL_PROVIDERS.map(
              (provider) =>
                nextSnapshotsByProvider.get(provider) ?? currentByProvider.get(provider),
            ).filter((provider): provider is ServerProvider => provider !== undefined),
        );

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
    yield* Stream.runForEach(codexProvider.streamChanges, applyManagedProviderSnapshot).pipe(
      Effect.forkScoped,
    );
    yield* Stream.runForEach(claudeProvider.streamChanges, applyManagedProviderSnapshot).pipe(
      Effect.forkScoped,
    );
    yield* Effect.forever(
      Effect.sleep("60 seconds").pipe(Effect.flatMap(() => syncProviders())),
    ).pipe(Effect.forkScoped);

    return {
      getProviders: Ref.get(providersRef).pipe(
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
