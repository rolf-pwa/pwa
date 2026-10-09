import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGoogleConnectionStatus,
  getGoogleAuthUrl,
  exchangeGoogleCode,
  disconnectGoogle,
  syncCharterDriveSources,
  listCalendarEvents,
  listGmailMessages,
} from "@/shared/lib/google-api";

export function useGoogleStatus() {
  return useQuery({
    queryKey: ["google-status"],
    queryFn: getGoogleConnectionStatus,
    staleTime: 30_000,
  });
}

export function useConnectGoogle() {
  return useMutation({
    mutationFn: async () => {
      const url = await getGoogleAuthUrl();
      window.location.href = url;
    },
  });
}

export function useExchangeGoogleCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => exchangeGoogleCode(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["google-status"] }),
  });
}

export function useDisconnectGoogle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: disconnectGoogle,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["google-status"] }),
  });
}

export function useSyncCharterDriveSources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => syncCharterDriveSources(contactId),
    onSuccess: (_, contactId) => {
      qc.invalidateQueries({ queryKey: ["google-status"] });
      qc.invalidateQueries({ queryKey: ["charter-drive-sync", contactId] });
    },
  });
}

export function useCalendarEvents(timeMin?: string, timeMax?: string, enabled = true, opts: { q?: string; maxResults?: number } = {}) {
  return useQuery({
    queryKey: ["calendar-events", timeMin, timeMax, opts.q ?? null, opts.maxResults ?? null],
    queryFn: () => listCalendarEvents(timeMin, timeMax, opts),
    enabled,
    staleTime: 60_000,
  });
}

export function useGmailMessages(query?: string, enabled = true) {
  return useQuery({
    queryKey: ["gmail-messages", query],
    queryFn: () => listGmailMessages(query),
    enabled,
    staleTime: 60_000,
  });
}
