// A one-time magic link can only be validated once. On that first load the server hands back a
// session token; we keep it for this browser tab so refreshing the page keeps working. It lives
// in sessionStorage, so it never outlives the tab.
const key = (urlToken: string) => `pw_portal_session:${urlToken}`;

export function getPortalSession(urlToken: string | undefined): string | null {
  if (!urlToken) return null;
  try { return sessionStorage.getItem(key(urlToken)); } catch { return null; }
}

export function setPortalSession(urlToken: string | undefined, sessionToken: string | null | undefined) {
  if (!urlToken || !sessionToken) return;
  try { sessionStorage.setItem(key(urlToken), sessionToken); } catch { /* storage blocked */ }
}

export function clearPortalSession(urlToken: string | undefined) {
  if (!urlToken) return;
  try { sessionStorage.removeItem(key(urlToken)); } catch { /* storage blocked */ }
}
