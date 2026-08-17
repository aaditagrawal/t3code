/**
 * HermesGatewayBroker — enrollment, authentication, and message routing for
 * Hermes gateway plugin connections.
 *
 * State ownership
 * ---------------
 * The broker splits gateway state three ways, by durability:
 *
 *   - **Credential** → `ServerSecretStore`. A 0600 file is exactly the right
 *     home for a secret, and nothing else needs to enumerate it.
 *
 *   - **Durable config** (display name, connector URL, revoked) → the Hermes
 *     provider instance config in `ServerSettings`, written through
 *     `updateSettingsWith` so the read-modify-write happens under the settings
 *     write lock and concurrent edits to unrelated instances are preserved.
 *     This replaced a JSON blob in the secret store, which had no listing API,
 *     no index, and no transactions — and therefore forced O(N) secret-file
 *     scans, whole-file rewrites on every connect, and hand-rolled
 *     compensating writes.
 *
 *   - **Volatile liveness** (connection, transport, lastSeen, session count,
 *     reported model, upgrade-required) → `HermesConnectionRegistry`, in
 *     memory only. See that module for why persisting it would stop every live
 *     Hermes session on every reconnect.
 *
 * After a T3 restart the UI reports "never connected" until the plugin dials
 * back in. That is intended, and is the correct reading of the facts: T3 has
 * no live connection until one is re-established.
 *
 * Locking
 * -------
 * There is no global broker lock. Everything that mutates one instance's
 * enrollment — `createEnrollment`, `revokeInstance`, `removeInstance`,
 * `renameInstance`, and the state-changing half of `registerConnection` —
 * serializes on that instance's lock, so a slow credential write during one
 * instance's enrollment still cannot block another instance's WebSocket
 * handshake. `registerConnection` authenticates *before* taking the lock, so an
 * unauthenticated caller cannot queue on it, and then re-validates the durable
 * record and the credential once inside — the pre-lock read is only a filter.
 * Where two writers could still race within a locked section — token
 * redemption, connection replacement — correctness comes from compare-and-swap
 * and generation fencing rather than from the mutex.
 *
 * @module HermesGatewayBroker
 */
import * as NodeCrypto from "node:crypto";
import {
  HERMES_GATEWAY_PROTOCOL_VERSION,
  HERMES_DRIVER_KIND,
  defaultInstanceIdForDriver,
  HermesGatewayCredential,
  HermesGatewayCapabilities,
  HermesGatewayManagementError,
  ProviderInstanceId,
  type HermesGatewayConnectionHello,
  type HermesGatewayCreateEnrollmentInput,
  type HermesGatewayEnrollmentResult,
  type HermesGatewayInstanceStatus,
  type HermesGatewayPluginToT3Message,
  type HermesGatewayRemoveInstanceResult,
  type HermesGatewayRenameInstanceInput,
  type HermesGatewayRenameInstanceResult,
  type HermesGatewayRevokeInstanceResult,
  type HermesGatewayT3ToPluginMessage,
  type ProviderInstanceConfig,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";
import {
  HermesGatewayBroker,
  type HermesGatewayConnectionRegistration,
  type HermesGatewayEnvelope,
  type HermesGatewayTransport,
  type HermesGatewayBrokerShape,
} from "../Services/HermesGatewayBroker.ts";
import type {
  HermesActiveConnection,
  HermesObservedConnection,
} from "../Services/HermesConnectionRegistry.ts";
import type { PendingEnrollment } from "../Services/HermesEnrollmentStore.ts";
import { livenessStatusFields, makeHermesConnectionRegistry } from "./HermesConnectionRegistry.ts";
import { makeHermesEnrollmentStore } from "./HermesEnrollmentStore.ts";
import { makeRequestCorrelator } from "./RequestCorrelator.ts";

const ENROLLMENT_TTL = Duration.minutes(10);
const REQUEST_TIMEOUT = Duration.seconds(30);
/** Safety net for pending requests whose awaiting fiber died abnormally. */
const REQUEST_MAX_AGE = Duration.seconds(90);
/** How often expired enrollment tokens and abandoned requests are reaped. */
const SWEEP_INTERVAL = Duration.minutes(1);
/**
 * Server→plugin liveness probe. Without it a half-open socket reads as
 * "connected" indefinitely: `send` succeeds into the void and the failure only
 * surfaces when some unrelated request times out.
 *
 * These are sized so worst-case detection (first probe immediately, then
 * `PING_MAX_MISSED` failures) lands inside `REQUEST_TIMEOUT`. That ordering is
 * the whole point: an in-flight request over a dead socket should fail with
 * "the connection stopped responding" rather than sit out a generic timeout.
 */
const PING_INTERVAL = Duration.seconds(10);
/**
 * How long a single ping may go unanswered before it counts as missed.
 *
 * Generous on purpose. The plugin answers pings from its socket read loop
 * without touching Hermes, so a slow reply means the process is genuinely
 * starved rather than merely busy — but a Python event loop under a heavy
 * turn can still be slow to schedule, and killing a working connection is far
 * worse than noticing a dead one a few seconds later.
 */
const PING_TIMEOUT = Duration.seconds(6);
/**
 * Consecutive missed pings tolerated before the connection is torn down.
 *
 * Worst case detection is `PING_INTERVAL` (the wait before the first probe)
 * plus `PING_TIMEOUT * PING_MAX_MISSED`, since a miss re-probes immediately.
 * That total must stay under `REQUEST_TIMEOUT` so an in-flight request over a
 * dead socket fails with the liveness reason rather than a generic timeout:
 * 10 + 6*3 = 28s against a 30s request timeout.
 */
const PING_MAX_MISSED = 3;

const CREDENTIAL_BYTES = 32;

const textEncoder = new TextEncoder();
const isStrictCapabilities = Schema.is(HermesGatewayCapabilities);
const isProviderInstanceId = Schema.is(ProviderInstanceId);

type PluginMessage = Exclude<HermesGatewayPluginToT3Message, HermesGatewayConnectionHello>;
type RequestOwner = string;

const requestOwner = (instanceId: ProviderInstanceId, generation: number): RequestOwner =>
  `${instanceId}\0${generation}`;

/**
 * Durable enrollment facts, read from and written to the Hermes provider
 * instance config in settings.
 */
interface InstanceRecord {
  readonly nickname: string;
  readonly connectorUrl: string;
  readonly revoked: boolean;
}

/**
 * A Hermes instance can be *configured* (someone added the envelope) without
 * being *enrolled* (no plugin has ever been paired). Only enrollment produces
 * a connector URL, so its presence is what distinguishes the two. Status,
 * rename, and revoke all require an enrolled instance; create-enrollment and
 * remove deliberately accept a merely-configured one.
 */
const isEnrolled = (record: InstanceRecord) => record.connectorUrl !== "";

const credentialSecretName = (instanceId: ProviderInstanceId) =>
  `hermes-gateway-credential-${Buffer.from(instanceId, "utf8").toString("base64url")}`;

/** Legacy metadata blob location, read once at boot then deleted. */
const legacyMetadataSecretName = (instanceId: ProviderInstanceId) =>
  `hermes-gateway-metadata-${Buffer.from(instanceId, "utf8").toString("base64url")}`;

/**
 * Schema for the legacy secret-store metadata blob. Retained only so boot can
 * migrate pre-existing files into settings and delete them; nothing writes it.
 */
const LegacyInstanceMetadata = Schema.Struct({
  nickname: Schema.String,
  connectorUrl: Schema.String,
  revoked: Schema.Boolean,
  removed: Schema.optionalKey(Schema.Boolean),
});
type LegacyInstanceMetadata = typeof LegacyInstanceMetadata.Type;
const decodeLegacyMetadata = Schema.decodeUnknownEffect(
  // The blob also carried a `lastSeen` liveness object. It is intentionally
  // dropped: liveness is no longer persisted at all.
  Schema.fromJsonString(LegacyInstanceMetadata),
);

const managementError = (
  operation: HermesGatewayManagementError["operation"],
  code: HermesGatewayManagementError["code"],
  message: string,
  instanceId?: ProviderInstanceId,
) =>
  new HermesGatewayManagementError({
    operation,
    code,
    message,
    ...(instanceId ? { instanceId } : {}),
  });

const rejection = (
  requestId: HermesGatewayConnectionHello["requestId"],
  code: Extract<HermesGatewayT3ToPluginMessage, { readonly type: "connection.rejected" }>["code"],
  message: string,
): Extract<HermesGatewayT3ToPluginMessage, { readonly type: "connection.rejected" }> => ({
  type: "connection.rejected",
  requestId,
  code,
  message,
  expectedProtocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
});

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Constant-time credential comparison. The length pre-check is required:
 * `timingSafeEqual` throws on mismatched lengths, and comparing lengths first
 * leaks only the length, which is not secret.
 */
const credentialsEqual = (left: Uint8Array, right: string) => {
  const rightBytes = textEncoder.encode(right);
  return left.byteLength === rightBytes.byteLength && NodeCrypto.timingSafeEqual(left, rightBytes);
};

const normalizeNickname = (nickname: string) => nickname.trim();

const DEFAULT_HERMES_INSTANCE_ID = defaultInstanceIdForDriver(HERMES_DRIVER_KIND);

/**
 * Resolve an explicit Hermes instance, or synthesize the built-in default
 * slot from its legacy settings mirror. The provider registry and web settings
 * panel expose that same default slot before `providerInstances.hermes` has
 * ever been persisted; companion enrollment must accept what those surfaces
 * truthfully show. Custom instances still have to be explicit.
 */
const resolveHermesProviderInstance = (
  settings: ServerSettings,
  instanceId: ProviderInstanceId,
): ProviderInstanceConfig | undefined => {
  const explicit = settings.providerInstances[instanceId];
  if (explicit !== undefined) {
    return explicit.driver === HERMES_DRIVER_KIND ? explicit : undefined;
  }
  if (instanceId !== DEFAULT_HERMES_INSTANCE_ID) return undefined;
  return {
    driver: HERMES_DRIVER_KIND,
    enabled: settings.providers.hermes.enabled,
    config: settings.providers.hermes,
  };
};

/** Read a Hermes instance's durable config out of a settings envelope. */
const readHermesConfig = (config: ProviderInstanceConfig | undefined) => {
  if (!config || config.driver !== HERMES_DRIVER_KIND) return undefined;
  const raw = config.config;
  const blob = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    displayName: config.displayName,
    connectorUrl: typeof blob.connectorUrl === "string" ? blob.connectorUrl : undefined,
    revoked: blob.revoked === true,
  };
};

