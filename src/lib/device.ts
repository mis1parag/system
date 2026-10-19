// A random token that stays in this browser, so the server can tell which laptop / phone a check-in came from. Only its hash is stored on the server.
const KEY = "midap-device-token";
let memo = "";
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");

export function deviceToken(): string {
  if (typeof window === "undefined") return "";
  try {
    let t = localStorage.getItem(KEY) ?? "";
    if (t.length < 24) { t = random(); localStorage.setItem(KEY, t); }
    return t;
  } catch {
    return (memo ||= random()); // site data blocked: this tab only
  }
}
