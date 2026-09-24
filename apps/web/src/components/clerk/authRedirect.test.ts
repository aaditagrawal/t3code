import { describe, expect, it } from "vite-plus/test";

import { resolveClerkSignInProps } from "./authRedirect";

describe("resolveClerkSignInProps", () => {
  it("returns to the current browser URL on the web", () => {
    const href = "https://app.t3.codes/connect?state=state-1#details";
    expect(resolveClerkSignInProps(href, false)).toEqual({
      forceRedirectUrl: href,
      signUpForceRedirectUrl: href,
    });
  });

  it("uses Electron OAuth defaults even from a virtual sign-up route", () => {
    expect(
      resolveClerkSignInProps(
        "t3code-fork://app/CLERK-ROUTER/VIRTUAL/sign-up?__clerk_status=complete#/settings/connections",
        true,
      ),
    ).toEqual({});
  });

  it("uses Electron OAuth defaults for development routes", () => {
    expect(resolveClerkSignInProps("t3code-fork-dev://app/#/settings/general", true)).toEqual({});
  });
});
