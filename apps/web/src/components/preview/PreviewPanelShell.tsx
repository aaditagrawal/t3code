import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { isElectron } from "~/env";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

import { RightPanelResizeHandle } from "./RightPanelResizeHandle";

export type PreviewPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "t3code:preview-panel-width";
const PREVIEW_PANEL_MIN_WIDTH = 360;
/** Fraction of the available row width allowed, preserving space for chat. */
const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;
const PREVIEW_PANEL_DEFAULT_WIDTH = 540;

export function getPreviewPanelMaxWidth(availableWidth: number): number {
  return Math.floor(availableWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION);
}

/**
 * Shell for the preview panel. In inline mode the panel is user-resizable
 * via a drag handle on the left edge; width persists per browser. In
 * sheet/sidebar modes the parent owns the size.
 */
export function PreviewPanelShell(props: {
  mode: PreviewPanelMode;
  maximized?: boolean;
  children: ReactNode;
}) {
  const useDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";
  const isInline = props.mode === "inline";
  const panelRef = useRef<HTMLDivElement>(null);
  const maxWidth = useContainerClampedMaxWidth(panelRef);
  const { width, handlers } = useResizableWidth({
    storageKey: PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: PREVIEW_PANEL_DEFAULT_WIDTH,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth,
    edge: "left",
  });

  return (
    <div
      ref={panelRef}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col self-stretch bg-background",
        isInline
          ? props.maximized
            ? "flex-1 border-l border-border"
            : "shrink-0 border-l border-border"
          : "w-full",
      )}
      style={isInline && !props.maximized ? { width: `${width}px` } : undefined}
      data-preview-panel-mode={props.mode}
      data-preview-panel-maximized={props.maximized ? "true" : "false"}
    >
      {isInline && !props.maximized ? <RightPanelResizeHandle handlers={handlers} /> : null}
      {useDragRegion ? <div className="electron-drag-region h-0 w-full" aria-hidden /> : null}
      {props.children}
    </div>
  );
}

/**
 * Clamp against the containing flex row (chat + preview), not the full
 * viewport — left sidebars are outside that row and must not inflate the max.
 */
function useContainerClampedMaxWidth(panelRef: RefObject<HTMLDivElement | null>): number {
  const [availableWidth, setAvailableWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  useEffect(() => {
    const panel = panelRef.current;
    const container = panel?.parentElement;
    if (!container || typeof ResizeObserver === "undefined") return;

    const update = (width: number) => {
      if (width > 0) setAvailableWidth(width);
    };
    update(container.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? container.clientWidth;
      update(width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [panelRef]);
  return getPreviewPanelMaxWidth(availableWidth);
}
