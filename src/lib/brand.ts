// The name of this panel. Every deployment can have its own: set NEXT_PUBLIC_BRAND (for example "Saral MIS") in the host's environment variables.
// The company name inside the app (header, salary slips, e-mails) starts from the same value and can be changed in Settings.
export const BRAND = (process.env.NEXT_PUBLIC_BRAND ?? "").trim() || "Parag Unify Crafts";
export const BRAND_SHORT = BRAND.split(" ").slice(0, 2).join(" ");
export const BRAND_INITIAL = BRAND.slice(0, 1).toUpperCase();