const recordFrom = (
  instanceId: ProviderInstanceId,
  config: ProviderInstanceConfig | undefined,
): InstanceRecord | undefined => {
  const hermes = readHermesConfig(config);
  if (!hermes) return undefined;
  return {
    nickname: hermes.displayName ?? instanceId,
    connectorUrl: hermes.connectorUrl ?? "",
    revoked: hermes.revoked,
  };
};

/** Merge durable config edits into an existing Hermes envelope. */
const withHermesConfig = (
  existing: ProviderInstanceConfig,
  patch: {
    readonly nickname?: string | undefined;
    readonly connectorUrl?: string | undefined;
    readonly revoked?: boolean | undefined;
  },
): ProviderInstanceConfig => {
  const currentConfig =
    existing.config && typeof existing.config === "object"
      ? (existing.config as Record<string, unknown>)
      : {};
  return {
    ...existing,
    ...(patch.nickname !== undefined ? { displayName: patch.nickname } : {}),
    config: {
      ...currentConfig,
      ...(patch.connectorUrl !== undefined ? { connectorUrl: patch.connectorUrl } : {}),
      ...(patch.revoked !== undefined ? { revoked: patch.revoked } : {}),
    },
  };
};

export const makeHermesGatewayBroker = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const settings = yield* ServerSettingsService;

  const connections = yield* makeHermesConnectionRegistry;
  const enrollmentStore = yield* makeHermesEnrollmentStore({ ttl: ENROLLMENT_TTL });
  const correlator = yield* makeRequestCorrelator<RequestOwner, PluginMessage>({
    provider: HERMES_DRIVER_KIND,
    timeout: REQUEST_TIMEOUT,
    maxAge: REQUEST_MAX_AGE,
  });

  const events = yield* PubSub.unbounded<HermesGatewayEnvelope>();
  const statusEvents = yield* PubSub.unbounded<HermesGatewayInstanceStatus>();

  /**
   * Per-instance enrollment lock. Serializes the read-modify-write of one
   * instance's durable config against itself without coupling unrelated
   * instances — and, critically, without gating the WebSocket handshake.
   */
  const enrollmentLocks = yield* Ref.make(new Map<ProviderInstanceId, Semaphore.Semaphore>());
  const withInstanceLock = <A, E, R>(
    instanceId: ProviderInstanceId,
    effect: Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const existing = (yield* Ref.get(enrollmentLocks)).get(instanceId);
      const semaphore = existing ?? (yield* Semaphore.make(1));
      if (!existing) {
        // Two fibers can reach here concurrently for a new instance; the
        // modify below keeps whichever landed first so both share one lock.
        const winner = yield* Ref.modify(enrollmentLocks, (current) => {
          const found = current.get(instanceId);
          if (found) return [found, current] as const;
          return [semaphore, new Map(current).set(instanceId, semaphore)] as const;
        });
        return yield* winner.withPermits(1)(effect);
      }
      return yield* semaphore.withPermits(1)(effect);
    });

  const readSettings = (operation: HermesGatewayManagementError["operation"]) =>
    settings.getSettings.pipe(
      Effect.mapError(() =>
        managementError(operation, "internal-error", "Failed to read server settings."),
      ),
    );

  /** Durable record for one instance, or `undefined` if not a Hermes instance. */
  const readRecord = (
    instanceId: ProviderInstanceId,
    operation: HermesGatewayManagementError["operation"],
  ) =>
    readSettings(operation).pipe(
      Effect.map((current) => recordFrom(instanceId, current.providerInstances[instanceId])),
    );

  const requireRecord = (
    instanceId: ProviderInstanceId,
    operation: HermesGatewayManagementError["operation"],
  ) =>
    readRecord(instanceId, operation).pipe(
      Effect.flatMap((record) =>
        record && isEnrolled(record)
          ? Effect.succeed(record)
          : Effect.fail(
              managementError(
                operation,
                "instance-not-found",
                record
                  ? `Hermes gateway instance '${instanceId}' has not been enrolled.`
                  : `Hermes gateway instance '${instanceId}' is not configured.`,
                instanceId,
              ),
            ),
      ),
    );

  /**
   * Compose a public status from the durable record plus volatile liveness.
   * `revoked` wins over everything: a revoked instance is revoked even if a
   * stale connection object has not been reaped yet.
   */
  const statusOf = (instanceId: ProviderInstanceId, record: InstanceRecord) =>
    connections.liveness(instanceId).pipe(
      Effect.map((liveness) => {
        const fields = livenessStatusFields(liveness);
        const { connected, upgradeRequired, capabilities, ...rest } = fields;
        return {
          ...rest,
          // A capability shape from a newer protocol is reported as null
          // rather than passed through as if T3 understood it.
          capabilities:
            capabilities !== null && isStrictCapabilities(capabilities) ? capabilities : null,
          instanceId,
          nickname: record.nickname,
          connectorUrl: record.connectorUrl,
          status: record.revoked
            ? "revoked"
            : upgradeRequired
              ? "upgrade-required"
              : connected
                ? "connected"
                : "offline",
        } satisfies HermesGatewayInstanceStatus;
      }),
    );

  const publishStatus = (instanceId: ProviderInstanceId, record: InstanceRecord) =>
    statusOf(instanceId, record).pipe(
      Effect.flatMap((status) => PubSub.publish(statusEvents, status)),
      Effect.asVoid,
    );

  /** Publish using whatever durable record settings currently holds. */
  const publishCurrentStatus = (
    instanceId: ProviderInstanceId,
    operation: HermesGatewayManagementError["operation"],
  ) =>
    readRecord(instanceId, operation).pipe(
      Effect.flatMap((record) => (record ? publishStatus(instanceId, record) : Effect.void)),
      Effect.ignore,
    );

  const failPendingRequests = (
    instanceId: ProviderInstanceId,
    generation: number,
    detail: string,
  ) => correlator.failOwner(requestOwner(instanceId, generation), detail);

  /**
   * Tear down a connection: fail its in-flight requests, then close the
   * socket. Ordering matters — callers waiting on a request should see the
   * specific reason rather than a generic disconnect.
   */
  const teardownConnection = (
    instanceId: ProviderInstanceId,
    connection: HermesActiveConnection,
    code: number,
    reason: string,
  ) =>
    failPendingRequests(instanceId, connection.generation, reason).pipe(
      Effect.andThen(connection.transport.close(code, reason)),
    );

  // ── Management operations ─────────────────────────────────────────

  const createEnrollment = (input: HermesGatewayCreateEnrollmentInput) =>
    withInstanceLock(
      input.instanceId,
      Effect.gen(function* () {
        const nickname = normalizeNickname(input.nickname);
        const currentSettings = yield* readSettings("create-enrollment");
        const configured = resolveHermesProviderInstance(currentSettings, input.instanceId);
        if (!configured) {
          return yield* managementError(
            "create-enrollment",
            "instance-not-found",
            `Provider instance '${input.instanceId}' is not configured with the Hermes driver.`,
            input.instanceId,
          );
        }

        // Invalidate the outgoing credential before anything else: from here
        // on the old credential must not authenticate, even if a later step
        // fails.
        yield* secretStore
          .remove(credentialSecretName(input.instanceId))
          .pipe(
            Effect.mapError(() =>
              managementError(
                "create-enrollment",
                "persistence-failed",
                "Failed to invalidate the previous Hermes gateway credential.",
                input.instanceId,
              ),
            ),
          );

        // A live socket authenticated with the credential just invalidated is
        // no longer trusted. Retire it before the settings write: if that write
        // fails, leaving the old socket registered would preserve indefinite
        // access with a credential that can no longer reconnect.
        const displaced = yield* connections.clearConnection(input.instanceId);
        if (displaced) {
          yield* teardownConnection(
            input.instanceId,
            displaced,
            4001,
            "A new enrollment was created for this instance",
          );
        }

        const committed = yield* settings
          .updateSettingsWith((latest) => {
            const latestConfigured = resolveHermesProviderInstance(latest, input.instanceId);
            if (!latestConfigured) return {};
            return {
              providerInstances: {
                ...latest.providerInstances,
                [input.instanceId]: withHermesConfig(latestConfigured, {
                  nickname,
                  connectorUrl: input.connectorUrl,
                  revoked: false,
                }),
              },
            };
          })
          .pipe(
            Effect.mapError(() =>
              managementError(
                "create-enrollment",
                "persistence-failed",
                "Failed to persist the Hermes gateway enrollment.",
                input.instanceId,
              ),
            ),
          );

        // Same committed-settings check `renameInstance` and `removeInstance`
        // make, and for the sharper reason: the callback above no-ops when the
        // instance vanished (or changed driver) between `readSettings` and the
        // write, and continuing would mint a token `registerConnection` can
        // only ever reject — handing the user a `hermes t3 connect` command
        // that fails with no explanation. Failing here says so instead.
        if (!recordFrom(input.instanceId, committed.providerInstances[input.instanceId])) {
          return yield* managementError(
            "create-enrollment",
            "instance-not-found",
            `Provider instance '${input.instanceId}' is no longer configured with the Hermes driver.`,
            input.instanceId,
          );
        }

        const { token, expiresAtMillis } = yield* enrollmentStore.mint({ ...input, nickname });

        const record: InstanceRecord = {
          nickname,
          connectorUrl: input.connectorUrl,
          revoked: false,
        };
        yield* publishStatus(input.instanceId, record);

        return {
          instanceId: input.instanceId,
          expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAtMillis)),
          connectorUrl: input.connectorUrl,
          command: `hermes t3 connect --url ${shellQuote(input.connectorUrl)} --token ${shellQuote(token)}`,
          // The long-lived credential is structurally absent here: it only
          // ever exists on the server→plugin `connection.accepted` frame.
          oneTimeToken: token,
        } satisfies HermesGatewayEnrollmentResult;
      }),
    );

  const getInstanceStatus = (instanceId: ProviderInstanceId) =>
    requireRecord(instanceId, "get-status").pipe(
      Effect.flatMap((record) => statusOf(instanceId, record)),
    );

  const listInstances = readSettings("list-instances").pipe(
    Effect.flatMap((currentSettings) =>
      Effect.forEach(
        Object.entries(currentSettings.providerInstances).filter(
          ([, config]) => config.driver === HERMES_DRIVER_KIND,
        ),
        ([rawId, config]) => {
          const instanceId = rawId as ProviderInstanceId;
          const record = recordFrom(instanceId, config);
          // Configured-but-never-enrolled instances have no gateway status to
          // report, so they are omitted rather than listed as offline.
          return record && isEnrolled(record)
            ? statusOf(instanceId, record)
            : Effect.succeed(undefined);
        },
        { concurrency: "unbounded" },
      ).pipe(Effect.map((values) => values.filter((value) => value !== undefined))),
    ),
  );

  /**
   * Rename is a pure display-name edit. Instance id is identity; the label is
   * free text like every other provider, so there is no uniqueness scan.
   */
  const renameInstance = (input: HermesGatewayRenameInstanceInput) =>
    withInstanceLock(
      input.instanceId,
      Effect.gen(function* () {
        const nickname = normalizeNickname(input.nickname);
        yield* requireRecord(input.instanceId, "rename-instance").pipe(
          Effect.mapError((error) =>
            managementError("rename-instance", error.code, error.message, input.instanceId),
          ),
        );

        const updated = yield* settings
          .updateSettingsWith((latest) => {
            const latestConfigured = latest.providerInstances[input.instanceId];
            if (!latestConfigured || latestConfigured.driver !== HERMES_DRIVER_KIND) return {};
            return {
              providerInstances: {
                ...latest.providerInstances,
                [input.instanceId]: withHermesConfig(latestConfigured, { nickname }),
              },
            };
          })
          .pipe(
            Effect.mapError(() =>
              managementError(
                "rename-instance",
                "persistence-failed",
                "Failed to persist the Hermes instance display name.",
                input.instanceId,
              ),
            ),
          );

        // The update callback is a pure function of `latest`, so the committed
        // settings are the single source of truth for whether it applied —
        // no side-channel flag needed.
        const record = recordFrom(input.instanceId, updated.providerInstances[input.instanceId]);
        if (!record) {
          return yield* managementError(
            "rename-instance",
            "instance-not-found",
            `Provider instance '${input.instanceId}' is no longer configured with the Hermes driver.`,
            input.instanceId,
          );
        }

        yield* publishStatus(input.instanceId, record);
        return (yield* statusOf(
          input.instanceId,
          record,
        )) satisfies HermesGatewayRenameInstanceResult;
      }),
    );

  const revokeInstance = (instanceId: ProviderInstanceId) =>
    withInstanceLock(
      instanceId,
      Effect.gen(function* () {
        const existing = yield* requireRecord(instanceId, "revoke-instance").pipe(
          Effect.mapError((error) =>
            managementError("revoke-instance", error.code, error.message, instanceId),
          ),
        );

        yield* settings
          .updateSettingsWith((latest) => {
            const latestConfigured = latest.providerInstances[instanceId];
            if (!latestConfigured || latestConfigured.driver !== HERMES_DRIVER_KIND) return {};
            return {
              providerInstances: {
                ...latest.providerInstances,
                [instanceId]: withHermesConfig(latestConfigured, { revoked: true }),
              },
            };
          })
          .pipe(
            Effect.mapError(() =>
              managementError(
                "revoke-instance",
                "persistence-failed",
                "Failed to persist the Hermes gateway revocation.",
                instanceId,
              ),
            ),
          );

        const record: InstanceRecord = { ...existing, revoked: true };
        yield* enrollmentStore.forget(instanceId);

        const cleared = yield* connections.clearConnection(instanceId);
        if (cleared) {
          yield* teardownConnection(
            instanceId,
            cleared,
            4003,
            "The Hermes gateway credential was revoked.",
          );
        }
        yield* publishStatus(instanceId, record);

        // Credential removal is last and is allowed to fail loudly: revocation
        // is already durable in settings, so a reconnect is refused either way.
        yield* secretStore
          .remove(credentialSecretName(instanceId))
          .pipe(
            Effect.mapError(() =>
              managementError(
                "revoke-instance",
                "persistence-failed",
                "Failed to remove the Hermes gateway credential.",
                instanceId,
              ),
            ),
          );

        return (yield* statusOf(instanceId, record)) satisfies HermesGatewayRevokeInstanceResult;
      }),
    );

  const removeInstance = (instanceId: ProviderInstanceId) =>
    withInstanceLock(
      instanceId,
      Effect.gen(function* () {
        const record = yield* readRecord(instanceId, "remove-instance");
        if (!record) {
          return yield* managementError(
            "remove-instance",
            "instance-not-found",
            `Hermes gateway instance '${instanceId}' is not configured or enrolled.`,
            instanceId,
          );
        }
        // An enrolled instance must be revoked first so its credential is
        // invalidated before the config that describes it disappears.
        if (isEnrolled(record) && !record.revoked) {
          return yield* managementError(
            "remove-instance",
            "instance-not-revoked",
            "Revoke the Hermes gateway instance before removing it.",
            instanceId,
          );
        }

        const updated = yield* settings
          .updateSettingsWith((current) => {
            const configured = current.providerInstances[instanceId];
            if (!configured || configured.driver !== HERMES_DRIVER_KIND) return {};
            const currentConfig =
              configured.config && typeof configured.config === "object"
                ? (configured.config as Record<string, unknown>)
                : {};
            const {
              connectorUrl: _connectorUrl,
              homeThreadId: _homeThreadId,
              revoked: _revoked,
              ...remainingConfig
            } = currentConfig;
            return {
              providerInstances: {
                ...current.providerInstances,
                // Removing the optional companion must not remove the Hermes
                // ACP provider. Preserve its ordinary ACP settings while
                // clearing enrollment and the companion-owned Home mapping.
                // The old thread and its history remain in T3, but a later
                // enrollment gets a fresh authoritative Home designation.
                [instanceId]: { ...configured, config: remainingConfig },
              },
            };
          })
          .pipe(
            Effect.mapError(() =>
              managementError(
                "remove-instance",
                "persistence-failed",
                "Failed to remove the Hermes companion enrollment from server settings.",
                instanceId,
              ),
            ),
          );
        const remaining = readHermesConfig(updated.providerInstances[instanceId]);
        const remainingConfig = updated.providerInstances[instanceId]?.config;
        const remainingBlob =
          remainingConfig && typeof remainingConfig === "object"
            ? (remainingConfig as Record<string, unknown>)
            : {};
        if (
          !remaining ||
          remaining.connectorUrl !== undefined ||
          remaining.revoked ||
          remainingBlob.homeThreadId !== undefined
        ) {
          return yield* managementError(
            "remove-instance",
            "persistence-failed",
            `Hermes companion enrollment '${instanceId}' could not be removed.`,
            instanceId,
          );
        }

        yield* enrollmentStore.forget(instanceId);
        const cleared = yield* connections.clearConnection(instanceId);
        if (cleared) {
          yield* teardownConnection(
            instanceId,
            cleared,
            4003,
            "The Hermes gateway instance was removed.",
          );
        }
        yield* connections.forget(instanceId);

        // Clearing companion config is the authoritative act; a failure to
        // delete the now-unreferenced credential is logged, not surfaced.
        yield* secretStore.remove(credentialSecretName(instanceId)).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Failed to clean up a removed Hermes companion credential", {
              instanceId,
              error,
            }),
          ),
        );
        return { instanceId } satisfies HermesGatewayRemoveInstanceResult;
      }),
    );

  // ── Connection lifecycle ──────────────────────────────────────────

  /**
   * Ping loop for one connection. Forked into the connection's scope, so it is
   * interrupted precisely when that connection is retired or replaced.
   *
   * A missed pong is not immediately fatal — a busy plugin can be slow — but
   * `PING_MAX_MISSED` consecutive misses mean the socket is half-open, and we
   * stop pretending otherwise.
   */
  const pingLoop = (
    registration: HermesGatewayConnectionRegistration,
    transport: HermesGatewayTransport,
  ) =>
    Effect.gen(function* () {
      if (registration.generation === null) return;
      const generation = registration.generation;
      const missed = yield* Ref.make(0);

      const probe = Effect.gen(function* () {
        const requestId = `hermes-ping-${registration.instanceId}-${generation}-${yield* Clock.currentTimeMillis}`;
        const outcome = yield* correlator
          .request({
            owner: requestOwner(registration.instanceId, generation),
            requestId,
            method: "ping",
            timeout: PING_TIMEOUT,
            send: transport.send({
              type: "ping",
              protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
              requestId: requestId as HermesGatewayConnectionHello["requestId"],
              sentAt: DateTime.formatIso(yield* DateTime.now),
            }),
          })
          .pipe(Effect.result);

        if (outcome._tag === "Success") {
          yield* Ref.set(missed, 0);
          // Healthy: wait a full interval before probing again.
          return yield* Effect.sleep(PING_INTERVAL);
        }

        const missedCount = yield* Ref.updateAndGet(missed, (value) => value + 1);
        // Once a ping is missed, re-probe immediately rather than idling for
        // another interval: the point is to confirm or clear the suspicion
        // fast enough that in-flight requests get the real reason instead of
        // a generic timeout.
        if (missedCount < PING_MAX_MISSED) return;

        yield* Effect.logWarning("Hermes gateway connection failed liveness checks", {
          instanceId: registration.instanceId,
          missedCount,
        });
        // Retire before closing: `disconnect` is generation-fenced, so if a
        // replacement already landed this is a no-op and we leave it alone.
        const retired = yield* connections.disconnect(registration);
        if (retired) {
          yield* publishCurrentStatus(registration.instanceId, "get-status");
          yield* teardownConnection(
            registration.instanceId,
            retired,
            4008,
            "The Hermes gateway connection stopped responding.",
          );
        }
        // This connection is gone either way — retired here, or already
        // replaced. Stop probing rather than interrogating a dead socket and
        // logging another miss for a connection nobody is using.
        return yield* Effect.interrupt;
      });

      // First probe runs after one interval — long enough that a plugin which
      // just completed the handshake is not immediately re-interrogated. The
      // pacing of subsequent probes lives inside `probe` itself, because a
      // healthy connection and a suspected-dead one warrant different delays.
      yield* Effect.sleep(PING_INTERVAL);
      yield* probe.pipe(Effect.forever, Effect.ignoreCause({ log: true }));
    });

  /**
   * Handshake authentication: prove the caller holds a live credential or a
   * live enrollment token, and resolve the instance it is speaking for.
   *
   * Deliberately a pure read. Nothing here mutates broker state, which is what
   * makes it safe to run twice — once before the instance lock is taken, so an
   * unauthenticated caller never joins the lock queue, and again inside it, so
   * the facts the mutation section acts on were re-read after every competing
   * enrollment or revocation had to finish.
   */
  const authenticateHello = (hello: HermesGatewayConnectionHello) =>
    Effect.gen(function* () {
      let instanceId: ProviderInstanceId;
      let enrollment: PendingEnrollment | undefined;

      if (hello.authentication.type === "enrollment-token") {
        const authentication = hello.authentication;
        const pending = yield* enrollmentStore.peek(authentication.token);
        if (!pending) {
          return yield* Effect.fail(
            rejection(
              hello.requestId,
              "enrollment-expired",
              "The enrollment token is invalid, expired, or already used.",
            ),
          );
        }
        instanceId = pending.input.instanceId;
        enrollment = pending;
      } else {
        const authentication = hello.authentication;
        instanceId = authentication.instanceId;
        const stored = yield* secretStore
          .get(credentialSecretName(instanceId))
          .pipe(
            Effect.mapError(() =>
              rejection(
                hello.requestId,
                "internal-error",
                "Failed to read the gateway credential.",
              ),
            ),
          );
        if (Option.isNone(stored) || !credentialsEqual(stored.value, authentication.credential)) {
          return yield* Effect.fail(
            rejection(
              hello.requestId,
              "invalid-authentication",
              "The Hermes gateway credential is invalid.",
            ),
          );
        }
      }

      const record = yield* readRecord(instanceId, "get-status").pipe(
        Effect.mapError(() =>
          rejection(
            hello.requestId,
            "internal-error",
            "Failed to validate the Hermes gateway provider instance.",
          ),
        ),
      );
      if (!record) {
        return yield* Effect.fail(
          rejection(
            hello.requestId,
            "invalid-authentication",
            "The Hermes gateway provider instance is no longer configured.",
          ),
        );
      }
      if (record.revoked) {
        return yield* Effect.fail(
          rejection(
            hello.requestId,
            "instance-revoked",
            "This Hermes gateway instance has been revoked.",
          ),
        );
      }

      return { instanceId, enrollment, record } as const;
    });

  const registerConnection = (
    hello: HermesGatewayConnectionHello,
    transport: HermesGatewayTransport,
  ) =>
    Effect.gen(function* () {
      const strictCapabilities = isStrictCapabilities(hello.capabilities)
        ? hello.capabilities
        : undefined;

      // ── Phase 1: authenticate, unlocked. Nothing below this line mutates
      // connection state, and nothing above it is allowed to. An earlier bug
      // applied "incompatible version" state before checking the credential,
      // letting an unauthenticated caller knock a healthy instance offline;
      // the test "authenticates before applying incompatible connection state"
      // guards this ordering. Running it before the lock also keeps a caller
      // with a junk credential from queueing behind an in-flight enrollment.
      const preliminary = yield* authenticateHello(hello);

      // ── Phase 2: the caller is authenticated. State changes may begin —
      // under the instance's enrollment lock, so `createEnrollment`,
      // `revokeInstance`, and `removeInstance` cannot interleave with token
      // redemption, credential persistence, or acceptance.
      //
      // Everything inside is bounded and takes no other lock: settings reads
      // are a `Ref.get`, and `teardownConnection` only fails correlated
      // requests and closes the *displaced* socket — never the one currently
      // handshaking, which is not in the registry yet. So the WS accept path
      // cannot deadlock against a displaced connection's teardown.
      return yield* withInstanceLock(
        preliminary.instanceId,
        Effect.gen(function* () {
          // Re-read every fact behind the lock. The pre-lock pass was only a
          // filter: between it and here a `createEnrollment` may have removed
          // the credential and superseded the token, or a `revokeInstance` may
          // have marked the instance revoked and cleared its connection. Both
          // are now visible, and both reject.
          const {
            instanceId,
            enrollment: authenticatedEnrollment,
            record,
          } = yield* authenticateHello(hello);
          if (instanceId !== preliminary.instanceId) {
            // The lock we hold is the wrong one, so this cannot proceed
            // safely. Only reachable if a token were re-pointed at another
            // instance, which minting never does.
            return yield* Effect.fail(
              rejection(
                hello.requestId,
                "invalid-authentication",
                "The Hermes gateway enrollment changed during the handshake.",
              ),
            );
          }

          if (
            hello.protocolVersion !== HERMES_GATEWAY_PROTOCOL_VERSION ||
            strictCapabilities === undefined
          ) {
            const displaced = yield* connections.markUpgradeRequired({
              instanceId,
              upgradeRequired: {
                pluginVersion: hello.pluginVersion,
                hermesVersion: hello.hermesVersion,
                protocolVersion: hello.protocolVersion,
                model: hello.model ?? null,
              },
            });
            if (displaced) {
              yield* teardownConnection(
                instanceId,
                displaced,
                4004,
                "The Hermes gateway plugin requires a protocol upgrade.",
              );
            }
            yield* publishStatus(instanceId, record);
            // Names the fix, not just the mismatch: the rejection text is what
            // a v3 (pre-media) plugin's operator sees in its logs. A
            // right-version hello can still land here when its capabilities
            // don't satisfy the v4 contract (e.g. `attachments: false`), so
            // say which it was.
            return yield* Effect.fail(
              rejection(
                hello.requestId,
                "version-incompatible",
                hello.protocolVersion !== HERMES_GATEWAY_PROTOCOL_VERSION
                  ? `Expected protocol version ${HERMES_GATEWAY_PROTOCOL_VERSION}, received ${hello.protocolVersion}. Upgrade the T3 Code gateway plugin on the Hermes host to reconnect.`
                  : `The advertised capabilities do not satisfy the version ${HERMES_GATEWAY_PROTOCOL_VERSION} contract. Upgrade the T3 Code gateway plugin on the Hermes host to reconnect.`,
              ),
            );
          }

          let credential: HermesGatewayCredential | undefined;
          if (hello.authentication.type === "enrollment-token" && authenticatedEnrollment) {
            const authentication = hello.authentication;
            const consumed = yield* enrollmentStore.consume(
              authentication.token,
              authenticatedEnrollment,
            );
            if (!consumed) {
              return yield* Effect.fail(
                rejection(
                  hello.requestId,
                  "enrollment-expired",
                  "The enrollment token is invalid, expired, or already used.",
                ),
              );
            }
            credential = HermesGatewayCredential.make(
              Encoding.encodeBase64Url(
                yield* crypto
                  .randomBytes(CREDENTIAL_BYTES)
                  .pipe(
                    Effect.mapError(() =>
                      rejection(
                        hello.requestId,
                        "internal-error",
                        "Failed to generate the Hermes gateway credential.",
                      ),
                    ),
                  ),
              ),
            );
            yield* secretStore
              .set(credentialSecretName(instanceId), textEncoder.encode(credential))
              .pipe(
                Effect.mapError(() =>
                  rejection(
                    hello.requestId,
                    "internal-error",
                    "Failed to persist the Hermes gateway credential.",
                  ),
                ),
              );
          }
          const authorizationCredential =
            credential ??
            (hello.authentication.type === "instance-credential"
              ? hello.authentication.credential
              : undefined);
          if (authorizationCredential === undefined) {
            return yield* Effect.fail(
              rejection(
                hello.requestId,
                "internal-error",
                "The Hermes gateway connection has no authenticated credential.",
              ),
            );
          }

          // ── Delivery connections: authenticated, but never the primary.
          //
          // An out-of-process cron run dials in only to hand over a
          // `home.deliver` and leave. Registering it would displace the
          // instance's live gateway socket ("replaced by a newer connection")
          // and bump the generation, knocking the real plugin offline for the
          // duration of a cron job. So it is accepted and then deliberately
          // left out of the connection registry: no generation, no liveness
          // ping, no status publish, nothing to disconnect. The existing
          // primary is untouched.
          if (hello.role === "delivery") {
            return {
              instanceId,
              authorizationCredential,
              generation: null,
              role: "delivery",
              accepted: {
                type: "connection.accepted",
                requestId: hello.requestId,
                protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
                instanceId,
                nickname: record.nickname,
                ...(credential ? { credential } : {}),
              },
            } as const satisfies HermesGatewayConnectionRegistration;
          }

          const observed: HermesObservedConnection = {
            pluginVersion: hello.pluginVersion,
            hermesVersion: hello.hermesVersion,
            capabilities: strictCapabilities,
            model: hello.model ?? null,
            connectedAt: DateTime.formatIso(yield* DateTime.now),
            activeSessionCount: 0,
          };
          const accepted = yield* connections.accept({ instanceId, transport, observed });
          if (accepted.displaced) {
            yield* teardownConnection(
              instanceId,
              accepted.displaced,
              4001,
              "The Hermes gateway connection was replaced by a newer connection.",
            );
          }

          const registration = {
            instanceId,
            authorizationCredential,
            generation: accepted.generation,
            role: "gateway",
            accepted: {
              type: "connection.accepted",
              requestId: hello.requestId,
              protocolVersion: HERMES_GATEWAY_PROTOCOL_VERSION,
              instanceId,
              nickname: record.nickname,
              ...(credential ? { credential } : {}),
            },
          } as const satisfies HermesGatewayConnectionRegistration;

          // Liveness probing belongs to this connection's scope, so it is
          // interrupted the moment the connection is retired.
          const liveness = yield* connections.liveness(instanceId);
          if (liveness?.connection?.generation === accepted.generation) {
            yield* pingLoop(registration, transport).pipe(Effect.forkIn(liveness.connection.scope));
          }

          yield* publishStatus(instanceId, record);
          return registration;
        }),
      );
    });

  const authorizationError = (registration: HermesGatewayConnectionRegistration, detail: string) =>
    new ProviderAdapterRequestError({
      provider: HERMES_DRIVER_KIND,
      method: "connection.authorize",
      detail: `Hermes gateway instance '${registration.instanceId}' ${detail}`,
    });

  const withAuthorizedConnection: HermesGatewayBrokerShape["withAuthorizedConnection"] = (
    registration,
    effect,
  ) =>
    withInstanceLock(
      registration.instanceId,
      Effect.gen(function* () {
        if (registration.role === "gateway") {
          const active = yield* connections.connection(registration.instanceId);
          if (active?.generation !== registration.generation) {
            return yield* authorizationError(registration, "connection is no longer active.");
          }
        } else {
          // Delivery sockets are intentionally absent from the primary
          // registry, so they cannot be closed by `clearConnection`. Re-check
          // their credential under the same lifecycle lock used by revoke and
          // re-enrollment; a socket authenticated before either operation
          // cannot submit another delivery after that operation returns.
          const record = yield* readRecord(registration.instanceId, "get-status").pipe(
            Effect.mapError(() =>
              authorizationError(registration, "authorization could not be read."),
            ),
          );
          const stored = yield* secretStore
            .get(credentialSecretName(registration.instanceId))
            .pipe(
              Effect.mapError(() =>
                authorizationError(registration, "credential could not be verified."),
              ),
            );
          if (
            !record ||
            record.revoked ||
            Option.isNone(stored) ||
            !credentialsEqual(stored.value, registration.authorizationCredential)
          ) {
            return yield* authorizationError(registration, "connection is no longer authorized.");
          }
        }
      }),
    ).pipe(Effect.andThen(effect));

  const receive = (registration: HermesGatewayConnectionRegistration, message: PluginMessage) =>
    withAuthorizedConnection(
      registration,
      Effect.gen(function* () {
        // A delivery connection's frames — `home.deliver` and `media.deliver` —
        // are handled at the transport layer, because their acks have to go back
        // to that specific short-lived socket. Anything else it sends is outside
        // its remit and is dropped here: it holds no session, so completing a
        // correlated request or publishing a status off it would let a throwaway
        // cron socket speak for the live connection.
        if (registration.role === "delivery") return;

        if (message.type === "connection.status") {
          const applied = yield* connections.recordSessionCount(
            registration,
            message.activeSessionCount,
          );
          if (!applied) return;
          yield* publishCurrentStatus(registration.instanceId, "get-status");
        }

        if ("requestId" in message && message.requestId) {
          yield* correlator.complete(message.requestId, message);
        }
        yield* PubSub.publish(events, { instanceId: registration.instanceId, message });
      }),
    );

  const disconnect = (registration: HermesGatewayConnectionRegistration) =>
    Effect.gen(function* () {
      // Delivery sockets close as a matter of course — that is their whole
      // lifecycle. They were never in the registry, so retiring one must not
      // touch the instance's liveness or fail the live connection's requests.
      if (registration.role === "delivery") return;
      const retired = yield* connections.disconnect(registration);
      if (!retired) return;
      yield* publishCurrentStatus(registration.instanceId, "get-status");
      yield* failPendingRequests(
        registration.instanceId,
        retired.generation,
        "The Hermes gateway connection disconnected.",
      );
    });

  // ── Messaging ─────────────────────────────────────────────────────

  const send = (instanceId: ProviderInstanceId, message: HermesGatewayT3ToPluginMessage) =>
    connections.transport(instanceId).pipe(
      Effect.flatMap((transport) =>
        transport
          ? transport.send(message)
          : Effect.fail(
              new ProviderAdapterRequestError({
                provider: HERMES_DRIVER_KIND,
                method: message.type,
                detail: `Hermes gateway instance '${instanceId}' is offline.`,
              }),
            ),
      ),
    );

  const request = (instanceId: ProviderInstanceId, message: HermesGatewayT3ToPluginMessage) => {
    if (!("requestId" in message) || !message.requestId) {
      return Effect.fail(
        new ProviderAdapterRequestError({
          provider: HERMES_DRIVER_KIND,
          method: message.type,
          detail: "A correlated Hermes gateway request requires a request id.",
        }),
      );
    }
    const requestId = message.requestId;
    return Effect.gen(function* () {
      const connection = yield* connections.connection(instanceId);
      if (!connection) {
        return yield* new ProviderAdapterRequestError({
          provider: HERMES_DRIVER_KIND,
          method: message.type,
          detail: `Hermes gateway instance '${instanceId}' is offline.`,
        });
      }
      return yield* correlator.request({
        owner: requestOwner(instanceId, connection.generation),
        requestId,
        method: message.type,
        // Re-check after the correlator registers the waiter. If replacement
        // won before this point, fail immediately; if it wins after this
        // check, teardown fails this exact generation's pending requests.
        send: connections.connection(instanceId).pipe(
          Effect.flatMap((current) =>
            current?.generation === connection.generation
              ? connection.transport.send(message)
              : Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: HERMES_DRIVER_KIND,
                    method: message.type,
                    detail: `Hermes gateway instance '${instanceId}' reconnected before the request was sent.`,
                  }),
                ),
          ),
        ),
      });
    });
  };

  // ── Boot: migrate legacy metadata, then start sweepers ────────────

  const LEGACY_METADATA_PREFIX = "hermes-gateway-metadata-";

  /**
   * Recover instance ids from legacy metadata filenames in the secrets
   * directory. `ServerSecretStore` has no listing API, and an orphaned blob is
   * by definition one that settings no longer references — so without this
   * scan the exact files we most need to clean up are unreachable.
   *
   * Entirely best-effort: no config, no filesystem, or an unreadable directory
   * all degrade to "found nothing" rather than failing boot.
   */
  const discoverLegacyMetadataInstanceIds = Effect.gen(function* () {
    const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
    const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
    if (Option.isNone(config) || Option.isNone(fs)) return [];

    const entries = yield* fs.value
      .readDirectory(config.value.secretsDir)
      .pipe(Effect.orElseSucceed(() => [] as Array<string>));

    return entries.flatMap((entry) => {
      const base = entry.endsWith(".bin") ? entry.slice(0, -".bin".length) : entry;
      if (!base.startsWith(LEGACY_METADATA_PREFIX)) return [];
      const encoded = base.slice(LEGACY_METADATA_PREFIX.length);
      const decodedId = Buffer.from(encoded, "base64url").toString("utf8");
      // Round-trip guard: only accept names this scheme could have produced.
      if (Buffer.from(decodedId, "utf8").toString("base64url") !== encoded) return [];
      return isProviderInstanceId(decodedId) ? [decodedId] : [];
    });
  }).pipe(Effect.orElseSucceed(() => [] as Array<ProviderInstanceId>));

  /**
   * Fold pre-existing secret-store metadata blobs into settings and delete
   * them. Ordering is deliberate: the settings write must succeed before the
   * secret file is deleted, so a crash in between re-runs the migration rather
   * than losing the enrollment facts.
   */
  const migrateLegacyMetadata = Effect.gen(function* () {
    const currentSettings = yield* settings.getSettings;
    const defaultInstanceId = defaultInstanceIdForDriver(HERMES_DRIVER_KIND);
    const candidates = new Set<ProviderInstanceId>([
      defaultInstanceId,
      ...Object.entries(currentSettings.providerInstances)
        .filter(([, config]) => config.driver === HERMES_DRIVER_KIND)
        .map(([rawId]) => rawId as ProviderInstanceId),
      // The real orphans are precisely the ones settings no longer mentions,
      // so scanning the secrets directory is the only way to find them. The
      // store has no listing API; reading the directory directly is
      // best-effort and never fatal.
      ...(yield* discoverLegacyMetadataInstanceIds),
    ]);

    for (const instanceId of candidates) {
      const secretName = legacyMetadataSecretName(instanceId);
      const stored = yield* secretStore.get(secretName);
      if (Option.isNone(stored)) continue;

      const decoded = yield* decodeLegacyMetadata(new TextDecoder().decode(stored.value)).pipe(
        Effect.result,
      );
      if (decoded._tag === "Failure") {
        yield* Effect.logWarning("Discarding unreadable legacy Hermes gateway metadata", {
          instanceId,
        });
        yield* secretStore.remove(secretName).pipe(Effect.ignore);
        continue;
      }
      const metadata: LegacyInstanceMetadata = decoded.success;

      const configured = currentSettings.providerInstances[instanceId];
      const isHermesInstance = configured?.driver === HERMES_DRIVER_KIND;

      // A tombstone, or a blob for an instance nobody configures any more, has
      // nothing to fold into. Drop the file and the orphaned credential — this
      // is the leak the old code never cleaned up, because the tombstone name
      // was only ever passed to get/set and never to remove.
      if (metadata.removed || !isHermesInstance) {
        yield* secretStore.remove(secretName).pipe(Effect.ignore);
        yield* secretStore.remove(credentialSecretName(instanceId)).pipe(Effect.ignore);
        continue;
      }

      const committed = yield* settings
        .updateSettingsWith((latest) => {
          const latestConfigured = latest.providerInstances[instanceId];
          if (!latestConfigured || latestConfigured.driver !== HERMES_DRIVER_KIND) return {};
          const existing = readHermesConfig(latestConfigured);
          return {
            providerInstances: {
              ...latest.providerInstances,
              [instanceId]: withHermesConfig(latestConfigured, {
                // Settings already win where they carry a value; the blob only
                // fills gaps.
                nickname: latestConfigured.displayName ?? metadata.nickname,
                connectorUrl: existing?.connectorUrl ?? metadata.connectorUrl,
                revoked: existing?.revoked === true ? true : metadata.revoked,
              }),
            },
          };
        })
        .pipe(Effect.result);

      if (committed._tag === "Failure") {
        yield* Effect.logWarning("Deferring Hermes gateway metadata migration", { instanceId });
        continue;
      }

      const migrated = recordFrom(instanceId, committed.success.providerInstances[instanceId]);
      if (!migrated) {
        yield* Effect.logWarning("Deferring Hermes gateway metadata migration", { instanceId });
        continue;
      }

      // Only now, with the durable equivalent committed, is the blob
      // redundant. The credential is kept: this instance is still configured
      // and its plugin must be able to reconnect.
      yield* secretStore.remove(secretName).pipe(Effect.ignore);
      if (migrated.revoked) {
        yield* secretStore.remove(credentialSecretName(instanceId)).pipe(Effect.ignore);
      }
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to migrate legacy Hermes gateway metadata", { cause }),
    ),
  );

  yield* migrateLegacyMetadata;

  // Bounded memory: expired tokens and abandoned request entries are reaped
  // on a timer rather than only lazily at redemption.
  yield* enrollmentStore.sweep.pipe(
    Effect.andThen(correlator.sweep),
    Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
  );

  return {
    createEnrollment,
    getInstanceStatus,
    listInstances,
    renameInstance,
    revokeInstance,
    removeInstance,
    registerConnection,
    withAuthorizedConnection,
    receive,
    disconnect,
    request,
    send,
    isConnected: connections.isConnected,
    stream: Stream.fromPubSub(events),
    streamStatuses: Stream.fromPubSub(statusEvents),
  } satisfies HermesGatewayBrokerShape;
});

export const HermesGatewayBrokerLive = Layer.effect(HermesGatewayBroker, makeHermesGatewayBroker);

/** Exported so tests can seed and assert on migration inputs by exact name. */
export const hermesGatewayLegacyMetadataSecretName = legacyMetadataSecretName;
export const hermesGatewayCredentialSecretName = credentialSecretName;
