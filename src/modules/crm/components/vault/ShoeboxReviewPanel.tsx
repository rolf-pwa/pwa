import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { Loader2, FileCheck, FileX, ScanLine, FileQuestion, Undo2 } from "lucide-react";
import { toast } from "sonner";

const FUNCTIONS_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/vault-service`;

async function callVault(action: string, payload: Record<string, unknown> = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(FUNCTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

interface ShoeboxProposal {
  id: string;
  drive_id: string;
  original_name: string;
  document_type: string;
  other_label: string | null;
  document_date: string | null;
  document_subject_first_name: string | null;
  document_subject_last_name: string | null;
  proposed_name: string;
  proposed_category_slug: string | null;
  contacts: { full_name: string | null; first_name: string; last_name: string } | null;
}

interface AutoFiledRow {
  id: string;
  original_name: string;
  proposed_name: string;
  proposed_category_slug: string | null;
  auto_filed_at: string;
}

interface FolderTemplate {
  slug: string;
  display_name: string;
  position: number;
}

function documentTypeLabel(p: ShoeboxProposal) {
  if (p.document_type === "Other") return p.other_label ? `Other: ${p.other_label}` : "Other";
  return p.document_type;
}

function subjectLabel(p: ShoeboxProposal) {
  if (p.document_subject_first_name || p.document_subject_last_name) {
    return `${p.document_subject_first_name ?? ""} ${p.document_subject_last_name ?? ""}`.trim();
  }
  return p.contacts?.full_name || `${p.contacts?.first_name ?? ""} ${p.contacts?.last_name ?? ""}`.trim() || "Unknown uploader";
}

function ProposalRow({ proposal, templates }: { proposal: ShoeboxProposal; templates: FolderTemplate[] }) {
  const queryClient = useQueryClient();
  const [finalName, setFinalName] = useState(proposal.proposed_name);
  const [finalCategorySlug, setFinalCategorySlug] = useState<string>(proposal.proposed_category_slug ?? "none");

  const approve = useMutation({
    mutationFn: () =>
      callVault("approveShoeboxProposal", {
        proposalId: proposal.id,
        finalName,
        finalCategorySlug: finalCategorySlug === "none" ? null : finalCategorySlug,
      }),
    onSuccess: () => {
      toast.success(`Filed ${finalName}`);
      queryClient.invalidateQueries({ queryKey: ["shoebox-proposals"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: () => callVault("rejectShoeboxProposal", { proposalId: proposal.id }),
    onSuccess: () => {
      toast.success("Proposal rejected — file left in Shoebox");
      queryClient.invalidateQueries({ queryKey: ["shoebox-proposals"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const busy = approve.isPending || reject.isPending;

  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm text-muted-foreground">Original: {proposal.original_name}</div>
          <div className="text-xs text-muted-foreground">Subject: {subjectLabel(proposal)}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{documentTypeLabel(proposal)}</Badge>
          <Badge variant="outline">{proposal.document_date ?? "date unknown"}</Badge>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={finalName}
          onChange={(e) => setFinalName(e.target.value)}
          className="flex-1"
          disabled={busy}
        />
        <Select value={finalCategorySlug} onValueChange={setFinalCategorySlug} disabled={busy}>
          <SelectTrigger className="w-full sm:w-[260px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Leave in Shoebox</SelectItem>
            {templates.map((t) => (
              <SelectItem key={t.slug} value={t.slug}>{t.display_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => reject.mutate()} disabled={busy}>
          {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileX className="h-4 w-4 mr-1" />}
          Reject
        </Button>
        <Button size="sm" onClick={() => approve.mutate()} disabled={busy || !finalName.trim()}>
          {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4 mr-1" />}
          Approve
        </Button>
      </div>
    </div>
  );
}

/** Auto-file switch and Scan Shoebox button. Lives in the Vault tab's top row (or in the Shoebox card on the full page). */
export function ShoeboxToolbar({ householdId }: { householdId: string }) {
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const { data: autoEnabled = false } = useQuery({
    queryKey: ["shoebox-auto-enabled", householdId],
    queryFn: async () => {
      const { data, error } = await supabase.from("households").select("shoebox_auto_file_enabled").eq("id", householdId).maybeSingle();
      if (error) throw error;
      return !!(data as { shoebox_auto_file_enabled?: boolean } | null)?.shoebox_auto_file_enabled;
    },
  });

  const toggleAuto = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase.from("households").update({ shoebox_auto_file_enabled: enabled } as never).eq("id", householdId);
      if (error) throw error;
    },
    onSuccess: (_d, enabled) => {
      toast.success(enabled ? "Auto-file on for this household" : "Auto-file off for this household");
      queryClient.invalidateQueries({ queryKey: ["shoebox-auto-enabled", householdId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scanShoebox = async () => {
    setScanning(true);
    try {
      const res = await callVault("scanShoebox", { householdId });
      toast.success(`Scanned ${res.scanned} file(s) — ${res.proposed} proposed, ${res.skipped} skipped`);
      queryClient.invalidateQueries({ queryKey: ["shoebox-proposals", householdId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <>
      <label className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs" title="Automatically rename and file statements and tax slips when every detail is read off the document. Everything else waits for your review.">
        Auto-file
        <Switch checked={autoEnabled} onCheckedChange={(v) => toggleAuto.mutate(v)} disabled={toggleAuto.isPending} />
      </label>
      <Button size="sm" variant="outline" onClick={scanShoebox} disabled={scanning}>
        {scanning ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5 mr-1.5" />}
        Scan Shoebox
      </Button>
    </>
  );
}

export default function ShoeboxReviewPanel({ householdId, showControls = true }: { householdId: string; showControls?: boolean }) {
  const queryClient = useQueryClient();

  const { data: proposals = [], isLoading } = useQuery({
    queryKey: ["shoebox-proposals", householdId],
    queryFn: async () => {
      const res = await callVault("listShoeboxProposals", { householdId });
      return (res.proposals ?? []) as ShoeboxProposal[];
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["vault-folder-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vault_folder_templates")
        .select("slug, display_name, position")
        .eq("is_active", true)
        .order("position");
      if (error) throw error;
      return data as FolderTemplate[];
    },
  });

  const { data: autoFiled = [] } = useQuery({
    queryKey: ["shoebox-auto-filed", householdId],
    queryFn: async () => ((await callVault("listShoeboxAutoFiled", { householdId })).filed ?? []) as AutoFiledRow[],
  });

  const undo = useMutation({
    mutationFn: (proposalId: string) => callVault("undoShoeboxAutoFile", { proposalId }),
    onSuccess: () => {
      toast.success("Put back in the Shoebox under its original name");
      queryClient.invalidateQueries({ queryKey: ["shoebox-auto-filed", householdId] });
      queryClient.invalidateQueries({ queryKey: ["vault"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base font-serif flex items-center gap-2">
          Shoebox review
          {proposals.length > 0 && <Badge>{proposals.length} pending</Badge>}
        </CardTitle>
        {showControls && <div className="ml-auto flex items-center gap-2"><ShoeboxToolbar householdId={householdId} /></div>}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground italic">Loading…</p>
        ) : proposals.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground italic">
            <FileQuestion className="h-4 w-4" /> Nothing pending review. New Shoebox uploads are classified
            automatically — use "Scan Shoebox" to check for backlog or anything missed.
          </p>
        ) : (
          proposals.map((p) => <ProposalRow key={p.id} proposal={p} templates={templates} />)
        )}
        {autoFiled.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Auto-filed in the last 14 days</p>
            {autoFiled.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{f.proposed_name}</div>
                  <div className="truncate text-xs text-muted-foreground">was {f.original_name} · {f.proposed_category_slug ?? "Shoebox"}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => undo.mutate(f.id)} disabled={undo.isPending}>
                  <Undo2 className="h-4 w-4 mr-1" /> Undo
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
