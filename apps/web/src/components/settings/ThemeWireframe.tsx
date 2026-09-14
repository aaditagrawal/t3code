/* oxlint-disable shadcn/no-arbitrary-values -- Schematic preview: pane geometry is
   intentionally percentage-based and does not map to the spacing scale. */
import type * as React from "react";
import { cn } from "../../lib/utils";
import type { ThemeCardPreviewColors } from "./ThemePreviewCircles";

// A simple miniature of the app: sidebar, a short conversation, the
// composer, and the orchestrator panel floating over the interface as an
// island with horizontal agent rows.
export function ThemeWireframePane({
  colors,
  clip,
}: {
  colors: ThemeCardPreviewColors;
  clip?: "left" | "right" | undefined;
}) {
  const line = "var(--color-wireframe-line)";
  const clipValue =
    clip === "left"
      ? "polygon(0 0, calc(50% - 1px) 0, calc(50% - 1px) 100%, 0 100%)"
      : "polygon(calc(50% + 1px) 0, 100% 0, 100% 100%, calc(50% + 1px) 100%)";
  return (
    <span
      className="absolute inset-0 [clip-path:var(--wf-clip,none)]"
      style={clip === undefined ? undefined : ({ "--wf-clip": clipValue } as React.CSSProperties)}
    >
      <span
        className="absolute inset-0 bg-(--wf-bg)"
        style={{ "--wf-bg": colors.canvas } as React.CSSProperties}
      />
      <span
        className="absolute inset-y-0 left-0 w-[22%] bg-(--wf-sidebar) shadow-(--wf-sidebar-line)"
        style={
          {
            "--wf-sidebar": colors.sidebar,
            "--wf-sidebar-line": `inset -1px 0 0 ${line}`,
          } as React.CSSProperties
        }
      />

      {/* Sidebar: search, then thread rows */}
      <span
        className="absolute left-[3%] top-[8%] h-[8%] w-[16%] rounded-md bg-(--wf-surface) shadow-(--wf-inset-line)"
        style={
          {
            "--wf-surface": colors.surface,
            "--wf-inset-line": `inset 0 0 0 1px ${line}`,
          } as React.CSSProperties
        }
      />
      <span
        className="absolute left-[3%] top-[22%] h-[7%] w-[16%] rounded-md bg-(--wf-accent)"
        style={{ "--wf-accent": colors.accentSurface } as React.CSSProperties}
      />
      <span
        className="absolute left-[3%] top-[32%] h-[7%] w-[16%] rounded-md bg-(--wf-message) opacity-70"
        style={{ "--wf-message": colors.messageSurface } as React.CSSProperties}
      />
      <span
        className="absolute left-[3%] top-[42%] h-[7%] w-[16%] rounded-md bg-(--wf-message) opacity-50"
        style={{ "--wf-message": colors.messageSurface } as React.CSSProperties}
      />

      {/* Conversation */}
      <span
        className="absolute right-[28%] top-[11%] h-[9%] w-[24%] rounded-lg bg-(--wf-message)"
        style={{ "--wf-message": colors.messageSurface } as React.CSSProperties}
      />
      <span
        className="absolute left-[27%] top-[28%] h-[5%] w-[34%] rounded-sm bg-(--wf-line)"
        style={{ "--wf-line": line } as React.CSSProperties}
      />
      <span
        className="absolute left-[27%] top-[38%] h-[5%] w-[26%] rounded-sm bg-(--wf-line)"
        style={{ "--wf-line": line } as React.CSSProperties}
      />

      {/* Composer */}
      <span
        className="absolute bottom-[8%] left-[26%] right-[6%] flex h-[15%] items-center justify-between rounded-md bg-(--wf-surface) px-[2.5%] shadow-(--wf-inset-line)"
        style={
          {
            "--wf-surface": colors.surface,
            "--wf-inset-line": `inset 0 0 0 1px ${line}`,
          } as React.CSSProperties
        }
      >
        <span
          className="block h-[26%] w-[34%] rounded-full bg-(--wf-line) opacity-70"
          style={{ "--wf-line": line } as React.CSSProperties}
        />
        <span
          className="block aspect-square h-[58%] rounded-full bg-(--wf-action)"
          style={{ "--wf-action": colors.messageAction } as React.CSSProperties}
        />
      </span>

      {/* Orchestrator island floating over the composer */}
      <span
        className="absolute right-[5%] top-[8%] h-[46%] w-[20%] rounded-lg bg-(--wf-surface) shadow-(--wf-island)"
        style={
          {
            "--wf-surface": colors.surface,
            "--wf-island": `inset 0 0 0 1px ${line}, 0 2px 5px var(--color-wireframe-elevation)`,
          } as React.CSSProperties
        }
      >
        {[0, 1, 2].map((row) => (
          <span
            className="absolute left-[11%] right-[11%] top-(--wf-row-top) flex h-(--wf-row-h) items-center gap-[5%]"
            key={row}
            style={
              {
                "--wf-row-top": `${10 + row * 30}%`,
                "--wf-row-h": "20%",
              } as React.CSSProperties
            }
          >
            <span
              className="block aspect-square h-[26%] rounded-full bg-(--wf-dot) opacity-55"
              style={
                {
                  "--wf-dot":
                    row === 0
                      ? "var(--color-success)"
                      : row === 1
                        ? colors.messageAction
                        : "var(--color-warning)",
                } as React.CSSProperties
              }
            />
            <span
              className="block h-[30%] w-[52%] rounded-sm bg-(--wf-line)"
              style={{ "--wf-line": line } as React.CSSProperties}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

export function ThemeWireframe({
  className,
  panes,
}: {
  /** Sizing (height) for the frame; the pane geometry is percentage based. */
  className?: string;
  panes: ReadonlyArray<{ colors: ThemeCardPreviewColors; clip?: "left" | "right" }>;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block w-full overflow-hidden rounded-lg border border-border/60",
        className,
      )}
    >
      {panes.map((pane) => (
        <ThemeWireframePane clip={pane.clip} colors={pane.colors} key={pane.clip ?? "pane"} />
      ))}
    </span>
  );
}
