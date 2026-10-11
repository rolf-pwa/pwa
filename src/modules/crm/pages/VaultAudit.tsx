import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Copy, Download, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/shared/components/AppLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { supabase } from "@/shared/integrations/supabase/client";
import { ACTION_GROUPS, ALL_KNOWN_ACTIONS, actionLabel, describeDetails, groupOf, toCsv, type ActionGroup, type AuditRow } from "../lib/vaultAudit";

const PAGE = 50;
const EXPORT_CHUNK = 1000;
const EXPORT_CAP = 100_000;

interface Filters {
  household: string; // "all" or id
  who: string;
  file: string;
  from: string; // yyyy-mm-dd
  to: string;
  groups: ActionGroup[];
}
const EMPTY: Filters = { household: "all", who: "", file: "", from: "", to: "", groups: [] };

// Free text goes into PostgREST filter strings: keep to characters that cannot change the filter's structure.
const safeText = (s: string) => s.replace(/[^\p{L}\p{N}@._\- ]/gu, "").trim();

function applyFilters<Q extends { eq: any; gte: any; lt: any; ilike: any; or: any; in: any }>(q: Q, f: Filters): Q {
  let r: any = q;
  if (f.household !== "all") r = r.eq("household_id", f.household);
  if (f.from) r = r.gte("created_at", new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) r = r.lt("created_at", new Date(new Date(`${f.to}T00:00:00`).getTime() + 86_400_000).toISOString());
  const who = safeText(f.who);
  if (who) r = r.or(`actor_email.ilike.%${who}%,actor_label.ilike.%${who}%`);
  const file = safeText(f.file);
  if (file) r = r.or(`drive_name.ilike.%${file}%,drive_id.eq.${file.replace(/ /g, "")}`);
  if (f.groups.length) {
    const wanted = f.groups.flatMap((g) => ACTION_GROUPS[g].actions);
    r = r.in("action", wanted);
  }
  return r;
}

