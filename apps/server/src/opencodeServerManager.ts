import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  ApprovalRequestId,
  ThreadId,
  TurnId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
} from "@t3tools/contracts";
import type { ProviderThreadSnapshot } from "./provider/Services/ProviderAdapter.ts";

import {
  PROVIDER,
  type OpenCodeManagerEvents,
  type OpenCodeModelDiscoveryOptions,
  type OpenCodeProviderOptions,
  type OpenCodeProviderRuntimeEvent,
  type OpenCodeProviderSession,
  type OpenCodeSessionContext,
  type OpenCodeSessionStartInput,
  type OpenCodeSendTurnInput,
  type OpenCodeDiscoveredModel,
  type SharedServerState,
} from "./opencode/types.ts";
import {
  asRecord,
  asString,
  createTurnId,
  eventId,
  nowIso,
  parseOpencodeModel,
  parseProviderModels,
  readConfigProvidersResponse,
  readJsonData,
  readProviderListResponse,
  readResumeSessionId,
  stripTransientSessionFields,
  textPart,
  toPermissionReply,
} from "./opencode/utils.ts";
import { handleEvent } from "./opencode/eventHandlers.ts";
import { createClient, ensureServer } from "./opencode/serverLifecycle.ts";

export {
  type OpenCodeDiscoveredModel,
  type OpenCodeModelDiscoveryOptions,
} from "./opencode/types.ts";

export class OpenCodeServerManager extends EventEmitter<OpenCodeManagerEvents> {
  private readonly sessions = new Map<ThreadId, OpenCodeSessionContext>();
  private serverPromise: Promise<SharedServerState> | undefined;
  private server: SharedServerState | undefined;

  listSessions(): ReadonlyArray<ProviderSession> {
    return [...this.sessions.values()].map((entry) => entry.session as ProviderSession);
  }

  hasSession(threadId: ThreadId): boolean {
    return this.sessions.has(threadId);
  }

  async startSession(input: ProviderSessionStartInput): Promise<ProviderSession> {
    const openCodeInput = input as OpenCodeSessionStartInput;
    const existing = this.sessions.get(input.threadId);
    if (existing) {
      return existing.session as ProviderSession;
    }

    const directory = openCodeInput.cwd ?? process.cwd();
    const options = openCodeInput.providerOptions?.opencode;
    const workspace = options?.workspace;
    const sharedServer = await this.ensureServer(options);
    const client = await createClient({
      baseUrl: sharedServer.baseUrl,
      directory,
      responseStyle: "data",
      throwOnError: true,
      ...(sharedServer.authHeader
        ? {
            headers: {
              Authorization: sharedServer.authHeader,
            },
          }
        : {}),
    });

    const resumedSessionId = readResumeSessionId(openCodeInput.resumeCursor);
    const resumedSession = resumedSessionId
      ? await readJsonData(
          client.session.get({
            sessionID: resumedSessionId,
            ...(workspace ? { workspace } : {}),
          }),
        ).catch(() => undefined)
      : undefined;

    const createdSession =
      resumedSession ??
      (await readJsonData(
        client.session.create({
          ...(workspace ? { workspace } : {}),
          title: `T3 thread ${input.threadId}`,
        }),
      ));

    const createdAt = nowIso();
    const providerSessionId = asString(asRecord(createdSession)?.id);
    if (!providerSessionId) {
      throw new Error("OpenCode session creation did not return a session id");
    }

    const initialSession: OpenCodeProviderSession = {
      provider: PROVIDER,
      status: "ready",
      runtimeMode: openCodeInput.runtimeMode,
      ...(directory ? { cwd: directory } : {}),
      ...(openCodeInput.model ? { model: openCodeInput.model } : {}),
      threadId: openCodeInput.threadId,
      resumeCursor: {
        sessionId: providerSessionId,
        ...(workspace ? { workspace } : {}),
      },
      createdAt,
      updatedAt: createdAt,
    };

    const streamAbortController = new AbortController();
    const context: OpenCodeSessionContext = {
      threadId: openCodeInput.threadId,
      directory,
      ...(workspace ? { workspace } : {}),
      client,
      providerSessionId,
      pendingPermissions: new Map(),
      pendingQuestions: new Map(),
      partStreamById: new Map(),
      messageIds: [],
      streamAbortController,
      streamTask: Promise.resolve(),
      session: initialSession,
      activeTurnId: undefined,
      lastError: undefined,
    };

    context.streamTask = this.startStream(context);
    this.sessions.set(openCodeInput.threadId, context);

    this.emitRuntimeEvent({
      type: "session.started",
      eventId: eventId("opencode-session-started"),
      provider: PROVIDER,
      threadId: openCodeInput.threadId,
      createdAt,
      payload: {
        message: resumedSession
          ? "Reattached to existing OpenCode session"
          : "Started OpenCode session",
        resume: initialSession.resumeCursor,
      },
      providerRefs: {
        providerTurnId: providerSessionId,
      },
      raw: {
        source: "opencode.server.event",
        method: resumedSession ? "session.get" : "session.create",
        payload: createdSession,
      },
    });

    this.emitRuntimeEvent({
      type: "thread.started",
      eventId: eventId("opencode-thread-started"),
      provider: PROVIDER,
      threadId: openCodeInput.threadId,
      createdAt,
      payload: {
        providerThreadId: providerSessionId,
      },
      providerRefs: {
        providerTurnId: providerSessionId,
      },
    });

    this.emitRuntimeEvent({
      type: "session.configured",
      eventId: eventId("opencode-session-configured"),
      provider: PROVIDER,
      threadId: openCodeInput.threadId,
      createdAt,
      payload: {
        config: {
          provider: PROVIDER,
          sessionId: providerSessionId,
          ...(openCodeInput.model ? { model: openCodeInput.model } : {}),
          directory,
          ...(workspace ? { workspace } : {}),
        },
      },
    });

    return initialSession as ProviderSession;
  }

