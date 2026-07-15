/** Backend host for production (Render). Local `npm run dev` still uses the Vite proxy. */
export const PROD_SERVER_URL = "https://pitch-duel-mhcr.onrender.com";

/**
 * Base URL for REST API calls.
 * - Dev: "" (Vite proxies /api → localhost:3001)
 * - Prod / preview: Render backend (or VITE_SERVER_URL override)
 */
export function apiBase(): string {
  const fromEnv = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(
    /\/$/,
    ""
  );
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return "";
  // Same-origin when the page is already served by the Render app
  if (
    typeof location !== "undefined" &&
    location.hostname === "pitch-duel-mhcr.onrender.com"
  ) {
    return "";
  }
  return PROD_SERVER_URL;
}

export function apiUrl(path: string): string {
  const base = apiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/** WebSocket endpoint for the game server. */
export function wsUrl(): string {
  const base = apiBase();
  if (!base) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }
  const u = new URL(base);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${u.host}/ws`;
}
