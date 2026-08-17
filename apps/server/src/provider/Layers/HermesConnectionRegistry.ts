/**
 * Live {@link HermesConnectionRegistry}. See the service module for why this
 * state is memory-only and how generation fencing works.
 *
 * @module Layers/HermesConnectionRegistry
 */
import type { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import type {
  HermesActiveConnection,
  HermesConnectionRegistry,
  HermesInstanceLiveness,
  HermesLivenessStatusFields,
  HermesObservedConnection,
} from "../Services/HermesConnectionRegistry.ts";

/** Strip the transport/scope/generation from a connection to keep as `lastSeen`. */
const toObserved = (connection: HermesActiveConnection): HermesObservedConnection => ({
  pluginVersion: connection.pluginVersion,
  hermesVersion: connection.hermesVersion,
  capabilities: connection.capabilities,
  model: connection.model,
  connectedAt: connection.connectedAt,
  activeSessionCount: connection.activeSessionCount,
});

/**
 * Project liveness into the status fields it owns. Prefers the live connection,
 * falls back to `lastSeen`, and finally to whatever the incompatible plugin
 * advertised.
 */
export const livenessStatusFields = (
  liveness: HermesInstanceLiveness | undefined,
): HermesLivenessStatusFields => {
  const observed = liveness?.connection ?? liveness?.lastSeen;
  return {
    lastConnectedAt: observed?.connectedAt ?? null,
    pluginVersion: observed?.pluginVersion ?? liveness?.upgradeRequired?.pluginVersion ?? null,
    hermesVersion: observed?.hermesVersion ?? liveness?.upgradeRequired?.hermesVersion ?? null,
    model: observed?.model ?? liveness?.upgradeRequired?.model ?? null,
    activeSessionCount: liveness?.connection?.activeSessionCount ?? 0,
    protocolVersion:
      observed?.capabilities.protocolVersion ?? liveness?.upgradeRequired?.protocolVersion ?? null,
    capabilities: observed?.capabilities ?? null,
    // Exposed so consumers can tell a replacement (old socket dies as a new
    // one is accepted, publishing a single `connected` status) from a
    // continuous connection. Watching connectedness alone cannot.
    connectionGeneration: liveness?.connection?.generation ?? null,
    connected: liveness?.connection !== undefined,
    upgradeRequired: liveness?.upgradeRequired !== undefined,
  };
};

export const makeHermesConnectionRegistry = Effect.gen(function* () {
  const states = yield* Ref.make(new Map<ProviderInstanceId, HermesInstanceLiveness>());
  const generation = yield* Ref.make(0);

  /** Write liveness for one instance, dropping the entry when it goes empty. */
  const setLiveness = (
    current: ReadonlyMap<ProviderInstanceId, HermesInstanceLiveness>,
    instanceId: ProviderInstanceId,
    liveness: HermesInstanceLiveness,
  ) => {
    const next = new Map(current);
    if (
      liveness.connection === undefined &&
      liveness.lastSeen === undefined &&
      liveness.upgradeRequired === undefined
    ) {
      next.delete(instanceId);
    } else {
      next.set(instanceId, liveness);
    }
    return next;
  };

  const liveness = (instanceId: ProviderInstanceId) =>
    Ref.get(states).pipe(Effect.map((current) => current.get(instanceId)));

  const accept: HermesConnectionRegistry["accept"] = (input) =>
    Effect.gen(function* () {
      const nextGeneration = yield* Ref.getAndUpdate(generation, (value) => value + 1);
      // The connection scope is a child of nothing in particular: it is closed
      // explicitly on disconnect/replace so per-connection fibers (ping) die
      // exactly with the connection they belong to.
      const scope = yield* Scope.make();
      const connection: HermesActiveConnection = {
        ...input.observed,
        generation: nextGeneration,
        transport: input.transport,
        scope,
      };

      const displaced = yield* Ref.modify(states, (current) => {
        const found = current.get(input.instanceId);
        return [
          found?.connection,
          setLiveness(current, input.instanceId, {
            connection,
            lastSeen: toObserved(connection),
            // Accepting a compatible connection clears any stale
            // upgrade-required observation for this instance.
            upgradeRequired: undefined,
          }),
        ] as const;
      });

      // Replacing the registry entry also retires everything scoped to the
      // old generation (notably its liveness ping). Closing only the socket at
      // the broker boundary would leave that fiber probing a fenced transport
      // forever after every reconnect.
      if (displaced) yield* Scope.close(displaced.scope, Exit.void).pipe(Effect.ignore);

      return { generation: nextGeneration, displaced };
    });

  const markUpgradeRequired: HermesConnectionRegistry["markUpgradeRequired"] = (input) =>
    Effect.gen(function* () {
      const displaced = yield* Ref.modify(states, (current) => {
        const found = current.get(input.instanceId);
        return [
          found?.connection,
          setLiveness(current, input.instanceId, {
            connection: undefined,
            lastSeen: found?.lastSeen,
            upgradeRequired: input.upgradeRequired,
          }),
        ] as const;
      });
      if (displaced) yield* Scope.close(displaced.scope, Exit.void).pipe(Effect.ignore);
      return displaced;
    });

  const recordSessionCount: HermesConnectionRegistry["recordSessionCount"] = (
    registration,
    activeSessionCount,
  ) =>
    Ref.modify(states, (current) => {
      const found = current.get(registration.instanceId);
      // Fence inside the update so a replacement that lands between a read and
      // this write cannot be clobbered.
      if (found?.connection?.generation !== registration.generation) {
        return [false, current] as const;
      }
      const connection: HermesActiveConnection = { ...found.connection, activeSessionCount };
      return [
        true,
        setLiveness(current, registration.instanceId, {
          ...found,
          connection,
          lastSeen: toObserved(connection),
        }),
      ] as const;
    });

  const disconnect: HermesConnectionRegistry["disconnect"] = (registration) =>
    Effect.gen(function* () {
      const retired = yield* Ref.modify(states, (current) => {
        const found = current.get(registration.instanceId);
        if (found?.connection?.generation !== registration.generation) {
          return [undefined, current] as const;
        }
        return [
          found.connection,
          setLiveness(current, registration.instanceId, {
            connection: undefined,
            lastSeen: toObserved(found.connection),
            upgradeRequired: found.upgradeRequired,
          }),
        ] as const;
      });
      if (retired) yield* Scope.close(retired.scope, Exit.void).pipe(Effect.ignore);
      return retired;
    });

  const clearConnection: HermesConnectionRegistry["clearConnection"] = (instanceId) =>
    Effect.gen(function* () {
      const cleared = yield* Ref.modify(states, (current) => {
        const found = current.get(instanceId);
        if (!found?.connection) return [undefined, current] as const;
        return [
          found.connection,
          setLiveness(current, instanceId, {
            connection: undefined,
            lastSeen: toObserved(found.connection),
            upgradeRequired: found.upgradeRequired,
          }),
        ] as const;
      });
      if (cleared) yield* Scope.close(cleared.scope, Exit.void).pipe(Effect.ignore);
      return cleared;
    });

  const forget = (instanceId: ProviderInstanceId) =>
    Effect.gen(function* () {
      const dropped = yield* Ref.modify(states, (current) => {
        const found = current.get(instanceId);
        if (!found) return [undefined, current] as const;
        const next = new Map(current);
        next.delete(instanceId);
        return [found.connection, next] as const;
      });
      if (dropped) yield* Scope.close(dropped.scope, Exit.void).pipe(Effect.ignore);
    });

  return {
    liveness,
    accept,
    markUpgradeRequired,
    recordSessionCount,
    disconnect,
    clearConnection,
    forget,
    isConnected: (instanceId) =>
      liveness(instanceId).pipe(Effect.map((found) => found?.connection !== undefined)),
    connection: (instanceId) => liveness(instanceId).pipe(Effect.map((found) => found?.connection)),
    transport: (instanceId) =>
      liveness(instanceId).pipe(Effect.map((found) => found?.connection?.transport)),
  } satisfies HermesConnectionRegistry;
});
