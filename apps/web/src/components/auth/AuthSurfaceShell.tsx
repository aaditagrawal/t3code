import type { ReactNode } from "react";

import { APP_DISPLAY_NAME, APP_STAGE_LABEL } from "../../branding";
import { resolveSidebarStageBackdropVariant, StageBackdropArt } from "../SidebarStageBackdrop";

/**
 * Full-screen card for standalone auth pages, mirroring the pairing surface's
 * treatment. Used by the CLI-connect authorize and callback surfaces.
 */
export function AuthSurfaceShell({ children }: { readonly children: ReactNode }) {
  const stageVariant = resolveSidebarStageBackdropVariant(APP_STAGE_LABEL);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-72 aurora-top-blue" />
        <div className="absolute inset-0 aurora-veil-soft" />
      </div>

      <section className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-card/94 shadow-2xl shadow-black/20 backdrop-blur-md">
        <header className="relative h-24 overflow-hidden auth-stage-base text-white">
          {stageVariant ? (
            <div className="absolute inset-0" aria-hidden>
              <StageBackdropArt variant={stageVariant} />
            </div>
          ) : (
            <div aria-hidden className="absolute inset-0 auth-stage-glow" />
          )}
          <div className="absolute inset-0 auth-stage-shade" />
          <div className="relative h-full p-5 sm:p-6">
            <p className="text-xs font-semibold tracking-[0.2em] text-white/80 uppercase">
              {APP_DISPLAY_NAME}
            </p>
          </div>
        </header>

        <div className="p-6 sm:p-8">{children}</div>
      </section>
    </div>
  );
}
