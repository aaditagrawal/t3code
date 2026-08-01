// FILE: RateLimitsPanel.tsx
// Purpose: Wraps the shared rate-limit summary UI in a collapsible panel fed by
// orchestration thread activities.

import { useEffect, useMemo, useState } from "react";
import type { OrchestrationThread } from "@t3tools/contracts";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { deriveAccountRateLimits, deriveRateLimitLearnMoreHref } from "~/lib/rateLimits";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { cn } from "~/lib/utils";
import { RateLimitSummaryList } from "./RateLimitSummaryList";

// Windows are reported in whole minutes, so minute granularity is enough to
// retire an expired one promptly without churning the memo.
const EXPIRY_TICK_MS = 60_000;

export default function RateLimitsPanel({
  threads,
}: {
  threads: ReadonlyArray<Pick<OrchestrationThread, "activities">>;
}) {
  const [open, setOpen] = useState(false);
  // Windows expire on wall-clock time, but an idle thread never changes
  // `threads`. Without a tick the memo would keep serving percentages from an
  // already-reset window until the next activity arrives.
  const [expiryTick, setExpiryTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setExpiryTick((tick) => tick + 1), EXPIRY_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const rateLimits = useMemo(
    () => deriveAccountRateLimits(threads),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- expiryTick re-runs the wall-clock filter
    [threads, expiryTick],
  );
  const learnMoreHref = useMemo(() => deriveRateLimitLearnMoreHref(rateLimits), [rateLimits]);

  if (rateLimits.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="mx-auto w-full max-w-3xl px-3">
        <div className="rounded-lg border border-border/60 bg-card/50">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <span className="flex items-center gap-1.5">
              <svg
                className="size-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span className="font-medium">Rate limits remaining</span>
            </span>
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
            />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="space-y-3 border-t border-border/40 px-3 pb-3 pt-2">
              <RateLimitSummaryList rateLimits={rateLimits} />
              {learnMoreHref ? (
                <a
                  href={learnMoreHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Learn more
                  <ExternalLinkIcon className="size-3" />
                </a>
              ) : null}
            </div>
          </CollapsiblePanel>
        </div>
      </div>
    </Collapsible>
  );
}
