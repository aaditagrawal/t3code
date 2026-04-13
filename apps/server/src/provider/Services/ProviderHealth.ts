/**
 * ProviderHealth - Provider readiness snapshot service.
 *
 * Owns provider health checks (install/auth reachability) and exposes the
 * latest results to transport layers.
 *
 * @module ProviderHealth
 */
import type { ServerProviderAuthStatus } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

/**
 * Lightweight status snapshot returned by startup health probes.
 *
 * Intentionally decoupled from the full `ServerProvider` contract which
 * carries model lists, slash-commands, etc.
 */
export type ServerProviderStatusState = "ready" | "warning" | "error";

export interface ServerProviderStatus {
  readonly provider: string;
  readonly status: ServerProviderStatusState;
  readonly available: boolean;
  readonly authStatus: ServerProviderAuthStatus;
  readonly checkedAt: string;
  readonly message?: string;
}

export interface ProviderHealthShape {
  /**
   * Read the latest provider health statuses.
   */
  readonly getStatuses: Effect.Effect<ReadonlyArray<ServerProviderStatus>>;
}

export class ProviderHealth extends Context.Service<ProviderHealth, ProviderHealthShape>()(
  "t3/provider/Services/ProviderHealth",
) {}
