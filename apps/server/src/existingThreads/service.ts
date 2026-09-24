// @effect-diagnostics nodeBuiltinImport:off - Discovery reads the user's real home directory.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { LEGACY_HOME_DIR_NAME } from "@t3tools/shared/branding";
import {
  CommandId,
  ClaudeSettings,
  CodexSettings,
  ExistingThreadError,
  ProjectId,
  ThreadId,
  type ExistingThreadImportInput,
  type ExistingThreadListInput,
  type ExistingThread,
  type Project,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Path from "effect/Path";
import { ServerSettingsService } from "../serverSettings.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { resolveClaudeConfigDir } from "../provider/Drivers/ClaudeHome.ts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";
import { ProviderSessionRuntimeRepository } from "../persistence/ProviderSessionRuntime.ts";
import { AgentSessionImporter } from "../project/AgentSessionImporter.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { discoverThreads, readDiscoveredThread, type SourceInput } from "./sources.ts";
import { record, string, stableId } from "./transcripts.ts";

const isExistingThreadError = Schema.is(ExistingThreadError);
const decodeCodexSettings = Schema.decodeUnknownEffect(CodexSettings);
const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);
const failure = (cause: unknown) =>
  isExistingThreadError(cause)
    ? cause
    : new ExistingThreadError({
        detail:
          cause instanceof Error ? cause.message : "Existing conversations could not be loaded.",
      });
const importId = (thread: Pick<ExistingThread, "instanceId" | "sessionId">) =>
  ThreadId.make(`import:${thread.instanceId}:${thread.sessionId}`);

