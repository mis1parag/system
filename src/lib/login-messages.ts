// Browser-safe bits of the sign-in flow (no Node imports, so the login page can use them).
/** Where to go after signing in: same-site paths only (never another site, never the login page itself). */
export const safeNext = (v: unknown): string => {
  const s = String(v ?? "");
  return /^\/(?!\/)[\w\-./?=&%]*$/.test(s) && !s.startsWith("/login") ? s : "/flows/panel";
};

/** Messages the login page may show for a failed Google sign-in (fixed list: nothing from the URL is ever printed). */
export const GOOGLE_ERRORS: Record<string, string> = {
  not_set_up: "Google sign-in is not set up on this server yet.",
  cancelled: "Google sign-in was cancelled.",
  expired: "That sign-in took too long or was opened twice. Please try again.",
  failed: "Google could not confirm your sign-in. Please try again.",
  unverified: "Google says this e-mail address is not verified, so it cannot be used to sign in.",
  no_match: "This Google account is not linked to any active employee. Ask the Super Admin to add or correct your e-mail address in your profile, or sign in with your PIN.",
};
