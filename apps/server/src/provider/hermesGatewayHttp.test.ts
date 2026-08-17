import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  HERMES_GATEWAY_PROTOCOL_VERSION,
  HERMES_MEDIA_MAX_BYTES,
  HermesGatewayCredential,
  HermesGatewayDeliveryId,
  HermesGatewayRequestId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type HermesGatewayMediaDeliver,
  type HermesGatewayT3ToPluginMessage,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { HermesGatewayConnectionRegistration } from "./Services/HermesGatewayBroker.ts";
import { makeHermesDeliveryHandlers } from "./hermesGatewayHttp.ts";

const INSTANCE_ID = ProviderInstanceId.make("hermes-media-test");
const HOME_THREAD_ID = ThreadId.make("thread-home-media");
const SESSION_THREAD_ID = ThreadId.make("thread-live-turn");
const AGENT_PROJECT_ID = ProjectId.make("project-hermes-media");
const CREATED_AT = "2026-07-27T09:00:00.000Z";

const registration: HermesGatewayConnectionRegistration = {
  instanceId: INSTANCE_ID,
  authorizationCredential: HermesGatewayCredential.make("test-credential"),
  generation: 1,
  role: "gateway",
  accepted: {
    type: "connection.accepted",
    requestId: HermesGatewayRequestId.make("accept-1"),
    protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
    instanceId: INSTANCE_ID,
    nickname: "Hermes Media",
  },
};

const mediaFrame = (
  overrides: Partial<HermesGatewayMediaDeliver> = {},
): HermesGatewayMediaDeliver =>
  ({
    type: "media.deliver",
    protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
    deliveryId: HermesGatewayDeliveryId.make("media-delivery-1"),
    threadId: HOME_THREAD_ID,
    kind: "cron",
    label: "Cron: daily-digest",
    name: "chart.png",
    mimeType: "image/png",
    sizeBytes: 8,
    caption: "Today's chart",
    data: Buffer.from("PNGBYTES").toString("base64"),
    createdAt: CREATED_AT,
    ...overrides,
  }) as HermesGatewayMediaDeliver;

const makeHarness = (options?: {
  readonly trackedThreadId?: ThreadId;
  readonly failDispatch?: boolean;
  /** Archive state of the designated home thread, as the projection sees it. */
  readonly homeThreadArchivedAt?: string;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const attachmentsDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-hermes-media-attachments-",
    });
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
    const receivedCommandIds = yield* Ref.make(new Set<string>());
    const sent: Array<HermesGatewayT3ToPluginMessage> = [];
    const transport = {
      send: (frame: HermesGatewayT3ToPluginMessage) =>
        Effect.sync(() => sent.push(frame)).pipe(Effect.asVoid),
    };

    const engineLayer = Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Ref.modify(receivedCommandIds, (seen) => {
          if (seen.has(command.commandId)) return [false, seen] as const;
          return [true, new Set([...seen, command.commandId])] as const;
        }).pipe(
          Effect.tap((isFirst) =>
            isFirst ? Ref.update(dispatched, (commands) => [...commands, command]) : Effect.void,
          ),
          Effect.andThen(
            options?.failDispatch
              ? Effect.fail(
                  new OrchestrationCommandInvariantError({
                    commandType: "thread.notification.deliver",
                    detail: "Simulated dispatch failure.",
                  }),
                )
              : Effect.succeed({ sequence: 1 }),
          ),
        ),
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    });

    const queryLayer = Layer.mock(ProjectionSnapshotQuery)({
      // The home thread is designated in settings and exists, so home-thread
      // resolution takes the fast path without dispatching a thread.create.
      getThreadArchiveStateById: () =>
        Effect.succeed(
          Option.some({
            projectId: AGENT_PROJECT_ID,
            archivedAt: options?.homeThreadArchivedAt ?? null,
          }),
        ),
      getThreadShellById: (threadId) =>
        Effect.succeed(
          options?.trackedThreadId === threadId
            ? Option.some({
                id: threadId,
                projectId: AGENT_PROJECT_ID,
                modelSelection: { instanceId: INSTANCE_ID, model: "hermes" },
                session: { status: "ready" },
                archivedAt: null,
              } as never)
            : Option.none(),
        ),
      getActiveProjectByWorkspaceRoot: () =>
        Effect.succeed(
          Option.some({
            id: AGENT_PROJECT_ID,
            title: "Hermes Media",
            workspaceRoot: "/tmp/t3-hermes-media/agents/hermes-media-test",
            repositoryIdentity: null,
            defaultModelSelection: null,
            scripts: [],
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            deletedAt: null,
          }),
        ),
    });

    const settingsLayer = ServerSettings.layerTest({
      providerInstances: {
        [INSTANCE_ID]: {
          driver: "hermes",
          displayName: "Hermes Media",
          config: { homeThreadId: HOME_THREAD_ID },
        },
      },
    } as never);

    // Only `attachmentsDir` is read off the config by the handlers.
    const configLayer = Layer.succeed(ServerConfig, {
      baseDir: "/tmp/t3-hermes-media",
      attachmentsDir,
    } as unknown as ServerConfig["Service"]);

    // Provided at invocation too: the handlers resolve the home thread at
    // delivery time, which pulls services from the runtime context.
    const servicesLayer = Layer.mergeAll(engineLayer, queryLayer, settingsLayer, configLayer).pipe(
      Layer.provideMerge(NodeServices.layer),
    );

    const handlers = yield* makeHermesDeliveryHandlers().pipe(Effect.provide(servicesLayer));
    const deliverMedia = (...args: Parameters<typeof handlers.deliverMedia>) =>
      handlers.deliverMedia(...args).pipe(Effect.provide(servicesLayer), Effect.orDie);
    const deliverHomeNotification = (
      ...args: Parameters<typeof handlers.deliverHomeNotification>
    ) =>
      handlers.deliverHomeNotification(...args).pipe(Effect.provide(servicesLayer), Effect.orDie);
    const createHandoffThread = (...args: Parameters<typeof handlers.createHandoffThread>) =>
      handlers.createHandoffThread(...args).pipe(Effect.provide(servicesLayer), Effect.orDie);

    return {
      deliverMedia,
      deliverHomeNotification,
      createHandoffThread,
      dispatched,
      sent,
      transport,
      attachmentsDir,
    } as const;
  });

