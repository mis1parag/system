/** Who is calling: the IP and a short description of the browser, for the activity log. Never anything secret. */
export function requestMeta(req: Request): { ip: string; device: string } {
  const fwd = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "";
  const ip = fwd.split(",")[0].trim().slice(0, 45);
  const ua = req.headers.get("user-agent") ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : ua ? "Other" : "";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return { ip, device: [browser, os, /Mobi/.test(ua) ? "mobile" : ""].filter(Boolean).join(" · ") };
}
