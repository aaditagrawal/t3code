import { memo } from "react";
import { XIcon } from "lucide-react";

export interface QueuedFollowUpMessage {
  readonly id: string;
  /** Full text used when dispatching the turn. */
  readonly text: string;
  /** Truncated text shown in the queue panel. */
  readonly displayText: string;
}

export const ComposerQueuedFollowUpsPanel = memo(function ComposerQueuedFollowUpsPanel({
  items,
  onRemove,
}: {
  items: ReadonlyArray<QueuedFollowUpMessage>;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2.5 sm:px-5">
      <span className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {items.length === 1 ? "1 follow-up queued" : `${items.length} follow-ups queued`}
      </span>
      {items.map((item, index) => (
        <div key={item.id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-foreground/70">
            <span className="mr-1.5 text-xs text-muted-foreground">{index + 1}.</span>
            {item.displayText}
          </span>
          <button
            type="button"
            className="flex size-5 flex-none cursor-pointer items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground"
            onClick={() => onRemove(item.id)}
            aria-label="Remove queued message"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
});
