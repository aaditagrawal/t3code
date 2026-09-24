import { RefreshCwIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";

// No default size: inside a Button the parent's svg rule sizes the glyph.
const refreshIconVariants = cva("", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-3.5",
      md: "size-4",
      lg: "size-5",
    },
    tone: {
      current: "",
      muted: "opacity-70",
    },
  },
  defaultVariants: { tone: "current" },
});

/** Keep the refresh glyph in place while its owning action is running. */
export function RefreshIcon({
  refreshing = false,
  className,
  size,
  tone,
  ...props
}: React.ComponentPropsWithoutRef<typeof RefreshCwIcon> &
  VariantProps<typeof refreshIconVariants> & { refreshing?: boolean }) {
  return (
    <RefreshCwIcon
      aria-hidden
      ref={refreshing ? observeVisibleAnimation : undefined}
      className={cn(
        refreshIconVariants({ size, tone }),
        refreshing && "motion-safe:visible-animate-spin",
        className,
      )}
      {...props}
    />
  );
}
