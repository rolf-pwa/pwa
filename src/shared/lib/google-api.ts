import { supabase } from "@/shared/integrations/supabase/client";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

// --- Google Auth ---

export async function getGoogleAuthUrl() {
  const headers = await getAuthHeaders();
  const redirectUri = `${window.location.origin}/google-callback`;
  const res = await fetch(`${FUNCTIONS_URL}/google-auth?action=auth-url`, {
    method: "POST",
    headers,
    body: JSON.stringify({ redirect_uri: redirectUri }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to get auth URL");
  return data.url as string;
}

export async function exchangeGoogleCode(code: string) {
  const headers = await getAuthHeaders();
  const redirectUri = `${window.location.origin}/google-callback`;
  const res = await fetch(`${FUNCTIONS_URL}/google-auth?action=callback`, {
    method: "POST",
    headers,
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to exchange code");
  return data;
}

export async function getGoogleConnectionStatus() {
  const headers = await getAuthHeaders();
  const res = await fetch(`${FUNCTIONS_URL}/google-auth?action=status`, {
    method: "POST",
    headers,
  });
  return res.json();
}

export async function syncCharterDriveSources(contactId: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${FUNCTIONS_URL}/drive-watch`, {
    method: "POST",
    headers,
    body: JSON.stringify({ contactId, mode: "charter-sync" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to sync charter Drive folder");
  return data;
}

export async function disconnectGoogle() {
  const headers = await getAuthHeaders();
  const res = await fetch(`${FUNCTIONS_URL}/google-auth?action=disconnect`, {
    method: "POST",
    headers,
  });
  return res.json();
}

// --- Calendar ---

export async function listCalendarEvents(timeMin?: string, timeMax?: string, opts: { q?: string; maxResults?: number } = {}) {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ action: "list" });
  if (timeMin) params.set("timeMin", timeMin);
  if (timeMax) params.set("timeMax", timeMax);
  if (opts.q) params.set("q", opts.q);
  if (opts.maxResults) params.set("maxResults", String(opts.maxResults));
  const res = await fetch(`${FUNCTIONS_URL}/google-calendar?${params}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to list events");
  return data;
}

// --- Gmail (read-only history for the Contact Communications tab) ---

export async function listGmailMessages(query?: string) {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ action: "list" });
  if (query) params.set("q", query);
  const res = await fetch(`${FUNCTIONS_URL}/google-gmail?${params}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to list messages");
  return data;
}
