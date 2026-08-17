import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  DEFAULT_HERMES_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  HERMES_GATEWAY_PROTOCOL_VERSION,
  HERMES_MEDIA_MAX_BYTES,
  HermesGatewayConnectionHello,
  HermesGatewayPluginToT3Message,
  HermesGatewayT3ToPluginMessage,
  MessageId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ChatAttachment,
  type ThreadId,
  ThreadId as ThreadIdSchema,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as Socket from "effect/unstable/socket/Socket";

import { createAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { getOrCreateAgentProject } from "../orchestration/agentProjects.ts";
import { getOrCreateHomeThread } from "../orchestration/homeThreads.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  HermesGatewayBroker,
  type HermesGatewayConnectionRegistration,
} from "./Services/HermesGatewayBroker.ts";
import { ProviderAdapterRequestError } from "./Errors.ts";

export const HERMES_GATEWAY_WEBSOCKET_PATH = "/api/hermes-gateway/ws";

const decodePluginFrame = Schema.decodeUnknownEffect(
  Schema.fromJsonString(HermesGatewayPluginToT3Message),
);
const encodeServerFrame = Schema.encodeSync(Schema.fromJsonString(HermesGatewayT3ToPluginMessage));
const isConnectionHello = Schema.is(HermesGatewayConnectionHello);

interface HermesDeliveryTransport {
  readonly send: (
    frame: HermesGatewayT3ToPluginMessage,
  ) => Effect.Effect<void, ProviderAdapterRequestError>;
}