  async sendTurn(input: ProviderSendTurnInput): Promise<ProviderTurnStartResult> {
    const openCodeInput = input as OpenCodeSendTurnInput;
    const context = this.requireSession(input.threadId);
    const turnId = createTurnId();
    const agent =
      openCodeInput.modelOptions?.opencode?.agent ??
      (openCodeInput.interactionMode === "plan" ? "plan" : undefined);
    const parsedModel = parseOpencodeModel(openCodeInput.model);
    const providerId = openCodeInput.modelOptions?.opencode?.providerId ?? parsedModel?.providerId;
    const modelId =
      openCodeInput.modelOptions?.opencode?.modelId ?? parsedModel?.modelId ?? openCodeInput.model;
    const variant =
      openCodeInput.modelOptions?.opencode?.variant ??
      openCodeInput.modelOptions?.opencode?.reasoningEffort ??
      parsedModel?.variant;
    const startedAt = nowIso();

    context.activeTurnId = turnId;
    context.lastError = undefined;
    context.session = {
      ...stripTransientSessionFields(context.session),
      status: "running",
      ...(openCodeInput.model ? { model: openCodeInput.model } : {}),
      activeTurnId: turnId,
      updatedAt: startedAt,
    };

    this.emitRuntimeEvent({
      type: "turn.started",
      eventId: eventId("opencode-turn-started"),
      provider: PROVIDER,
      threadId: openCodeInput.threadId,
      createdAt: startedAt,
      turnId,
      payload: openCodeInput.model ? { model: openCodeInput.model } : {},
    });

    this.emitRuntimeEvent({
      type: "session.state.changed",
      eventId: eventId("opencode-session-running"),
      provider: PROVIDER,
      threadId: openCodeInput.threadId,
      createdAt: startedAt,
      turnId,
      payload: {
        state: "running",
      },
    });

    try {
      await readJsonData(
        context.client.session.promptAsync({
          sessionID: context.providerSessionId,
          ...(context.workspace ? { workspace: context.workspace } : {}),
          ...(providerId && modelId
            ? {
                model: {
                  providerID: providerId,
                  modelID: modelId,
                },
              }
            : {}),
          ...(agent ? { agent } : {}),
          ...(variant ? { variant } : {}),
          parts: [textPart(openCodeInput.input ?? "")],
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "OpenCode failed to start turn";
      context.activeTurnId = undefined;
      context.lastError = message;
      context.session = {
        ...stripTransientSessionFields(context.session),
        status: "error",
        updatedAt: nowIso(),
        lastError: message,
      };
      this.emitRuntimeEvent({
        type: "runtime.error",
        eventId: eventId("opencode-turn-start-error"),
        provider: PROVIDER,
        threadId: openCodeInput.threadId,
        createdAt: nowIso(),
        turnId,
        payload: {
          message,
          class: "provider_error",
        },
      });
      this.emitRuntimeEvent({
        type: "session.state.changed",
        eventId: eventId("opencode-session-start-failed"),
        provider: PROVIDER,
        threadId: openCodeInput.threadId,
        createdAt: nowIso(),
        turnId,
        payload: {
          state: "error",
          reason: message,
        },
      });
      this.emitRuntimeEvent({
        type: "turn.completed",
        eventId: eventId("opencode-turn-start-failed-completed"),
        provider: PROVIDER,
        threadId: openCodeInput.threadId,
        createdAt: nowIso(),
        turnId,
        payload: {
          state: "failed",
          errorMessage: message,
        },
      });
      throw cause;
    }

    return {
      threadId: openCodeInput.threadId,
      turnId,
      resumeCursor: context.session.resumeCursor,
    };
  }

  async interruptTurn(threadId: ThreadId): Promise<void> {
    const context = this.requireSession(threadId);
    try {
      await readJsonData(
        context.client.session.abort({
          sessionID: context.providerSessionId,
          ...(context.workspace ? { workspace: context.workspace } : {}),
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "OpenCode session abort failed";
      this.emitRuntimeEvent({
        type: "runtime.error",
        eventId: eventId("opencode-interrupt-error"),
        provider: PROVIDER,
        threadId,
        createdAt: nowIso(),
        ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
        payload: {
          message,
          class: "transport_error",
        },
      });
      // Still clean up local state even if the abort RPC failed so the UI
      // does not stay stuck in a "running" state.
    }
    const interruptedTurnId = context.activeTurnId;
    if (interruptedTurnId) {
      this.emitRuntimeEvent({
        type: "turn.completed",
        eventId: eventId("opencode-turn-interrupted"),
        provider: PROVIDER,
        threadId,
        createdAt: nowIso(),
        turnId: interruptedTurnId,
        payload: {
          state: "interrupted",
        },
      });
    }
    context.activeTurnId = undefined;
    context.session = {
      ...stripTransientSessionFields(context.session),
      status: "ready",
      updatedAt: nowIso(),
    };
  }

  async respondToRequest(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ): Promise<void> {
    const context = this.requireSession(threadId);
    await readJsonData(
      context.client.permission.reply({
        requestID: requestId,
        ...(context.workspace ? { workspace: context.workspace } : {}),
        reply: toPermissionReply(decision),
      }),
    );
    if (decision === "cancel") {
      await this.interruptTurn(threadId);
    }
  }

  async respondToUserInput(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ): Promise<void> {
    const context = this.requireSession(threadId);
    const pending = context.pendingQuestions.get(requestId);
    if (!pending) {
      throw new Error(`Unknown OpenCode question request '${requestId}'`);
    }

    const max = pending.questions.reduce(
      (result, question) => (question.answerIndex > result ? question.answerIndex : result),
      -1,
    );
    const orderedAnswers = Array.from({ length: max + 1 }, () => [] as string[]);
    for (const question of pending.questions) {
      const value = answers[question.id];
      if (Array.isArray(value)) {
        orderedAnswers[question.answerIndex] = value.map(String);
        continue;
      }
      if (typeof value === "string" && value.length > 0) {
        orderedAnswers[question.answerIndex] = [value];
      }
    }

    await readJsonData(
      context.client.question.reply({
        requestID: requestId,
        ...(context.workspace ? { workspace: context.workspace } : {}),
        answers: orderedAnswers,
      }),
    );
  }

  async readThread(threadId: ThreadId): Promise<ProviderThreadSnapshot> {
    const context = this.requireSession(threadId);
    const messages = await readJsonData(
      context.client.session.messages({
        sessionID: context.providerSessionId,
        ...(context.workspace ? { workspace: context.workspace } : {}),
      }),
    );

    const turns = (Array.isArray(messages) ? messages : []).map((entry) => {
      const info = asRecord(asRecord(entry)?.info);
      const messageId = asString(info?.id) ?? randomUUID();
      return {
        id: TurnId.makeUnsafe(messageId),
        items: [entry],
      };
    });

    return {
      threadId,
      turns,
    };
  }

  async rollbackThread(threadId: ThreadId, numTurns = 1): Promise<ProviderThreadSnapshot> {
    if (!Number.isInteger(numTurns) || numTurns < 1) {
      throw new Error(`Invalid numTurns (${numTurns}) — must be a positive integer`);
    }
    const context = this.requireSession(threadId);
    const ids = context.messageIds;
    if (ids.length === 0) {
      throw new Error(`No tracked messages for OpenCode thread '${threadId}' — cannot rollback`);
    }
    if (numTurns >= ids.length) {
      throw new Error(
        `Cannot rollback ${numTurns} turns — only ${ids.length} tracked message(s) available`,
      );
    }
    // Target the message just before the last `numTurns` messages.
    // Each message ID in the tracked list corresponds to one assistant turn.
    const targetIndex = ids.length - numTurns - 1;
    const targetMessageId = ids[targetIndex]!;
    await readJsonData(
      context.client.session.revert({
        sessionID: context.providerSessionId,
        messageID: targetMessageId,
        ...(context.workspace ? { workspace: context.workspace } : {}),
      }),
    );
    // Trim tracked IDs to match the reverted state
    context.messageIds.length = targetIndex + 1;
    return this.readThread(threadId);
  }

  async listModels(
    options?: OpenCodeModelDiscoveryOptions,
  ): Promise<ReadonlyArray<OpenCodeDiscoveredModel>> {
    const shared = await this.ensureServer(options);
    const client = await createClient({
      baseUrl: shared.baseUrl,
      ...(options?.directory ? { directory: options.directory } : {}),
      responseStyle: "data",
      throwOnError: true,
      ...(shared.authHeader
        ? {
            headers: {
              Authorization: shared.authHeader,
            },
          }
        : {}),
    });
    const payload = readProviderListResponse(
      await readJsonData(
        client.provider.list(options?.workspace ? { workspace: options.workspace } : {}),
      ),
    );
    // Show all configured providers, marking which ones are connected.
    // Fall back to config.providers if the provider.list response has
    // no entries at all.
    const connectedIds = new Set(payload.connected);
    const listed = parseProviderModels(payload.all, connectedIds);
    if (listed.length > 0) {
      return listed;
    }
    const configured = readConfigProvidersResponse(
      await readJsonData(
        client.config.providers(options?.workspace ? { workspace: options.workspace } : {}),
      ),
    );
    return parseProviderModels(configured.providers);
  }

  stopSession(threadId: ThreadId): void {
    const context = this.sessions.get(threadId);
    if (!context) {
      return;
    }
    this.emitRuntimeEvent({
      type: "session.exited",
      eventId: eventId("opencode-session-exited"),
      provider: PROVIDER,
      threadId,
      createdAt: nowIso(),
      payload: {
        reason: "Session stopped",
        exitKind: "graceful",
        recoverable: true,
      },
    });
    context.streamAbortController.abort();
    context.session = {
      ...stripTransientSessionFields(context.session),
      status: "closed",
      updatedAt: nowIso(),
    };
    this.sessions.delete(threadId);
  }

  stopAll(): void {
    for (const threadId of this.sessions.keys()) {
      this.stopSession(threadId);
    }
    this.server?.child?.kill();
    this.server = undefined;
    this.serverPromise = undefined;
  }

  private requireSession(threadId: ThreadId): OpenCodeSessionContext {
    const context = this.sessions.get(threadId);
    if (!context) {
      throw new Error(`Unknown OpenCode session for thread '${threadId}'`);
    }
    return context;
  }

  private async ensureServer(options?: OpenCodeProviderOptions): Promise<SharedServerState> {
    if (this.server) {
      return this.server;
    }
    if (this.serverPromise) {
      return this.serverPromise;
    }

    this.serverPromise = (async () => {
      const result = await ensureServer(options, {
        server: this.server,
        serverPromise: this.serverPromise,
      });
      this.server = result.state;
      return result.state;
    })();

    try {
      return await this.serverPromise;
    } finally {
      if (!this.server) {
        this.serverPromise = undefined;
      }
    }
  }

  private async startStream(context: OpenCodeSessionContext): Promise<void> {
    try {
      const result = await context.client.event.subscribe(
        context.workspace ? { workspace: context.workspace } : {},
        {
          signal: context.streamAbortController.signal,
        },
      );

      for await (const event of result.stream) {
        if (context.streamAbortController.signal.aborted) {
          break;
        }
        handleEvent(this, context, event);
      }
    } catch (cause) {
      if (context.streamAbortController.signal.aborted) {
        return;
      }
      const message = cause instanceof Error ? cause.message : "OpenCode event stream failed";
      context.lastError = message;
      context.session = {
        ...stripTransientSessionFields(context.session),
        status: "error",
        updatedAt: nowIso(),
        lastError: message,
      };
      this.emitRuntimeEvent({
        type: "runtime.error",
        eventId: eventId("opencode-stream-error"),
        provider: PROVIDER,
        threadId: context.threadId,
        createdAt: nowIso(),
        ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
        payload: {
          message,
          class: "transport_error",
        },
      });
      this.emitRuntimeEvent({
        type: "session.exited",
        eventId: eventId("opencode-session-exited-error"),
        provider: PROVIDER,
        threadId: context.threadId,
        createdAt: nowIso(),
        payload: {
          reason: message,
          exitKind: "error",
          recoverable: false,
        },
      });
    }
  }

  emitRuntimeEvent(event: OpenCodeProviderRuntimeEvent): void {
    this.emit("event", event as unknown as ProviderRuntimeEvent);
  }
}

export async function fetchOpenCodeModels(options?: OpenCodeModelDiscoveryOptions) {
  const manager = new OpenCodeServerManager();
  try {
    return await manager.listModels(options);
  } finally {
    manager.stopAll();
  }
}