export const makeExistingThreads = Effect.gen(function* () {
  const path = yield* Path.Path;
  const settings = yield* ServerSettingsService;
  const registry = yield* ProviderRegistry;
  const threads = yield* ThreadManagementService;
  const projects = yield* ProjectService;
  const runtimes = yield* ProviderSessionRuntimeRepository;
  const importer = yield* AgentSessionImporter;
  const imports = yield* Semaphore.make(1);

  const resolveSource = Effect.fn("existingThreads.resolveSource")(function* (
    input: ExistingThreadListInput,
  ) {
    const info = (yield* registry.getProviders).find((p) => p.instanceId === input.instanceId);
    if (!info) return yield* new ExistingThreadError({ detail: "Provider instance not found." });
    if (!info.enabled)
      return yield* new ExistingThreadError({
        detail: "Enable this provider instance before importing conversations.",
      });
    const kind = String(info.driver);
    const provider = kind === "codex" ? "codex" : kind === "claudeAgent" ? "claudeAgent" : null;
    if (provider !== "codex" && provider !== "claudeAgent")
      return yield* new ExistingThreadError({
        detail: "Existing conversation discovery is currently available for Codex and Claude.",
      });
    const configs = deriveProviderInstanceConfigMap(yield* settings.getSettings);
    const instance = configs[input.instanceId];
    if (!instance)
      return yield* new ExistingThreadError({
        detail: "This provider instance is no longer configured.",
      });
    const env = mergeProviderInstanceEnvironment(instance.environment);
    let providerHome: string;
    if (provider === "codex") {
      const config = yield* decodeCodexSettings(instance.config ?? {});
      const layout = yield* resolveCodexHomeLayout(config).pipe(
        Effect.provideService(Path.Path, path),
      );
      providerHome = layout.effectiveHomePath ?? env.CODEX_HOME ?? layout.sharedHomePath;
    } else {
      const config = yield* decodeClaudeSettings(instance.config ?? {});
      providerHome =
        !config.homePath.trim() && env.CLAUDE_CONFIG_DIR
          ? env.CLAUDE_CONFIG_DIR
          : yield* resolveClaudeConfigDir(config).pipe(Effect.provideService(Path.Path, path));
    }
    return {
      provider,
      instanceId: input.instanceId,
      providerHome,
      officialHome: NodePath.join(NodeOS.homedir(), LEGACY_HOME_DIR_NAME),
    } satisfies SourceInput;
  });
  const discover = Effect.fn("existingThreads.discover")(function* (
    input: ExistingThreadListInput,
  ) {
    const source = yield* resolveSource(input);
    return yield* Effect.tryPromise({ try: () => discoverThreads(source), catch: failure });
  });
  const visibleThreadIds = Effect.fn("existingThreads.visibleThreadIds")(function* () {
    const snapshots = yield* Effect.all([
      threads.getShellSnapshot(),
      threads.getShellSnapshot({ location: "archive" }),
    ]);
    return new Set(
      snapshots.flatMap((snapshot) =>
        snapshot.threads.filter((thread) => thread.deletedAt === null).map((thread) => thread.id),
      ),
    );
  });
  const existingSessionThreads = Effect.fn("existingThreads.existingSessionThreads")(function* (
    input: ExistingThreadListInput,
  ) {
    const providers = yield* registry.getProviders;
    const selected = providers.find((p) => p.instanceId === input.instanceId);
    const related = new Set(
      providers
        .filter(
          (p) =>
            p.instanceId === input.instanceId ||
            (selected?.continuation?.groupKey !== undefined &&
              p.continuation?.groupKey === selected.continuation.groupKey),
        )
        .map((p) => p.instanceId),
    );
    const bindings = yield* runtimes.list();
    const result = new Map<string, ThreadId>();
    for (const binding of bindings) {
      if (!binding.providerInstanceId || !related.has(binding.providerInstanceId)) continue;
      const cursor = record(binding.resumeCursor);
      const id =
        binding.providerName === "codex"
          ? string(cursor.threadId)
          : string(cursor.resume) || string(cursor.sessionId);
      if (id) result.set(id, binding.threadId);
    }
    return result;
  });
  const list = Effect.fn("existingThreads.list")(function* (input: ExistingThreadListInput) {
    const result = yield* discover(input);
    const ids = yield* visibleThreadIds();
    const existingSessions = yield* existingSessionThreads(input);
    return {
      notices: result.notices,
      threads: result.threads.map((t) => ({
        ...t.summary,
        importedThreadId:
          [existingSessions.get(t.summary.sessionId), importId(t.summary)].find(
            (id) => id !== undefined && ids.has(id),
          ) ?? null,
      })),
    };
  }, Effect.mapError(failure));
  const deletedThreadIds = Effect.fn("existingThreads.deletedThreadIds")(function* () {
    const snapshots = yield* Effect.all([
      threads.getShellSnapshot(),
      threads.getShellSnapshot({ location: "archive" }),
    ]);
    return new Set(
      snapshots.flatMap((snapshot) =>
        snapshot.threads.filter((thread) => thread.deletedAt !== null).map((thread) => thread.id),
      ),
    );
  });
  const importThread = (input: ExistingThreadImportInput) =>
    imports.withPermits(1)(
      Effect.gen(function* () {
        if (!input.sessionReleased)
          return yield* new ExistingThreadError({
            detail: "Stop this session in the other app before continuing here.",
          });
        const result = yield* discover(input);
        const found = result.threads.find((t) => t.summary.id === input.id);
        if (!found)
          return yield* new ExistingThreadError({
            detail: "This conversation is no longer available. Refresh and try again.",
          });
        const threadId = importId(found.summary);
        const ids = yield* visibleThreadIds();
        const mappedThreadId = (yield* existingSessionThreads(input)).get(found.summary.sessionId);
        if (mappedThreadId !== undefined && ids.has(mappedThreadId)) {
          return { threadId: mappedThreadId };
        }
        if (ids.has(threadId)) return { threadId };
        if ((yield* deletedThreadIds()).has(threadId))
          return yield* new ExistingThreadError({
            detail: "This conversation was previously imported and deleted.",
          });
        if (found.summary.unavailableReason)
          return yield* new ExistingThreadError({ detail: found.summary.unavailableReason });
        const transcript = yield* Effect.tryPromise({
          try: () => readDiscoveredThread(found),
          catch: failure,
        });
        const existingProject = yield* projects.getByWorkspaceRoot(transcript.cwd);
        const project: Project = Option.isSome(existingProject)
          ? existingProject.value
          : yield* projects.create({
              commandId: CommandId.make(`import-project-${stableId(transcript.cwd)}`),
              projectId: ProjectId.make(`imported-project-${stableId(transcript.cwd)}`),
              title: NodePath.basename(transcript.cwd) || transcript.cwd,
              workspaceRoot: transcript.cwd,
            });
        yield* importer.importAgentThread({
          projectId: project.id,
          workspaceRoot: project.workspaceRoot,
          source: transcript.source,
          thread: {
            ...transcript.providerThread,
            providerInstanceId: input.instanceId,
            title: found.summary.title || transcript.title,
          },
        });
        return { threadId };
      }).pipe(Effect.mapError(failure)),
    );
  return { list, importThread };
});

export class ExistingThreads extends Context.Service<
  ExistingThreads,
  Effect.Success<typeof makeExistingThreads>
>()("t3/existingThreads/service/ExistingThreads") {}

export const layer = Layer.effect(ExistingThreads, makeExistingThreads);