function deliveryUuid(input: {
  readonly instanceId: string;
  readonly threadId: string;
  readonly deliveryId: string;
  readonly purpose: string;
}): string {
  const hex = NodeCrypto.createHash("sha256")
    .update(`${input.purpose}\0${input.instanceId}\0${input.threadId}\0${input.deliveryId}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deliveryIds(input: { readonly instanceId: string; readonly deliveryId: string }) {
  // The identity belongs to the source instance and delivery, not to the
  // destination selected at retry time. Home can be re-designated after a
  // commit whose ack was lost; retaining the same command/message ids lets
  // the durable receipt acknowledge that retry instead of appending twice.
  const id = deliveryUuid({ ...input, threadId: "", purpose: "message" });
  return {
    commandId: CommandId.make(`hermes-delivery-${id}`),
    messageId: MessageId.make(`hermes-delivery-${id}`),
  };
}

const writeMediaAtomically = Effect.fn("writeHermesMediaAtomically")(function* (
  filePath: string,
  bytes: Uint8Array,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const targetDirectory = path.dirname(filePath);
  const tempDirectory = yield* fileSystem.makeTempDirectoryScoped({
    directory: targetDirectory,
    prefix: `${path.basename(filePath)}.`,
  });
  const tempPath = path.join(tempDirectory, "contents.tmp");

  yield* fileSystem.writeFile(tempPath, bytes);
  yield* fileSystem.rename(tempPath, filePath);
});

/**
 * Build the durable-write-then-ack handlers for plugin-initiated deliveries.
 *
 * A factory rather than route-inlined closures so the delivery contract —
 * dedupe, pessimistic ack, thread resolution — is testable without standing
 * up a WebSocket route around it.
 */
export const makeHermesDeliveryHandlers = Effect.fn("makeHermesDeliveryHandlers")(function* () {
  const engine = yield* OrchestrationEngineService;
  const projection = yield* ProjectionSnapshotQuery;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;

  const resolveDeliveryThread = (input: {
    readonly registration: HermesGatewayConnectionRegistration;
    readonly requestedThreadId: ThreadId;
    readonly kind: "cron" | "message" | "lifecycle" | "handoff" | "other";
  }) =>
    Effect.gen(function* () {
      const homeThreadId = yield* getOrCreateHomeThread({
        instanceId: input.registration.instanceId,
        title: input.registration.accepted.nickname,
      });
      if (input.kind !== "handoff" || input.requestedThreadId === homeThreadId) {
        return homeThreadId;
      }

      // `/handoff` is the one proactive path allowed to name a non-Home
      // destination. It must be a thread in this instance's synthetic agent
      // project — the same boundary `createHandoffThread` writes into. This
      // prevents an authenticated but confused plugin from addressing an
      // arbitrary user project.
      const project = yield* getOrCreateAgentProject({
        instanceId: input.registration.instanceId,
        title: input.registration.accepted.nickname,
      });
      const active = yield* projection.getThreadShellById(input.requestedThreadId);
      const archived =
        Option.isNone(active) && projection.getThreadArchiveStateById !== undefined
          ? yield* projection.getThreadArchiveStateById(input.requestedThreadId)
          : Option.none();
      const thread = Option.isSome(active)
        ? active.value
        : projection.getThreadArchiveStateById !== undefined
          ? Option.getOrUndefined(archived)
          : (yield* projection.getArchivedShellSnapshot()).threads.find(
              (candidate) => candidate.id === input.requestedThreadId,
            );
      if (thread?.projectId !== project.id) {
        return yield* new ProviderAdapterRequestError({
          provider: "hermes",
          method: "handoff.deliver",
          detail: `Handoff destination '${input.requestedThreadId}' is not owned by this Hermes instance.`,
        });
      }
      if (thread.archivedAt !== null) {
        yield* engine
          .dispatch({
            type: "thread.unarchive",
            commandId: CommandId.make(
              `hermes-handoff-unarchive-${deliveryUuid({
                instanceId: input.registration.instanceId,
                threadId: input.requestedThreadId,
                deliveryId: thread.archivedAt,
                purpose: "unarchive",
              })}`,
            ),
            threadId: input.requestedThreadId,
          })
          .pipe(Effect.ignore);
      }
      return input.requestedThreadId;
    });

  /**
   * Write one proactive delivery into the instance's home thread and ack it.
   *
   * The ack is sent **only after the dispatch succeeds**. The plugin purges
   * its queued copy on the ack and on nothing else, so acking optimistically
   * would silently drop deliveries whenever a write failed. An unacked
   * delivery is retried on the next connect and deduped there by
   * `deliveryId`, which makes the pessimistic order the safe one.
   *
   * Accepted from either connection role. The route runs this handler through
   * the broker's authorization fence: a primary must still own its generation,
   * while a short-lived delivery socket must still hold the current credential.
   * That preserves out-of-process cron without letting a socket outlive revoke
   * or re-enrollment.
   */
  const deliverHomeNotification = (
    registration: HermesGatewayConnectionRegistration,
    message: Extract<HermesGatewayPluginToT3Message, { readonly type: "home.deliver" }>,
    transport: HermesDeliveryTransport,
  ) =>
    Effect.gen(function* () {
      const deliveryThreadId = yield* resolveDeliveryThread({
        registration,
        requestedThreadId: message.threadId,
        kind: message.kind,
      });

      const ids = deliveryIds({
        instanceId: registration.instanceId,
        deliveryId: message.deliveryId,
      });
      // Command receipts make this idempotent across retries and restarts.
      yield* engine.dispatch({
        type: "thread.notification.deliver",
        ...ids,
        threadId: deliveryThreadId,
        expectedProviderInstanceId: registration.instanceId,
        deliveryId: message.deliveryId,
        kind: message.kind,
        label: message.label,
        text: message.text,
        createdAt: message.createdAt,
      });

      yield* transport.send({
        type: "home.deliver.ack",
        protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
        deliveryId: message.deliveryId,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        // Deliberately no ack: the plugin keeps the delivery queued and
        // retries it on the next connect.
        Effect.logWarning("Hermes home delivery failed", {
          instanceId: registration.instanceId,
          deliveryId: message.deliveryId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  /**
   * Write one media delivery — bytes to the attachment store, then a
   * notification-shaped message row — and ack it.
   *
   * The same pessimistic contract as `deliverHomeNotification`: the ack is
   * sent only after the dispatch succeeds, an unacked delivery is retried
   * and deduped on `deliveryId`, and both connection roles are accepted.
   *
   * Thread resolution is scope-dependent:
   * - `turnId` present — media produced during a live turn. The frame's
   *   threadId is honored only when its projected shell belongs to this
   *   instance and still has a live ACP session; anything else is refused, so
   *   a confused plugin cannot spray files into arbitrary threads. Reading the
   *   provider-neutral projection also keeps the gateway route independent of
   *   provider runtime internals.
   * - turnless — proactive media. The threadId is advisory exactly as it is
   *   for `home.deliver`: the server re-resolves the instance's home thread
   *   and writes only there.
   */
  const deliverMedia = (
    registration: HermesGatewayConnectionRegistration,
    message: Extract<HermesGatewayPluginToT3Message, { readonly type: "media.deliver" }>,
    transport: HermesDeliveryTransport,
  ) =>
    Effect.gen(function* () {
      const bytes = Buffer.from(message.data, "base64");
      // The schema bounds the encoded string; re-check the decoded bytes so
      // a frame whose base64 hides more than the ceiling (or whose declared
      // size lies) is refused before anything is written. `sizeBytes` only
      // needs to be honest, not exact — base64 length is ambiguous by up to
      // 2 bytes of padding.
      if (bytes.byteLength === 0 || bytes.byteLength > HERMES_MEDIA_MAX_BYTES) {
        return yield* Effect.fail(
          new ProviderAdapterRequestError({
            provider: "hermes",
            method: "media.deliver",
            detail: `Media payload is empty or exceeds ${HERMES_MEDIA_MAX_BYTES} bytes after decoding.`,
          }),
        );
      }
      if (Math.abs(bytes.byteLength - message.sizeBytes) > 2) {
        return yield* Effect.fail(
          new ProviderAdapterRequestError({
            provider: "hermes",
            method: "media.deliver",
            detail: `Media payload decoded to ${bytes.byteLength} bytes but declared ${message.sizeBytes}.`,
          }),
        );
      }

      const threadId = yield* Effect.gen(function* () {
        if (message.turnId === undefined) {
          return yield* resolveDeliveryThread({
            registration,
            requestedThreadId: message.threadId,
            kind: message.kind,
          });
        }
        // Turn-scoped: the named thread must belong to this instance and have
        // a live ACP session. The companion does not start the turn; it can
        // only attach media to one ACP already owns.
        const shell = yield* projection.getThreadShellById(message.threadId);
        const tracked = Option.isSome(shell)
          ? shell.value.modelSelection.instanceId === registration.instanceId &&
            shell.value.session !== null &&
            shell.value.session.status !== "stopped"
          : false;
        if (!tracked) {
          return yield* Effect.fail(
            new ProviderAdapterRequestError({
              provider: "hermes",
              method: "media.deliver",
              detail: `Turn-scoped media names thread '${message.threadId}', which this instance has no session for.`,
            }),
          );
        }
        return message.threadId;
      });

      const ids = deliveryIds({
        instanceId: registration.instanceId,
        deliveryId: message.deliveryId,
      });
      {
        const mimeType = message.mimeType.trim().toLowerCase();
        const attachmentId = createAttachmentId(
          threadId,
          deliveryUuid({
            instanceId: registration.instanceId,
            threadId: "",
            deliveryId: message.deliveryId,
            purpose: "attachment",
          }),
        );
        if (!attachmentId) {
          return yield* Effect.fail(
            new ProviderAdapterRequestError({
              provider: "hermes",
              method: "media.deliver",
              detail: "Failed to create a safe attachment id.",
            }),
          );
        }
        // Images take the image variant so they ride the existing inline
        // grid; the image schema caps sizeBytes at 10MB, so a larger image
        // degrades to the generic file card rather than being refused.
        const attachment: ChatAttachment =
          mimeType.startsWith("image/") && bytes.byteLength <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
            ? {
                type: "image",
                id: attachmentId,
                name: message.name,
                mimeType,
                sizeBytes: bytes.byteLength,
              }
            : {
                type: "file",
                id: attachmentId,
                name: message.name,
                mimeType,
                sizeBytes: bytes.byteLength,
              };

        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!attachmentPath) {
          return yield* Effect.fail(
            new ProviderAdapterRequestError({
              provider: "hermes",
              method: "media.deliver",
              detail: `Failed to resolve a persisted path for '${message.name}'.`,
            }),
          );
        }
        // Bytes before row, deliberately: a row pointing at a missing file
        // renders broken forever, while an orphaned file from a failed
        // dispatch is harmless. Publish through a sibling temporary file so
        // an interrupted write cannot leave a partial final file that poisons
        // every retry of this deterministic delivery id.
        yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true });
        if (yield* fileSystem.exists(attachmentPath)) {
          const persisted = yield* fileSystem.readFile(attachmentPath);
          if (!Buffer.from(persisted).equals(bytes)) {
            return yield* Effect.fail(
              new ProviderAdapterRequestError({
                provider: "hermes",
                method: "media.deliver",
                detail: `Delivery '${message.deliveryId}' was retried with different media bytes.`,
              }),
            );
          }
        } else {
          yield* Effect.scoped(writeMediaAtomically(attachmentPath, bytes));
        }

        yield* engine.dispatch({
          type: "thread.notification.deliver",
          ...ids,
          threadId,
          expectedProviderInstanceId: registration.instanceId,
          deliveryId: message.deliveryId,
          kind: message.kind,
          label: message.label,
          // The caption is the row's text; empty is fine — the schema
          // allows it and the web renders media-only rows without a body.
          text: message.caption ?? "",
          attachments: [attachment],
          ...(message.turnId !== undefined ? { turnId: message.turnId } : {}),
          createdAt: message.createdAt,
        });
      }

      yield* transport.send({
        type: "media.deliver.ack",
        protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
        deliveryId: message.deliveryId,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        // Deliberately no ack: the plugin keeps the delivery queued and
        // retries it on the next connect.
        Effect.logWarning("Hermes media delivery failed", {
          instanceId: registration.instanceId,
          deliveryId: message.deliveryId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const createHandoffThread = (
    registration: HermesGatewayConnectionRegistration,
    message: Extract<HermesGatewayPluginToT3Message, { readonly type: "handoff.create" }>,
    transport: HermesDeliveryTransport,
  ) =>
    Effect.gen(function* () {
      if (registration.role !== "gateway") {
        return yield* new ProviderAdapterRequestError({
          provider: "hermes",
          method: "handoff.create",
          detail: "A delivery-only connection cannot create handoff threads.",
        });
      }
      const homeThreadId = yield* getOrCreateHomeThread({
        instanceId: registration.instanceId,
        title: registration.accepted.nickname,
      });
      if (message.parentThreadId !== homeThreadId) {
        return yield* new ProviderAdapterRequestError({
          provider: "hermes",
          method: "handoff.create",
          detail: "A Hermes handoff must start from the instance's Home thread.",
        });
      }
      const project = yield* getOrCreateAgentProject({
        instanceId: registration.instanceId,
        title: registration.accepted.nickname,
      });
      const rawId = deliveryUuid({
        instanceId: registration.instanceId,
        threadId: homeThreadId,
        deliveryId: message.requestId,
        purpose: "handoff-thread",
      });
      const threadId = ThreadIdSchema.make(`hermes-handoff-${rawId}`);
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`hermes-handoff-create-${rawId}`),
        threadId,
        projectId: project.id,
        title: message.name,
        modelSelection: {
          instanceId: registration.instanceId,
          model: DEFAULT_HERMES_MODEL,
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: DateTime.formatIso(yield* DateTime.now),
      });
      yield* transport.send({
        type: "handoff.created",
        protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
        requestId: message.requestId,
        threadId,
      });
    }).pipe(
      Effect.catchTag("ProviderAdapterRequestError", (error) =>
        error.method === "handoff.create"
          ? transport.send({
              type: "protocol.error",
              protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
              requestId: message.requestId,
              code: "invalid-message",
              message: error.detail,
              recoverable: false,
            })
          : Effect.fail(error),
      ),
      Effect.catchCause((cause) =>
        transport
          .send({
            type: "protocol.error",
            protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
            requestId: message.requestId,
            code: "internal-error",
            message: "T3 could not create the Hermes handoff thread.",
            recoverable: true,
          })
          .pipe(
            Effect.tap(() =>
              Effect.logWarning("Hermes handoff thread creation failed", {
                instanceId: registration.instanceId,
                cause: Cause.pretty(cause),
              }),
            ),
          ),
      ),
    );

  return { deliverHomeNotification, deliverMedia, createHandoffThread } as const;
});

export const hermesGatewayWebSocketRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const broker = yield* HermesGatewayBroker;
    const { deliverHomeNotification, deliverMedia, createHandoffThread } =
      yield* makeHermesDeliveryHandlers();

    return HttpRouter.add(
      "GET",
      HERMES_GATEWAY_WEBSOCKET_PATH,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const socket = yield* Effect.orDie(request.upgrade);
        const write = yield* socket.writer;
        const registration = yield* Ref.make<Option.Option<HermesGatewayConnectionRegistration>>(
          Option.none(),
        );
        const transport = {
          send: (message: HermesGatewayT3ToPluginMessage) =>
            write(encodeServerFrame(message)).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterRequestError({
                    provider: "hermes",
                    method: message.type,
                    detail: "Failed to write a Hermes gateway WebSocket frame.",
                    cause,
                  }),
              ),
            ),
          close: (code: number, reason: string) =>
            write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore),
        };

        yield* socket
          .runString((frame) =>
            Effect.gen(function* () {
              const message = yield* decodePluginFrame(frame);
              const current = yield* Ref.get(registration);

              if (Option.isNone(current)) {
                if (!isConnectionHello(message)) {
                  yield* transport.close(4002, "First message must be connection.hello");
                  return;
                }
                const registered = yield* broker
                  .registerConnection(message, transport)
                  .pipe(
                    Effect.tapError((rejected) =>
                      transport
                        .send(rejected)
                        .pipe(Effect.andThen(transport.close(4003, rejected.message))),
                    ),
                  );
                yield* Ref.set(registration, Option.some(registered));

                // Resolve the home thread here rather than inside
                // `registerConnection`, whose error channel is exactly
                // `connection.rejected`: a thread-creation failure is not a
                // reason to refuse an authenticated plugin. On failure the
                // handshake completes without `homeThreadId`, the plugin keeps
                // whatever designation it already had, and the next connect
                // converges — which is the whole point of converge-on-read.
                const homeThreadId = yield* getOrCreateHomeThread({
                  instanceId: registered.instanceId,
                  title: registered.accepted.nickname,
                }).pipe(
                  Effect.map(Option.some),
                  Effect.catchCause((cause) =>
                    Effect.logWarning("home thread resolution failed", {
                      instanceId: registered.instanceId,
                      cause: Cause.pretty(cause),
                    }).pipe(Effect.as(Option.none<ThreadId>())),
                  ),
                );

                yield* transport.send({
                  ...registered.accepted,
                  ...(Option.isSome(homeThreadId) ? { homeThreadId: homeThreadId.value } : {}),
                });
                return;
              }

              if (isConnectionHello(message)) {
                yield* transport.close(4002, "connection.hello may only be sent once");
                return;
              }

              // Deliveries are handled on the socket that carried them rather
              // than through the broker's event stream, because the ack has to
              // go back to *this* connection — which for an out-of-process cron
              // run is a short-lived delivery socket that no stream subscriber
              // can address.
              if (message.type === "home.deliver") {
                yield* broker.withAuthorizedConnection(
                  current.value,
                  deliverHomeNotification(current.value, message, transport),
                );
                return;
              }

              if (message.type === "media.deliver") {
                yield* broker.withAuthorizedConnection(
                  current.value,
                  deliverMedia(current.value, message, transport),
                );
                return;
              }

              if (message.type === "handoff.create") {
                yield* broker.withAuthorizedConnection(
                  current.value,
                  createHandoffThread(current.value, message, transport),
                );
                return;
              }

              yield* broker.receive(current.value, message);
            }).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("Rejected Hermes gateway WebSocket frame", { cause }).pipe(
                  Effect.andThen(transport.close(4002, "Invalid Hermes gateway message")),
                ),
              ),
            ),
          )
          .pipe(
            Effect.catch((cause) =>
              Effect.logDebug("Hermes gateway WebSocket disconnected", { cause }),
            ),
            Effect.ensuring(
              Ref.get(registration).pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.void,
                    onSome: broker.disconnect,
                  }),
                ),
              ),
            ),
          );

        return HttpServerResponse.empty();
      }),
    );
  }),
);
