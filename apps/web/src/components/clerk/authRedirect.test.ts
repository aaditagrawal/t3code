import { URL_SCHEME, URL_SCHEME_DEV } from "@t3tools/shared/branding";
import { describe, expect, it } from "vite-plus/test";

import { resolveClerkSignInProps } from "./authRedirect";

describe("resolveClerkSignInProps", () => {
  it("returns to the current browser URL on the web", () => {
    const href = "https://app.t3.codes/connect?state=state-1#details";
    expect(resolveClerkSignInProps(href, false)).toEqual({ forceRedirectUrl: href });
  });

  it("omits the redirect override on packaged desktop", () => {
    expect(resolveClerkSignInProps(`${URL_SCHEME}://app/#/settings/general`, true)).toEqual({});
  });

  it("omits the redirect override on development desktop", () => {
    expect(resolveClerkSignInProps(`${URL_SCHEME_DEV}://app/#/settings/general`, true)).toEqual({});
  });
});
