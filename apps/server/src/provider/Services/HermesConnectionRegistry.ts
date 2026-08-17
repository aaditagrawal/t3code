/**
 * HermesConnectionRegistry — owner of **volatile** Hermes gateway liveness.
 *
 * Everything in here is deliberately memory-only and is never persisted:
 * the live connection, its transport, `lastSeen`, `activeSessionCount`, the
 * reported model, and the `upgrade-required` observation.
 *
 * Why liveness must not be persisted
 * ----------------------------------
 * `ProviderInstanceRegistryLive.reconcile` structurally compares each
 * `ProviderInstanceConfig` envelope and closes the instance scope on **any**
 * change. Closing that scope runs `HermesAdapter`'s finalizer, which calls
 * `stopAll()` and sends `session.stop` to Hermes for every live thread. So
 * writing something like `connectedAt` into the instance config on every
 * connect would tear down every Hermes session on every reconnect.
 *
 * The broker (and therefore this registry) is a top-level layer that survives
 * reconcile, which makes it the correct owner of liveness. The accepted
 * consequence is that after a T3 server restart the UI reports "never
 * connected" until the plugin dials back in. That is intended.
 *
 * Generation fencing
 * ------------------
 * Every accepted connection gets a monotonically increasing generation. All
 * post-acceptance mutations are fenced on it, and the comparison happens
 * *inside* the `Ref` update rather than as a separate read, so a replacement
 * landing concurrently cannot be clobbered by a stale writer (TOCTOU).
 *
 * @module HermesConnectionRegistry
 */
import type {
  HermesGatewayCapabilities,
  HermesGatewayInstanceStatus,
  ProviderInstanceId,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type {
  HermesGatewayConnectionRegistration,
  HermesGatewayTransport,
} from "./HermesGatewayBroker.ts";

/** Observed facts about a plugin connection, independent of its transport. */
export interface HermesObservedConnection {
  readonly pluginVersion: string;
  readonly hermesVersion: string;
  readonly capabilities: HermesGatewayCapabilities;
  /** Model reported at handshake. Null when the plugin predates the field. */
  readonly model: string | null;
  readonly connectedAt: string;
  readonly activeSessionCount: number;
}

export interface HermesActiveConnection extends HermesObservedConnection {
  readonly generation: number;
  readonly transport: HermesGatewayTransport;
  /**
   * Scope tied to this connection's lifetime. Per-connection fibers (the ping
   * loop) are forked into it, so they die exactly when the connection does.
   */
  readonly scope: Scope.Closeable;
}

export interface HermesUpgradeRequired {
  readonly pluginVersion: string;
  readonly hermesVersion: string;
  readonly protocolVersion: number;
  readonly model: string | null;
}

/** Volatile per-instance liveness. Absent entry means "nothing observed yet". */
export interface HermesInstanceLiveness {
  readonly connection?: HermesActiveConnection | undefined;
  readonly lastSeen?: HermesObservedConnection | undefined;
  readonly upgradeRequired?: HermesUpgradeRequired | undefined;
}

export interface HermesAcceptedConnection {
  readonly generation: number;
  /**
   * The connection this one displaced, if any. The caller is responsible for
   * closing it — the registry never touches a transport itself, so callers can
   * order the close against failing pending requests.
   */
  readonly displaced: HermesActiveConnection | undefined;
}

export interface HermesConnectionRegistry {
  /** Current liveness for one instance, or `undefined` if nothing observed. */
  readonly liveness: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<HermesInstanceLiveness | undefined>;

  /** Accept a connection, assigning it the next generation. */
  readonly accept: (input: {
    readonly instanceId: ProviderInstanceId;
    readonly transport: HermesGatewayTransport;
    readonly observed: HermesObservedConnection;
  }) => Effect.Effect<HermesAcceptedConnection>;

  /**
   * Record an incompatible plugin. Clears any live connection for the instance
   * and returns it so the caller can close it.
   */
  readonly markUpgradeRequired: (input: {
    readonly instanceId: ProviderInstanceId;
    readonly upgradeRequired: HermesUpgradeRequired;
  }) => Effect.Effect<HermesActiveConnection | undefined>;

  /**
   * Update the active session count. Generation-fenced; returns `false` when
   * the registration is stale, in which case nothing was written.
   */
  readonly recordSessionCount: (
    registration: HermesGatewayConnectionRegistration,
    activeSessionCount: number,
  ) => Effect.Effect<boolean>;

  /**
   * Retire a connection, demoting it to `lastSeen`. Generation-fenced;
   * returns the retired connection, or `undefined` when the registration is
   * stale (already replaced) and nothing was changed.
   */
  readonly disconnect: (
    registration: HermesGatewayConnectionRegistration,
  ) => Effect.Effect<HermesActiveConnection | undefined>;

  /**
   * Clear the live connection for an instance regardless of generation, e.g.
   * on revoke. Returns it so the caller can close the transport.
   */
  readonly clearConnection: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<HermesActiveConnection | undefined>;

  /** Drop all liveness for an instance (on remove). */
  readonly forget: (instanceId: ProviderInstanceId) => Effect.Effect<void>;

  /** Whether a live connection exists. */
  readonly isConnected: (instanceId: ProviderInstanceId) => Effect.Effect<boolean>;

  /** Current active connection, including its generation, if connected. */
  readonly connection: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<HermesActiveConnection | undefined>;

  /** Live transport for an instance, if connected. */
  readonly transport: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<HermesGatewayTransport | undefined>;
}

/**
 * Project the status fields owned by liveness. The durable half (nickname,
 * connectorUrl, revoked) is layered on by the broker, which reads it from
 * settings.
 */
export type HermesLivenessStatusFields = Pick<
  HermesGatewayInstanceStatus,
  | "lastConnectedAt"
  | "pluginVersion"
  | "hermesVersion"
  | "model"
  | "activeSessionCount"
  | "protocolVersion"
  | "capabilities"
  | "connectionGeneration"
> & {
  readonly connected: boolean;
  readonly upgradeRequired: boolean;
};
