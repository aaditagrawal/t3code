export interface ClerkSignInProps {
  forceRedirectUrl?: string;
  signUpForceRedirectUrl?: string;
}

export function resolveClerkSignInProps(href: string, isElectron: boolean): ClerkSignInProps {
  // The Electron OAuth transport supplies the allowlisted renderer root.
  // Page-derived overrides can include hashes that Clerk rejects.
  if (isElectron) return {};
  // The sign-in modal can switch to sign-up, which follows its own redirect
  // target; without one Clerk falls back to the URL the modal was opened from.
  return { forceRedirectUrl: href, signUpForceRedirectUrl: href };
}
