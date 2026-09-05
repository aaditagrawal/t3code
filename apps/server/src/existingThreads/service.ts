import * as NodeOS from "node:os";
import * as Path from "effect/Path";
import * as DateTime from "effect/DateTime";
import {
  ClaudeSettings,
  CodexSettings,
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  ExistingThreadError,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  type ExistingThreadImportInput,
  type ExistingThreadListInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerSettingsService } from "../serverSettings.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";
import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { resolveClaudeConfigDir } from "../provider/Drivers/ClaudeHome.ts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";
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
const importId = (sourceId: string) => ThreadId.make(`imported-${sourceId}`);

export const makeExistingThreads = Effect.gen(function* () {
  const path = yield* Path.Path;
  const settings = yield* ServerSettingsService;
  const registry = yield* ProviderRegistry;
  const directory = yield* ProviderSessionDirectory;
  const engine = yield* OrchestrationEngineService;
  const projection = yield* ProjectionSnapshotQuery;
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
      const layout = yield* resolveCodexHomeLayout(config);
      providerHome = layout.effectiveHomePath ?? env.CODEX_HOME ?? layout.sharedHomePath;
    } else {
      const config = yield* decodeClaudeSettings(instance.config ?? {});
      providerHome =
        !config.homePath.trim() && env.CLAUDE_CONFIG_DIR
          ? env.CLAUDE_CONFIG_DIR
          : yield* resolveClaudeConfigDir(config);
    }
    return {
      provider,
      instanceId: input.instanceId,
      providerHome,
      officialHome: path.join(NodeOS.homedir(), ".t3"),
    } satisfies SourceInput;
  });
  const discover = Effect.fn("existingThreads.discover")(function* (
    input: ExistingThreadListInput,
  ) {
    const source = yield* resolveSource(input);
    return yield* Effect.tryPromise({ try: () => discoverThreads(source), catch: failure });
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
    const bindings = yield* directory.listBindings();
    const result = new Map<string, ThreadId>();
    for (const binding of bindings) {
      if (!binding.providerInstanceId || !related.has(binding.providerInstanceId)) continue;
      const cursor = record(binding.resumeCursor);
      const id =
        binding.provider === "codex"
          ? string(cursor.threadId)
          : string(cursor.resume) || string(cursor.sessionId);
      if (id) result.set(id, binding.threadId);
    }
    return result;
  });
  const list = Effect.fn("existingThreads.list")(function* (input: ExistingThreadListInput) {
    const result = yield* discover(input);
    const snapshots = yield* Effect.all([
      projection.getShellSnapshot(),
      projection.getArchivedShellSnapshot(),
    ]);
    const ids = new Set(snapshots.flatMap((snapshot) => snapshot.threads.map((t) => t.id)));
    const existingSessions = yield* existingSessionThreads(input);
    return {
      notices: result.notices,
      threads: result.threads.map((t) => ({
        ...t.summary,
        importedThreadId:
          [existingSessions.get(t.summary.sessionId), importId(t.summary.id)].find(
            (id) => id !== undefined && ids.has(id),
          ) ?? null,
      })),
    };
  }, Effect.mapError(failure));
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
        const threadId = importId(found.summary.id);
        const snapshot = yield* projection.getSnapshot();
        const mappedThreadId = (yield* existingSessionThreads(input)).get(found.summary.sessionId);
        const alreadyLinked = snapshot.threads.find((t) => t.id === mappedThreadId && !t.deletedAt);
        if (alreadyLinked) return { threadId: alreadyLinked.id };
        const existing = snapshot.threads.find((t) => t.id === threadId);
        if (existing && !existing.deletedAt) return { threadId };
        if (existing)
          return yield* new ExistingThreadError({
            detail: "This conversation was previously imported and deleted.",
          });
        if (found.summary.unavailableReason)
          return yield* new ExistingThreadError({ detail: found.summary.unavailableReason });
        const transcript = yield* Effect.tryPromise({
          try: () => readDiscoveredThread(found),
          catch: failure,
        });
        const now = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
        const project = snapshot.projects.find(
          (p) => !p.deletedAt && p.workspaceRoot === transcript.cwd,
        );
        const projectId =
          project?.id ?? ProjectId.make(`imported-project-${stableId(transcript.cwd)}`);
        if (!project)
          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.make(`import-project-${projectId}`),
            projectId,
            title: path.basename(transcript.cwd) || transcript.cwd,
            workspaceRoot: transcript.cwd,
            createdAt: now,
          });
        const modelSelection = {
          instanceId: input.instanceId,
          model:
            DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make(found.summary.provider)] ?? "default",
        };
        // Persist the resumable binding before publishing the new thread. A retry uses
        // the same IDs; clients can never send a turn to an unbound imported thread.
        yield* directory.upsert({
          threadId,
          provider: ProviderDriverKind.make(found.summary.provider),
          providerInstanceId: input.instanceId,
          status: "stopped",
          runtimeMode: "approval-required",
          resumeCursor:
            found.summary.provider === "codex"
              ? { threadId: transcript.sessionId, requireExisting: true }
              : { resume: transcript.sessionId },
          runtimePayload: { cwd: transcript.cwd, modelSelection },
        });
        yield* engine.dispatch({
          type: "thread.import",
          commandId: CommandId.make(`import-thread-${input.id}`),
          threadId,
          projectId,
          title: found.summary.title || "Imported conversation",
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          session: {
            threadId,
            status: "stopped",
            providerName: found.summary.provider,
            providerInstanceId: input.instanceId,
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
          messages: transcript.messages.map((m, index) => ({
            ...m,
            createdAt: Number.isFinite(Date.parse(m.createdAt)) ? m.createdAt : now,
            messageId: MessageId.make(`imported-message-${stableId(input.id, String(index))}`),
          })),
        });
        return { threadId };
      }).pipe(Effect.mapError(failure)),
    );
  return { list, importThread };
});