export default function VaultAudit() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [integrity, setIntegrity] = useState<{ ok: boolean; rows: number; detail: string; badSeq: number | null; at: Date } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const set = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(0); };
  const toggleGroup = (g: ActionGroup) => {
    setFilters((f) => ({ ...f, groups: f.groups.includes(g) ? f.groups.filter((x) => x !== g) : [...f.groups, g] }));
    setPage(0);
  };

  const households = useQuery({
    queryKey: ["audit-households"],
    queryFn: async () => (await supabase.from("households").select("id, label").order("label")).data ?? [],
    staleTime: 10 * 60_000,
  });
  const staff = useQuery({
    queryKey: ["audit-staff"],
    queryFn: async () => (await supabase.from("profiles").select("user_id, email, full_name")).data ?? [],
    staleTime: 10 * 60_000,
  });
  const head = useQuery({
    queryKey: ["audit-head"],
    queryFn: async () => (await supabase.from("vault_audit_log").select("seq, row_hash, created_at").order("seq", { ascending: false }).limit(1)).data?.[0] ?? null,
  });

  const rows = useQuery({
    queryKey: ["audit-rows", filters, page],
    queryFn: async () => {
      const { data, count, error } = await applyFilters(supabase.from("vault_audit_log").select("*", { count: "exact" }), filters)
        .order("seq", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as AuditRow[], total: count ?? 0 };
    },
    placeholderData: (prev) => prev,
  });

  const clientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows.data?.rows ?? []) {
      if (r.contact_id) ids.add(r.contact_id);
      const m = /^client:(.+)$/.exec(r.actor_label ?? ""); if (m) ids.add(m[1]);
    }
    return [...ids];
  }, [rows.data]);
  const contacts = useQuery({
    queryKey: ["audit-contacts", clientIds],
    enabled: clientIds.length > 0,
    queryFn: async () => (await supabase.from("contacts").select("id, first_name, last_name").in("id", clientIds)).data ?? [],
  });

  const hhName = (id: string | null) => (id ? households.data?.find((h) => h.id === id)?.label ?? "Unknown household" : "—");
  const contactName = (id: string | null) => {
    const c = id ? contacts.data?.find((x) => x.id === id) : null;
    return c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : "";
  };
  const actorName = (r: AuditRow) => {
    if (r.actor_email) return r.actor_email;
    if (r.actor_type === "staff") return staff.data?.find((p) => p.user_id === r.actor_id)?.email ?? "Staff (unknown)";
    if (r.actor_type === "client") { const m = /^client:(.+)$/.exec(r.actor_label ?? ""); return `${contactName(m?.[1] ?? null) || "Client"} (client)`; }
    if (r.actor_type === "share_link") return "Share link visitor";
    if (r.actor_type === "collaborator") return "Collaborator";
    if (r.actor_type === "professional") return "Professional";
    return "Anonymous";
  };

  const total = rows.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const verify = async () => {
    setVerifying(true);
    try {
      const { data, error } = await supabase.rpc("verify_vault_audit_chain");
      if (error) throw error;
      const r = data?.[0];
      setIntegrity({ ok: !!r?.ok, rows: Number(r?.rows_checked ?? 0), detail: r?.detail ?? "", badSeq: r?.first_bad_seq ?? null, at: new Date() });
      await supabase.rpc("record_vault_audit_export", { p_filters: {}, p_row_count: Number(r?.rows_checked ?? 0), p_kind: "integrity_check" });
      head.refetch();
      rows.refetch();
    } catch (e: any) {
      toast.error(`Couldn't verify: ${e.message ?? e}`);
    } finally { setVerifying(false); }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: AuditRow[] = [];
      for (let from = 0; from < EXPORT_CAP; from += EXPORT_CHUNK) {
        const { data, error } = await applyFilters(supabase.from("vault_audit_log").select("*"), filters)
          .order("seq", { ascending: true }).range(from, from + EXPORT_CHUNK - 1);
        if (error) throw error;
        all.push(...((data ?? []) as unknown as AuditRow[]));
        if ((data?.length ?? 0) < EXPORT_CHUNK) break;
      }
      // Names for the export: every household and person that appears.
      const ids = [...new Set(all.flatMap((r) => [r.contact_id, /^client:(.+)$/.exec(r.actor_label ?? "")?.[1] ?? null]).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from("contacts").select("id, first_name, last_name").in("id", ids.slice(i, i + 200));
        for (const c of data ?? []) names.set(c.id, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim());
      }
      const csv = toCsv(all, {
        household: (id) => (id ? households.data?.find((h) => h.id === id)?.label ?? id : ""),
        contact: (id) => (id ? names.get(id) ?? "" : ""),
        actor: (r) => {
          if (r.actor_email) return r.actor_email;
          if (r.actor_type === "staff") return staff.data?.find((p) => p.user_id === r.actor_id)?.email ?? "";
          const m = /^client:(.+)$/.exec(r.actor_label ?? "");
          return m ? `${names.get(m[1]) ?? "client"} (client)` : r.actor_type;
        },
      });
      const scope = filters.household === "all" ? "all-households" : (hhName(filters.household) || "household").replace(/[^\w-]+/g, "_");
      const name = `vault-audit_${scope}_${filters.from || "start"}_${filters.to || format(new Date(), "yyyy-MM-dd")}.csv`;
      const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      await supabase.rpc("record_vault_audit_export", { p_filters: filters as unknown as Record<string, never>, p_row_count: all.length, p_kind: "csv_export" });
      toast.success(`Exported ${all.length.toLocaleString()} entries`);
      head.refetch();
      rows.refetch();
    } catch (e: any) {
      toast.error(`Export failed: ${e.message ?? e}`);
    } finally { setExporting(false); }
  };

  return (
    <AppLayout>
      <div className="space-y-5">
        <div>
          <h1 className="font-serif text-2xl text-foreground">Vault audit log</h1>
          <p className="text-sm text-muted-foreground">Every view, change and sharing action in the Vault. Entries cannot be edited or deleted, and each one is chained to the one before it.</p>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            {integrity ? (
              integrity.ok ? <ShieldCheck className="h-8 w-8 text-emerald-600" /> : <ShieldAlert className="h-8 w-8 text-destructive" />
            ) : <ShieldCheck className="h-8 w-8 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {integrity
                  ? integrity.ok ? `Chain intact — ${integrity.rows.toLocaleString()} entries checked` : `Chain broken at entry ${integrity.badSeq}: ${integrity.detail}`
                  : "Integrity not checked yet"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {integrity ? `Checked ${format(integrity.at, "PPp")}. ` : ""}
                {head.data ? <>Latest entry #{head.data.seq} · hash <span className="font-mono">{head.data.row_hash.slice(0, 16)}…</span></> : null}
              </p>
            </div>
            {head.data && (
              <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(head.data!.row_hash); toast.success("Latest hash copied — keep it somewhere safe to anchor the log"); }}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />Copy latest hash
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={verify} disabled={verifying}>
              {verifying ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}Verify integrity
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-5">
              <Select value={filters.household} onValueChange={(v) => set({ household: v })}>
                <SelectTrigger><SelectValue placeholder="Household" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All households</SelectItem>
                  {(households.data ?? []).map((h) => <SelectItem key={h.id} value={h.id}>{h.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Who (email or name)" value={filters.who} onChange={(e) => set({ who: e.target.value })} />
              <Input placeholder="File name or ID" value={filters.file} onChange={(e) => set({ file: e.target.value })} />
              <Input type="date" aria-label="From date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
              <Input type="date" aria-label="To date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(Object.keys(ACTION_GROUPS) as ActionGroup[]).map((g) => (
                <button
                  key={g}
                  title={ACTION_GROUPS[g].hint}
                  onClick={() => toggleGroup(g)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${filters.groups.includes(g) ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-muted/50"}`}
                >
                  {ACTION_GROUPS[g].label}
                </button>
              ))}
              {(filters.groups.length > 0 || filters.household !== "all" || filters.who || filters.file || filters.from || filters.to) && (
                <button className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => { setFilters(EMPTY); setPage(0); }}>Clear filters</button>
              )}
              <div className="ml-auto flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{total.toLocaleString()} entries</span>
                <Button size="sm" onClick={exportCsv} disabled={exporting || total === 0}>
                  {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Export CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>When</TableHead>
                  <TableHead>Household</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.isLoading && <TableRow><TableCell colSpan={7} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>}
                {!rows.isLoading && (rows.data?.rows.length ?? 0) === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No entries match.</TableCell></TableRow>}
                {rows.data?.rows.map((r) => {
                  const isOpen = open === r.id;
                  const grp = groupOf(r.action);
                  return (
                    <Fragment key={r.id}>
                      <TableRow className="cursor-pointer" onClick={() => setOpen(isOpen ? null : r.id)}>
                        <TableCell className="w-8 pr-0">{isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{format(new Date(r.created_at), "MMM d, yyyy h:mm:ss a")}</TableCell>
                        <TableCell className="text-sm">{hhName(r.household_id)}</TableCell>
                        <TableCell className="max-w-[14rem] truncate text-sm">{actorName(r)}</TableCell>
                        <TableCell>
                          <Badge variant={grp === "blocked" ? "destructive" : "outline"} className="whitespace-nowrap text-[11px] font-normal">{actionLabel(r.action)}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[16rem] truncate text-sm">{r.drive_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="max-w-[22rem] truncate text-xs text-muted-foreground">{describeDetails(r)}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={6} className="space-y-2 py-3 text-xs">
                            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                              <p><span className="text-muted-foreground">Entry:</span> #{r.seq} · {format(new Date(r.created_at), "PPpp")} · {r.created_at}</p>
                              <p><span className="text-muted-foreground">Who:</span> {actorName(r)} ({r.actor_type}){r.actor_id ? ` · ${r.actor_id}` : ""}</p>
                              <p><span className="text-muted-foreground">File:</span> {r.drive_name ?? "—"} {r.drive_id ? <span className="font-mono">({r.drive_id})</span> : null}</p>
                              <p><span className="text-muted-foreground">From:</span> {r.ip ?? "—"}</p>
                              <p className="sm:col-span-2 truncate"><span className="text-muted-foreground">Browser:</span> {r.user_agent ?? "—"}</p>
                              {r.contact_id && <p><span className="text-muted-foreground">Client:</span> {contactName(r.contact_id) || r.contact_id}</p>}
                            </div>
                            <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[11px]">{JSON.stringify(r.metadata ?? {}, null, 2)}</pre>
                            <p className="font-mono text-[10px] text-muted-foreground">prev {r.prev_hash ?? "genesis"}<br />hash {r.row_hash}</p>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <span>Page {page + 1} of {pages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</Button>
                <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Older</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
