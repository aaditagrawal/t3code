import type { SharePayload } from "expo-sharing";

import { SerializedAsyncQueue } from "../../lib/serialized-async-queue";
import {
  hasIncomingShareContent,
  type IncomingShareDestination,
  type IncomingShareDraft,
} from "./incoming-share-model";

export interface IncomingShareInboxDependencies {
  readonly loadDrafts: () => Promise<ReadonlyArray<IncomingShareDraft>>;
  readonly writeDraft: (draft: IncomingShareDraft) => Promise<void>;
  readonly removeDraft: (shareId: string) => Promise<void>;
  readonly getPayloads: () => ReadonlyArray<SharePayload>;
  readonly clearPayloads: () => void;
  readonly buildDraft: (input: {
    readonly payloads: ReadonlyArray<SharePayload>;
    readonly id: string;
    readonly createdAt: string;
  }) => Promise<{
    readonly draft: IncomingShareDraft;
    readonly cleanup: () => Promise<void>;
    readonly rollback?: () => Promise<void>;
  }>;
  readonly cleanupReplayedPayloads?: (payloads: ReadonlyArray<SharePayload>) => Promise<void>;
  /** Content fingerprint used to coalesce crash-recovery replays of one handoff. */
  readonly idForPayloads: (payloads: ReadonlyArray<SharePayload>) => Promise<string>;
  /**
   * Stable-per-handoff id derived from the content fingerprint. Distinct native
   * handoffs with identical payloads must not reuse a prior id.
   */
  readonly createHandoffId: (contentKey: string) => Promise<string>;
  readonly now: () => string;
  readonly onClearError?: (error: unknown) => void;
  readonly onCleanupError?: (error: unknown) => void;
}

export interface IncomingShareRefreshResult {
  readonly drafts: ReadonlyArray<IncomingShareDraft>;
  /**
   * Set when a fresh native payload matched an already-persisted inbox item.
   * Presentation uses this to clear a session dismissal and re-show the share.
   */
  readonly revivedShareId: string | null;
}

export function sortAndDedupeIncomingShares(
  drafts: ReadonlyArray<IncomingShareDraft>,
): ReadonlyArray<IncomingShareDraft> {
  const ids = new Set<string>();
  return [...drafts]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .filter((draft) => {
      if (ids.has(draft.id)) {
        return false;
      }
      ids.add(draft.id);
      return true;
    });
}

export function draftMatchesContentKey(draftId: string, contentKey: string): boolean {
  return draftId === contentKey || draftId.startsWith(`${contentKey}:`);
}

/**
 * Serializes every durable inbox mutation. This prevents a stale storage load
 * or a foreground refresh from restoring an item after it has been consumed.
 */
export class IncomingShareInbox {
  private readonly operations = new SerializedAsyncQueue();