const dispatchedDeliveries = (commands: ReadonlyArray<OrchestrationCommand>) =>
  commands.filter(
    (command): command is Extract<OrchestrationCommand, { type: "thread.notification.deliver" }> =>
      command.type === "thread.notification.deliver",
  );

it.effect("creates handoff threads idempotently under the instance's agent project", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const request = {
      type: "handoff.create" as const,
      protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
      requestId: HermesGatewayRequestId.make("handoff-request-1"),
      parentThreadId: HOME_THREAD_ID,
      name: "Hermes — release prep",
    };

    yield* harness.createHandoffThread(registration, request, harness.transport);
    yield* harness.createHandoffThread(registration, request, harness.transport);

    const creates = (yield* Ref.get(harness.dispatched)).filter(
      (command) => command.type === "thread.create",
    );
    assert.equal(creates.length, 1);
    const created = creates[0]!;
    assert.equal(created.projectId, AGENT_PROJECT_ID);
    assert.equal(created.title, "Hermes — release prep");
    assert.equal(created.modelSelection.instanceId, INSTANCE_ID);
    assert.match(created.threadId, /^hermes-handoff-/);

    assert.equal(harness.sent.length, 2);
    assert.deepEqual(harness.sent[0], {
      type: "handoff.created",
      protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
      requestId: request.requestId,
      threadId: created.threadId,
    });
    assert.deepEqual(harness.sent[1], harness.sent[0]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refuses a forged handoff parent without creating a thread", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* harness.createHandoffThread(
      registration,
      {
        type: "handoff.create",
        protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
        requestId: HermesGatewayRequestId.make("handoff-forged-parent"),
        parentThreadId: ThreadId.make("some-user-thread"),
        name: "Wrong parent",
      },
      harness.transport,
    );

    assert.equal(
      (yield* Ref.get(harness.dispatched)).filter((command) => command.type === "thread.create")
        .length,
      0,
    );
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0]?.type, "protocol.error");
    if (harness.sent[0]?.type === "protocol.error") {
      assert.equal(harness.sent[0].requestId, "handoff-forged-parent");
      assert.equal(harness.sent[0].code, "invalid-message");
      assert.equal(harness.sent[0].recoverable, false);
      assert.include(harness.sent[0].message, "Home thread");
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reports unexpected handoff creation failures as recoverable", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ failDispatch: true });
    yield* harness.createHandoffThread(
      registration,
      {
        type: "handoff.create",
        protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
        requestId: HermesGatewayRequestId.make("handoff-dispatch-failure"),
        parentThreadId: HOME_THREAD_ID,
        name: "Retry later",
      },
      harness.transport,
    );

    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0]?.type, "protocol.error");
    if (harness.sent[0]?.type === "protocol.error") {
      assert.equal(harness.sent[0].code, "internal-error");
      assert.equal(harness.sent[0].recoverable, true);
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("allows handoff delivery only into a thread owned by the instance agent project", () =>
  Effect.gen(function* () {
    const handoffThreadId = ThreadId.make("hermes-handoff-owned");
    const harness = yield* makeHarness({ trackedThreadId: handoffThreadId });
    yield* harness.deliverHomeNotification(
      registration,
      {
        type: "home.deliver",
        protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
        deliveryId: HermesGatewayDeliveryId.make("handoff-delivery-1"),
        threadId: handoffThreadId,
        kind: "handoff",
        label: "Handoff",
        text: "The CLI session is ready here.",
        createdAt: CREATED_AT,
      },
      harness.transport,
    );

    const delivery = dispatchedDeliveries(yield* Ref.get(harness.dispatched))[0]!;
    assert.equal(delivery.threadId, handoffThreadId);
    assert.equal(delivery.kind, "handoff");
    assert.equal(harness.sent[0]?.type, "home.deliver.ack");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("writes turnless media to the home thread with provenance and acks after dispatch", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    // The frame's threadId is deliberately NOT the home thread: turnless
    // media must land in the re-resolved home thread regardless.
    yield* harness.deliverMedia(
      registration,
      mediaFrame({ threadId: ThreadId.make("thread-attacker-named") }),
      harness.transport,
    );

    const deliveries = dispatchedDeliveries(yield* Ref.get(harness.dispatched));
    assert.equal(deliveries.length, 1);
    const delivery = deliveries[0]!;
    assert.equal(delivery.threadId, HOME_THREAD_ID);
    assert.equal(delivery.kind, "cron");
    assert.equal(delivery.label, "Cron: daily-digest");
    assert.equal(delivery.text, "Today's chart");
    assert.isUndefined(delivery.turnId);
    assert.equal(delivery.attachments?.length, 1);
    const attachment = delivery.attachments![0]!;
    // image/* rides the image variant so the web's inline grid renders it.
    assert.equal(attachment.type, "image");
    assert.equal(attachment.mimeType, "image/png");
    assert.equal(attachment.sizeBytes, 8);

    // The bytes are durably on disk under the dispatched attachment id.
    const fileSystem = yield* FileSystem.FileSystem;
    const entries = yield* fileSystem.readDirectory(harness.attachmentsDir);
    const written = entries.find((entry) => entry.startsWith(attachment.id));
    assert.isDefined(written, "the media bytes must be written to the attachments dir");
    const bytes = yield* fileSystem.readFile(`${harness.attachmentsDir}/${written}`);
    assert.equal(Buffer.from(bytes).toString("utf8"), "PNGBYTES");

    assert.deepEqual(harness.sent, [
      {
        type: "media.deliver.ack",
        protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
        deliveryId: mediaFrame().deliveryId,
      },
    ]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("retries after an interrupted atomic media write", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const completed = yield* makeHarness();
    yield* completed.deliverMedia(registration, mediaFrame(), completed.transport);
    const finalName = (yield* fileSystem.readDirectory(completed.attachmentsDir)).find((entry) =>
      entry.endsWith(".png"),
    );
    assert.isDefined(finalName);

    const retry = yield* makeHarness();
    const interruptedDirectory = `${retry.attachmentsDir}/${finalName}.interrupted`;
    yield* fileSystem.makeDirectory(interruptedDirectory);
    yield* fileSystem.writeFileString(`${interruptedDirectory}/contents.tmp`, "PARTIAL");

    yield* retry.deliverMedia(registration, mediaFrame(), retry.transport);

    const persisted = yield* fileSystem.readFile(`${retry.attachmentsDir}/${finalName}`);
    assert.equal(Buffer.from(persisted).toString("utf8"), "PNGBYTES");
    assert.equal(dispatchedDeliveries(yield* Ref.get(retry.dispatched)).length, 1);
    assert.equal(retry.sent[0]?.type, "media.deliver.ack");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("acks a duplicate deliveryId without dispatching a second message", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* harness.deliverMedia(registration, mediaFrame(), harness.transport);
    yield* harness.deliverMedia(registration, mediaFrame(), harness.transport);

    // Both attempts reach dispatch with the same deterministic command id;
    // the engine's durable command receipt returns the first sequence without
    // appending a second message.
    assert.equal(dispatchedDeliveries(yield* Ref.get(harness.dispatched)).length, 1);
    assert.equal(harness.sent.length, 2);
    assert.equal(harness.sent[0]?.type, "media.deliver.ack");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps delivery identity stable when a retry resolves to another thread", () =>
  Effect.gen(function* () {
    const handoffThreadId = ThreadId.make("hermes-handoff-redesignated");
    const harness = yield* makeHarness({ trackedThreadId: handoffThreadId });
    const deliveryId = HermesGatewayDeliveryId.make("delivery-across-redesignation");

    yield* harness.deliverHomeNotification(
      registration,
      {
        type: "home.deliver",
        protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
        deliveryId,
        threadId: HOME_THREAD_ID,
        kind: "cron",
        label: "Cron",
        text: "Committed before the ack was lost.",
        createdAt: CREATED_AT,
      },
      harness.transport,
    );
    yield* harness.deliverHomeNotification(
      registration,
      {
        type: "home.deliver",
        protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
        deliveryId,
        threadId: handoffThreadId,
        kind: "handoff",
        label: "Retry",
        text: "Must not commit again.",
        createdAt: CREATED_AT,
      },
      harness.transport,
    );

    const deliveries = dispatchedDeliveries(yield* Ref.get(harness.dispatched));
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.threadId, HOME_THREAD_ID);
    assert.equal(harness.sent.length, 2);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("never overwrites committed media bytes on a conflicting retry", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* harness.deliverMedia(registration, mediaFrame(), harness.transport);
    yield* harness.deliverMedia(
      registration,
      mediaFrame({ data: Buffer.from("DIFFERENT").toString("base64"), sizeBytes: 9 }),
      harness.transport,
    );

    const delivery = dispatchedDeliveries(yield* Ref.get(harness.dispatched))[0]!;
    const attachment = delivery.attachments![0]!;
    const entries = yield* (yield* FileSystem.FileSystem).readDirectory(harness.attachmentsDir);
    const persistedPath = `${harness.attachmentsDir}/${entries.find((entry) => entry.startsWith(attachment.id))}`;
    const persisted = yield* (yield* FileSystem.FileSystem).readFile(persistedPath);
    assert.equal(Buffer.from(persisted).toString("utf8"), "PNGBYTES");
    assert.equal(harness.sent.length, 1, "the conflicting retry must remain unacked");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("dedupes a delivery into an ARCHIVED home thread", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      homeThreadArchivedAt: CREATED_AT,
    });
    yield* harness.deliverMedia(registration, mediaFrame(), harness.transport);
    yield* harness.deliverMedia(registration, mediaFrame(), harness.transport);

    assert.equal(dispatchedDeliveries(yield* Ref.get(harness.dispatched)).length, 1);
    assert.equal(harness.sent[0]?.type, "media.deliver.ack");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("routes turn-scoped media into the tracked thread and carries the turnId", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ trackedThreadId: SESSION_THREAD_ID });
    const turnId = TurnId.make("hermes-turn-live");
    yield* harness.deliverMedia(
      registration,
      mediaFrame({
        threadId: SESSION_THREAD_ID,
        turnId,
        deliveryId: HermesGatewayDeliveryId.make("media-delivery-turn"),
        mimeType: "video/mp4",
        name: "clip.mp4",
      }),
      harness.transport,
    );

    const delivery = dispatchedDeliveries(yield* Ref.get(harness.dispatched))[0]!;
    assert.equal(delivery.threadId, SESSION_THREAD_ID);
    assert.equal(delivery.turnId, turnId);
    // Non-image media takes the generic file variant.
    assert.equal(delivery.attachments?.[0]?.type, "file");
    assert.equal(harness.sent[0]?.type, "media.deliver.ack");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refuses turn-scoped media for a thread the adapter does not track", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ trackedThreadId: SESSION_THREAD_ID });
    yield* harness.deliverMedia(
      registration,
      mediaFrame({
        threadId: ThreadId.make("thread-not-ours"),
        turnId: TurnId.make("turn-x"),
      }),
      harness.transport,
    );

    // Refused outright: nothing written, and no ack so the plugin retries
    // (against a session that may exist by then).
    assert.equal(dispatchedDeliveries(yield* Ref.get(harness.dispatched)).length, 0);
    assert.equal(harness.sent.length, 0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refuses an oversized decoded payload without writing or acking", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const oversized = Buffer.alloc(HERMES_MEDIA_MAX_BYTES + 4, 1);
    yield* harness.deliverMedia(
      registration,
      mediaFrame({
        data: oversized.toString("base64"),
        sizeBytes: oversized.byteLength,
      }),
      harness.transport,
    );

    assert.equal(dispatchedDeliveries(yield* Ref.get(harness.dispatched)).length, 0);
    assert.equal(harness.sent.length, 0);
    assert.deepEqual(
      yield* (yield* FileSystem.FileSystem).readDirectory(harness.attachmentsDir),
      [],
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refuses a payload whose declared size grossly disagrees with its bytes", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* harness.deliverMedia(registration, mediaFrame({ sizeBytes: 5_000 }), harness.transport);

    assert.equal(dispatchedDeliveries(yield* Ref.get(harness.dispatched)).length, 0);
    assert.equal(harness.sent.length, 0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("does not ack media when the dispatch fails", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ failDispatch: true });
    yield* harness.deliverMedia(registration, mediaFrame(), harness.transport);

    // The plugin keeps the delivery queued and retries on the next connect.
    assert.equal(harness.sent.length, 0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