  constructor(private readonly dependencies: IncomingShareInboxDependencies) {}

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.operations.run(operation);
  }

  private clearNativePayloads(): void {
    try {
      this.dependencies.clearPayloads();
    } catch (error) {
      this.dependencies.onClearError?.(error);
    }
  }

  private async cleanup(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.dependencies.onCleanupError?.(error);
    }
  }

  refresh(options: { readonly ingestNative: boolean }): Promise<IncomingShareRefreshResult> {
    return this.runExclusive(async () => {
      const loaded = await this.dependencies.loadDrafts();
      const persisted = sortAndDedupeIncomingShares(loaded);
      if (!options.ingestNative) {
        return { drafts: persisted, revivedShareId: null };
      }

      const payloads = this.dependencies.getPayloads();
      if (payloads.length === 0) {
        return { drafts: persisted, revivedShareId: null };
      }

      // A share extension payload remains available until the containing app
      // acknowledges it. Match by content fingerprint so a crash after the
      // durable write but before acknowledgement reuses the same inbox item.
      // Handoff ids are fingerprint-scoped but unique per acceptance so a
      // later identical share is not collapsed into a prior consumed receipt.
      const contentKey = await this.dependencies.idForPayloads(payloads);
      const existing = loaded.find((draft) => draftMatchesContentKey(draft.id, contentKey));
      if (existing) {
        if (this.dependencies.cleanupReplayedPayloads) {
          await this.cleanup(() => this.dependencies.cleanupReplayedPayloads!(payloads));
        }
        this.clearNativePayloads();
        return { drafts: persisted, revivedShareId: existing.id };
      }

      const shareId = await this.dependencies.createHandoffId(contentKey);
      const built = await this.dependencies.buildDraft({
        payloads,
        id: shareId,
        createdAt: this.dependencies.now(),
      });
      const { draft } = built;
      if (!hasIncomingShareContent(draft)) {
        // Unsupported native payloads cannot become actionable on retry and
        // would otherwise reopen the project picker on every foreground.
        await this.cleanup(built.cleanup);
        this.clearNativePayloads();
        throw new Error(
          draft.warnings[0] ?? "The shared content is not supported by the composer.",
        );
      }

      // The durable inbox write is the transaction boundary. Never clear the
      // native handoff first: a process termination must leave one recoverable
      // copy on one side of the boundary.
      try {
        await this.dependencies.writeDraft(draft);
      } catch (error) {
        if (built.rollback) {
          await this.cleanup(built.rollback);
        }
        throw error;
      }
      await this.cleanup(built.cleanup);
      this.clearNativePayloads();
      return {
        drafts: sortAndDedupeIncomingShares([draft, ...persisted]),
        revivedShareId: null,
      };
    });
  }

  consume(shareId: string): Promise<ReadonlyArray<IncomingShareDraft>> {
    return this.runExclusive(async () => {
      // Handoff ids are unique per native acceptance. Payload equality alone
      // cannot identify duplicate intentional shares of identical content.
      await this.dependencies.removeDraft(shareId);
      return sortAndDedupeIncomingShares(await this.dependencies.loadDrafts());
    });
  }

  reserve(
    shareId: string,
    destination: IncomingShareDestination,
  ): Promise<ReadonlyArray<IncomingShareDraft>> {
    return this.runExclusive(async () => {
      const persisted = await this.dependencies.loadDrafts();
      const target = persisted.find((draft) => draft.id === shareId);
      if (!target) {
        throw new Error("The shared content is no longer available.");
      }
      if (target.destination) {
        if (
          target.destination.environmentId !== destination.environmentId ||
          target.destination.projectId !== destination.projectId
        ) {
          throw new Error("The shared content is already reserved for another project draft.");
        }
        return sortAndDedupeIncomingShares(persisted);
      }

      const reserved = { ...target, destination };
      await this.dependencies.writeDraft(reserved);
      return sortAndDedupeIncomingShares(
        persisted.map((draft) => (draft.id === shareId ? reserved : draft)),
      );
    });
  }

  releaseReservation(
    shareId: string,
    expectedDestination: IncomingShareDestination,
  ): Promise<ReadonlyArray<IncomingShareDraft>> {
    return this.runExclusive(async () => {
      const persisted = await this.dependencies.loadDrafts();
      const target = persisted.find((draft) => draft.id === shareId);
      if (!target) {
        // Conditional release is idempotent: if another operation already
        // consumed the share, no reservation remains to clean up.
        return sortAndDedupeIncomingShares(persisted);
      }
      if (!target.destination) {
        return sortAndDedupeIncomingShares(persisted);
      }
      if (
        target.destination.environmentId !== expectedDestination.environmentId ||
        target.destination.projectId !== expectedDestination.projectId
      ) {
        throw new Error("The shared content reservation changed before it could be released.");
      }

      const { destination: _destination, ...unreserved } = target;
      await this.dependencies.writeDraft(unreserved);
      return sortAndDedupeIncomingShares(
        persisted.map((draft) => (draft.id === shareId ? unreserved : draft)),
      );
    });
  }
}
