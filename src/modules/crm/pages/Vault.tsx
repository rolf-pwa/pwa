import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, Navigate, Link } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/components/ui/collapsible";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/shared/components/ui/select";
import { Badge } from "@/shared/components/ui/badge";
import {
  Folder,
  FileText,
  ChevronRight,
  ChevronDown,
  Loader2,
  Download,
  Eye,
  UserPlus,
  ShieldCheck,
  Trash2,
  Copy,
  Share2,
  Plus,
  KeyRound,
  Brain,
  ExternalLink,
} from "lucide-react";
import { indexVaultFile } from "@/shared/lib/brain";
import ShoeboxReviewPanel from "@/modules/crm/components/vault/ShoeboxReviewPanel";
import { toast } from "sonner";

type DriveFolder = { id: string; name: string; modifiedTime?: string };
type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime?: string;
};
type ShareTarget = { driveId: string; name: string; isFolder: boolean };

const FUNCTIONS_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/vault-service`;

/** A collapsed-by-default section in the Vault page's sidebar. */
function VaultSidebarSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:text-accent">
        {title}
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-2 pb-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function formatSize(n: number | null) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function callVault(action: string, payload: Record<string, unknown> = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(FUNCTIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function FolderNode({
  folderId,
  name,
  depth,
  householdId,
  onPreview,
  onShare,
}: {
  folderId: string;
  name: string;
  depth: number;
  householdId?: string;
  onPreview: (file: DriveFile) => void;
  onShare: (target: ShareTarget) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [loading, setLoading] = useState(false);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [visMap, setVisMap] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [brainBusyId, setBrainBusyId] = useState<string | null>(null);

  const addToBrain = async (f: DriveFile) => {
    setBrainBusyId(f.id);
    try {
      await indexVaultFile({ driveId: f.id, name: f.name, mimeType: f.mimeType, householdId });
      toast.success(`"${f.name}" added to the Second Brain`);
    } catch (e: any) {
      toast.error(e.message || "Could not add this file to the Second Brain");
    } finally {
      setBrainBusyId(null);
    }
  };

  const loadVisibility = async (ids: string[]) => {
    if (!ids.length) return;
    const { data } = await supabase
      .from("vault_files")
      .select("drive_id, client_visible")
      .in("drive_id", ids);
    const m: Record<string, boolean> = {};
    (data ?? []).forEach((r: any) => (m[r.drive_id] = r.client_visible));
    setVisMap(m);
  };

  useEffect(() => {
    if (!open || loaded) return;
    (async () => {
      setLoading(true);
      try {
        const json = await callVault("listFolder", { folderId });
        setFolders(json.folders ?? []);
        setFiles(json.files ?? []);
        await loadVisibility((json.files ?? []).map((f: DriveFile) => f.id));
        setLoaded(true);
      } catch (e: any) {
        toast.error(`Vault: ${e.message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, loaded, folderId]);

  const toggleVisibility = async (file: DriveFile, next: boolean) => {
    try {
      await callVault("setVisibility", { fileId: file.id, householdId, clientVisible: next });
      setVisMap((m) => ({ ...m, [file.id]: next }));
      toast.success(next ? "Visible to household" : "Hidden from household");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const renameItem = async (driveId: string, currentName: string, isFolder: boolean) => {
    const next = window.prompt(`Rename ${isFolder ? "folder" : "file"}`, currentName);
    if (!next || next === currentName) return;
    try {
      await callVault("renameItem", { driveId, newName: next });
      toast.success("Renamed");
      if (isFolder) {
        setFolders((arr) => arr.map((f) => (f.id === driveId ? { ...f, name: next } : f)));
      } else {
        setFiles((arr) => arr.map((f) => (f.id === driveId ? { ...f, name: next } : f)));
      }
    } catch (e: any) { toast.error(e.message); }
  };

  const deleteItem = async (driveId: string, isFolder: boolean) => {
    if (!window.confirm(`Move this ${isFolder ? "folder" : "file"} to Drive trash?`)) return;
    try {
      await callVault("deleteItem", { driveId });
      toast.success("Moved to trash");
      if (isFolder) setFolders((arr) => arr.filter((f) => f.id !== driveId));
      else setFiles((arr) => arr.filter((f) => f.id !== driveId));
    } catch (e: any) { toast.error(e.message); }
  };

  const newSubfolder = async () => {
    const name = window.prompt("New folder name");
    if (!name) return;
    try {
      const res = await callVault("createFolder", { parentFolderId: folderId, name });
      toast.success("Folder created");
      setFolders((arr) => [...arr, { id: res.folderId, name: res.name }]);
    } catch (e: any) { toast.error(e.message); }
  };

  const copyVaultLink = async (driveId: string, isFolder: boolean) => {
    if (!householdId) return;
    // Optional: notify external recipient by email (link only — code shared manually)
    const notifyEmail = window.prompt(
      "Email this link to a recipient? Enter their email to send the link automatically (leave blank to just copy).\n\nFor security, the unlock code is NOT emailed — share it separately."
    );
    try {
      const res = await callVault("createShareLink", {
        householdId,
        scope_type: isFolder ? "folder" : "file",
        drive_id: driveId,
        permission: "view_upload_download",
        link_type: "guest",
        generate_unlock_code: true,
        notify_email: notifyEmail?.trim() || undefined,
      });
      const url = `${window.location.origin}/vault/share/${res.link.token}`;
      await navigator.clipboard.writeText(`${url}\nUnlock code: ${res.link.unlock_code}`);
      if (notifyEmail?.trim()) {
        if (res.email_sent) {
          toast.success(`Link emailed to ${notifyEmail.trim()}. Unlock code copied — send it separately.`);
        } else {
          toast.warning(`Link created and copied, but the email to ${notifyEmail.trim()} failed to send (${res.email_reason || "unknown error"}). Send the link manually.`);
        }
      } else {
        toast.success("Vault link copied (with unlock code)");
      }
    } catch (e: any) { toast.error(e.message); }
  };

  const isShoebox =
    depth > 0 && (name?.toLowerCase().includes("shoebox") ?? false);

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 16 }}>
      <div
        className={`flex items-center gap-2 py-1.5 group ${
          isShoebox ? "bg-accent/10 border-l-2 border-accent pl-1.5 rounded-sm" : ""
        }`}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left hover:text-accent flex-1"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Folder className={`h-4 w-4 ${isShoebox ? "text-accent" : "text-accent"}`} />
          <span className={`font-serif ${isShoebox ? "text-accent font-semibold" : ""}`}>{name}</span>
          {isShoebox && (
            <Badge variant="outline" className="ml-1 text-[10px] border-accent/50 text-accent">
              Client Uploads
            </Badge>
          )}
          {loading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
        </button>
        {householdId && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
            <Button size="sm" variant="ghost" className="h-7 px-1.5" title="New subfolder" onClick={newSubfolder}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Rename folder" onClick={() => renameItem(folderId, name, true)}>
              <span className="text-[10px] font-mono">Aa</span>
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Copy Vault link" onClick={() => copyVaultLink(folderId, true)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Share with collaborator" onClick={() => onShare({ driveId: folderId, name, isFolder: true })}>
              <Share2 className="h-3.5 w-3.5" />
            </Button>
            {depth > 0 && (
              <Button size="sm" variant="ghost" className="h-7 px-1.5 text-destructive" title="Move to trash" onClick={() => deleteItem(folderId, true)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
      {open && (
        <div className="border-l border-border ml-2 pl-2">
          {folders.map((f) => (
            <FolderNode
              key={f.id}
              folderId={f.id}
              name={f.name}
              depth={depth + 1}
              householdId={householdId}
              onPreview={onPreview}
              onShare={onShare}
            />
          ))}
          {files.map((f) => {
            const visible = visMap[f.id] !== false; // default visible; staff can toggle off
            return (
              <div key={f.id} className="flex items-center gap-2 py-1.5 text-sm group">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{f.name}</span>
                {householdId && (
                  <span className="flex items-center gap-1.5 mr-2" title="Visible to client">
                    <ShieldCheck className={`h-3.5 w-3.5 ${visible ? "text-accent" : "text-muted-foreground/40"}`} />
                    <Switch checked={visible} onCheckedChange={(v) => toggleVisibility(f, v)} />
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{formatSize(f.size)}</span>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onPreview(f)}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => downloadFile(f)}>
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  title="Add to Second Brain"
                  disabled={brainBusyId === f.id}
                  onClick={() => addToBrain(f)}
                >
                  {brainBusyId === f.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Brain className="h-3.5 w-3.5" />
                  )}
                </Button>
                {householdId && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Rename" onClick={() => renameItem(f.id, f.name, false)}>
                      <span className="text-[10px] font-mono">Aa</span>
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Copy Vault link" onClick={() => copyVaultLink(f.id, false)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Share with collaborator" onClick={() => onShare({ driveId: f.id, name: f.name, isFolder: false })}>
                      <Share2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-1.5 text-destructive" title="Move to trash" onClick={() => deleteItem(f.id, false)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {loaded && folders.length === 0 && files.length === 0 && (
            <div className="text-xs text-muted-foreground py-1 italic">Empty</div>
          )}
        </div>
      )}
    </div>
  );
}

async function fetchStream(fileId: string, disposition: "inline" | "attachment") {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}?disposition=${disposition}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ action: "streamFile", fileId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.blob();
}

async function downloadFile(file: DriveFile) {
  try {
    const blob = await fetchStream(file.id, "attachment");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e: any) {
    toast.error(e.message);
  }
}

type Collaborator = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  invited_at: string;
  revoked_at: string | null;
  professional_id: string | null;
};

type LinkedProfessional = { id: string; full_name: string; professional_type: string };

type Grant = {
  id: string;
  scope_type: "folder" | "file";
  drive_id: string;
  drive_name?: string;
  permission: "view" | "upload";
  expires_at: string | null;
  revoked_at: string | null;
};

function GrantsList({ collaboratorId }: { collaboratorId: string }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await callVault("listGrants", { collaboratorId });
      setGrants(res.grants ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); }, [collaboratorId]);

  const updateGrant = async (grantId: string, patch: Record<string, unknown>) => {
    try {
      await callVault("updateGrant", { grantId, ...patch });
      toast.success("Grant updated");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  if (loading) return <div className="text-xs text-muted-foreground py-2">Loading grants…</div>;
  if (!grants.length) return <div className="text-xs text-muted-foreground py-2 italic">No grants — collaborator can't see anything yet. Click a Share icon on a folder/file above.</div>;

  return (
    <div className="space-y-1.5 mt-2">
      {grants.map((g) => {
        const expired = g.expires_at && new Date(g.expires_at) <= new Date();
        const active = !g.revoked_at && !expired;
        return (
          <div key={g.id} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
            <Badge variant="outline" className="capitalize text-[10px]">{g.scope_type}</Badge>
            <Badge variant={g.permission === "upload" ? "default" : "secondary"} className="capitalize text-[10px]">{g.permission}</Badge>
            <span className="flex-1 truncate font-mono">{g.drive_name ?? g.drive_id}</span>
            <span className="text-muted-foreground">
              {g.revoked_at ? "revoked" : g.expires_at ? `exp ${new Date(g.expires_at).toLocaleDateString()}` : "no expiry"}
            </span>
            {active && (
              <>
                <Button size="sm" variant="ghost" className="h-6 px-1.5" title="Extend +30 days" onClick={() => updateGrant(g.id, { expires_at: new Date(Date.now() + 30 * 86400000).toISOString() })}>+30d</Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5" title="Remove expiry" onClick={() => updateGrant(g.id, { expires_at: null })}>∞</Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5" title="Toggle permission" onClick={() => updateGrant(g.id, { permission: g.permission === "view" ? "upload" : "view" })}>{g.permission === "view" ? "→upload" : "→view"}</Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-destructive" title="Revoke" onClick={() => updateGrant(g.id, { revoke: true })}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CollaboratorsPanel({
  householdId,
  rootId,
  shareTarget,
  onShareHandled,
  deepLinkProfessionalId,
}: {
  householdId: string;
  rootId: string;
  shareTarget: ShareTarget | null;
  onShareHandled: () => void;
  deepLinkProfessionalId?: string | null;
}) {
  const [list, setList] = useState<Collaborator[]>([]);
  const [linkedPros, setLinkedPros] = useState<LinkedProfessional[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [form, setForm] = useState({ email: "", fullName: "", role: "lawyer" });
  // pickerValue is prefixed to disambiguate the two id spaces in one Select:
  // "guest:<vault_collaborators.id>" or "pro:<professionals.id>".
  const [grantForm, setGrantForm] = useState({ pickerValue: "", permission: "view", expiresInDays: "30" });
  const [issued, setIssued] = useState<{ token: string; code: string; name: string } | null>(null);

  const refresh = async () => {
    const { data } = await (supabase as any)
      .from("vault_collaborators")
      .select("id, email, full_name, role, invited_at, revoked_at, professional_id")
      .eq("household_id", householdId)
      .order("invited_at", { ascending: false });
    setList((data ?? []) as Collaborator[]);
  };
  // Professionals with an active engagement resolving to this household —
  // offered directly, no invite step needed, regardless of whether they
  // already have a vault_collaborators row (selecting one again just adds
  // another grant to their existing row).
  const refreshLinkedPros = async () => {
    const { data: members } = await supabase.from("contacts").select("id").eq("household_id", householdId);
    const memberIds = (members ?? []).map((m: any) => m.id);
    const orParts = [`and(scope_type.eq.household,scope_id.eq.${householdId})`];
    if (memberIds.length) orParts.push(`and(scope_type.eq.contact,scope_id.in.(${memberIds.join(",")}))`);
    const { data: engs } = await (supabase as any)
      .from("professional_engagements")
      .select("professional_id")
      .or(orParts.join(","))
      .in("status", ["invited", "active", "completed"]);
    const proIds = Array.from(new Set((engs ?? []).map((e: any) => e.professional_id)));
    if (!proIds.length) { setLinkedPros([]); return; }
    const { data: pros } = await (supabase as any)
      .from("professionals")
      .select("id, full_name, professional_type")
      .in("id", proIds);
    setLinkedPros((pros ?? []) as LinkedProfessional[]);
  };
  useEffect(() => { if (householdId) { refresh(); refreshLinkedPros(); } }, [householdId]);

  // When a share request comes in from the file tree, open share dialog —
  // pre-select a deep-linked professional (from ProVaultAccessSummary's
  // "Grant Vault Access" button) if one was passed in.
  useEffect(() => {
    if (shareTarget) {
      setGrantForm({
        pickerValue: deepLinkProfessionalId ? `pro:${deepLinkProfessionalId}` : "",
        permission: "view",
        expiresInDays: "30",
      });
      setShareOpen(true);
    }
  }, [shareTarget]);

  const computeExpiry = (days: string) => {
    const n = Number(days);
    if (!n || n <= 0) return null;
    return new Date(Date.now() + n * 86400000).toISOString();
  };

  const invite = async () => {
    try {
      const res = await callVault("inviteCollaborator", {
        householdId,
        email: form.email,
        fullName: form.fullName,
        role: form.role,
        grants: [],
      });
      setIssued({ token: res.magicToken, code: res.unlockCode, name: form.fullName });
      toast.success("Collaborator invited");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const revoke = async (id: string) => {
    try {
      await callVault("revokeCollaborator", { collaboratorId: id });
      toast.success("Access revoked");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const reissue = async (c: Collaborator) => {
    try {
      const res = await callVault("reissueGuestToken", { collaboratorId: c.id });
      setIssued({ token: res.magicToken, code: res.unlockCode, name: c.full_name });
      setInviteOpen(true);
    } catch (e: any) { toast.error(e.message); }
  };

  const submitShare = async () => {
    if (!shareTarget || !grantForm.pickerValue) return;
    const [kind, id] = grantForm.pickerValue.split(":");
    const scope_type = shareTarget.isFolder ? "folder" : "file";
    const expires_at = computeExpiry(grantForm.expiresInDays);
    try {
      if (kind === "pro") {
        await callVault("shareWithProfessional", {
          householdId,
          professionalId: id,
          scope_type,
          drive_id: shareTarget.driveId,
          permission: grantForm.permission,
          expires_at,
        });
        toast.success(`Shared with ${linkedPros.find((p) => p.id === id)?.full_name}`);
        await refresh();
      } else {
        await callVault("addGrant", {
          collaboratorId: id,
          scope_type,
          drive_id: shareTarget.driveId,
          permission: grantForm.permission,
          expires_at,
        });
        toast.success(`Shared with ${list.find((c) => c.id === id)?.full_name}`);
      }
      setShareOpen(false);
      onShareHandled();
    } catch (e: any) { toast.error(e.message); }
  };

  const guestUrl = (token: string) => `${window.location.origin}/vault/guest/${token}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-serif">Collaborators</CardTitle>
        <Button size="sm" onClick={() => { setIssued(null); setForm({ email: "", fullName: "", role: "lawyer" }); setInviteOpen(true); }}>
          <UserPlus className="h-4 w-4 mr-1" /> Invite
        </Button>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No collaborators yet. Invite one, then click the Share icon on any folder or file above.</p>
        ) : (
          <div className="space-y-2">
            {list.map((c) => (
              <div key={c.id} className="border rounded p-2">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className="capitalize">{c.role}</Badge>
                  <button className="flex-1 text-left" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                    <div className="font-medium">{c.full_name}</div>
                    <div className="text-xs text-muted-foreground">{c.email}</div>
                  </button>
                  {c.revoked_at ? (
                    <Badge variant="secondary">Revoked</Badge>
                  ) : (
                    <>
                      {c.professional_id ? (
                        <Button size="sm" variant="ghost" title="Open professional profile" asChild>
                          <Link to={`/professionals/${c.professional_id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" title="Reissue magic link" onClick={() => reissue(c)}>
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" title="Revoke all access" onClick={() => revoke(c.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
                {expandedId === c.id && !c.revoked_at && <GrantsList collaboratorId={c.id} />}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Invite dialog (also reused for displaying reissued tokens) */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">{issued ? "Magic link" : "Invite collaborator"}</DialogTitle>
          </DialogHeader>
          {!issued ? (
            <div className="space-y-3">
              <div>
                <Label>Full name</Label>
                <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lawyer">Lawyer</SelectItem>
                    <SelectItem value="accountant">Accountant</SelectItem>
                    <SelectItem value="executor">Executor</SelectItem>
                    <SelectItem value="poa">Power of Attorney</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                After inviting, click the Share icon on any folder or file to grant access. Each grant has its own permission and expiry.
              </p>
              <Button onClick={invite} className="w-full">Invite & generate link</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">Send these to <strong>{issued.name}</strong> via your normal secure channel.</p>
              <div>
                <Label>Magic link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={guestUrl(issued.token)} />
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(guestUrl(issued.token)); toast.success("Copied"); }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label>Unlock code (required on first open)</Label>
                <div className="flex gap-2">
                  <Input readOnly value={issued.code} className="font-mono text-lg tracking-widest" />
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(issued.code); toast.success("Copied"); }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Link valid 24 hours. After unlock, session is bound to their browser.</p>
              <Button onClick={() => setInviteOpen(false)} className="w-full">Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Share dialog (per folder/file) */}
      <Dialog open={shareOpen} onOpenChange={(o) => { setShareOpen(o); if (!o) onShareHandled(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">
              Share {shareTarget?.isFolder ? "folder" : "file"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm bg-muted/40 rounded p-2 truncate">{shareTarget?.name}</div>
            {linkedPros.length === 0 && list.filter((c) => !c.revoked_at).length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No one to share with yet — link a professional to this household, or invite a guest collaborator below.</p>
            ) : (
              <>
                <div>
                  <Label>Share with</Label>
                  <Select value={grantForm.pickerValue} onValueChange={(v) => setGrantForm({ ...grantForm, pickerValue: v })}>
                    <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>
                      {linkedPros.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Linked Professionals</SelectLabel>
                          {linkedPros.map((p) => (
                            <SelectItem key={`pro:${p.id}`} value={`pro:${p.id}`}>{p.full_name} ({p.professional_type.replace(/_/g, " ")})</SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {list.filter((c) => !c.revoked_at && !c.professional_id).length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Guest Collaborators</SelectLabel>
                          {list.filter((c) => !c.revoked_at && !c.professional_id).map((c) => (
                            <SelectItem key={`guest:${c.id}`} value={`guest:${c.id}`}>{c.full_name} ({c.role})</SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Permission</Label>
                    <Select value={grantForm.permission} onValueChange={(v) => setGrantForm({ ...grantForm, permission: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="view">View only</SelectItem>
                        {shareTarget?.isFolder && <SelectItem value="upload">View + upload</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Expires in (days)</Label>
                    <Input type="number" min={0} value={grantForm.expiresInDays} onChange={(e) => setGrantForm({ ...grantForm, expiresInDays: e.target.value })} />
                    <p className="text-[10px] text-muted-foreground mt-1">0 or empty = no expiry</p>
                  </div>
                </div>
                <Button onClick={submitShare} className="w-full" disabled={!grantForm.pickerValue}>Grant access</Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

type Member = { id: string; first_name: string; last_name: string; email: string | null };
type ContactRole = { contact_id: string; role: "viewer" | "contributor" | "manager" };
type ShareLink = {
  id: string;
  token: string;
  link_type: "portal" | "guest";
  scope_type: "folder" | "file";
  drive_id: string;
  permission: "view" | "view_upload" | "view_upload_download";
  unlock_code: string | null;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
};

function MemberRolesPanel({ householdId }: { householdId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Record<string, ContactRole["role"]>>({});

  useEffect(() => {
    (async () => {
      const { data: m } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, email")
        .eq("household_id", householdId)
        .order("family_role");
      setMembers((m ?? []) as Member[]);
      try {
        const res = await callVault("listContactPermissions", { householdId });
        const map: Record<string, ContactRole["role"]> = {};
        (res.roles ?? []).forEach((r: ContactRole) => (map[r.contact_id] = r.role));
        setRoles(map);
      } catch (e: any) { toast.error(e.message); }
    })();
  }, [householdId]);

  const setRole = async (contactId: string, role: ContactRole["role"] | "none") => {
    try {
      if (role === "none") {
        // Setting back to viewer effectively removes elevated rights
        await callVault("setContactRole", { contactId, householdId, role: "viewer" });
        setRoles((r) => ({ ...r, [contactId]: "viewer" }));
      } else {
        await callVault("setContactRole", { contactId, householdId, role });
        setRoles((r) => ({ ...r, [contactId]: role }));
      }
      toast.success("Permission updated");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-serif">Household member permissions</CardTitle>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No household members.</p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 border rounded p-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{m.first_name} {m.last_name}</div>
                  <div className="text-xs text-muted-foreground truncate">{m.email ?? "no email"}</div>
                </div>
                <Select value={roles[m.id] ?? "viewer"} onValueChange={(v) => setRole(m.id, v as any)}>
                  <SelectTrigger className="w-[160px] h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="contributor">Contributor (upload + delete own)</SelectItem>
                    <SelectItem value="manager">Manager (full)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          Roles apply across the household vault. Use per-folder grants on a file/folder for finer control.
        </p>
      </CardContent>
    </Card>
  );
}

function VaultLinksPanel({ householdId }: { householdId: string }) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await callVault("listShareLinks", { householdId });
      setLinks(res.links ?? []);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [householdId]);

  const revoke = async (id: string) => {
    if (!window.confirm("Revoke this Vault link?")) return;
    try {
      await callVault("revokeShareLink", { linkId: id });
      toast.success("Revoked");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const copyUrl = async (l: ShareLink) => {
    const url = `${window.location.origin}/vault/share/${l.token}`;
    const txt = l.unlock_code ? `${url}\nUnlock code: ${l.unlock_code}` : url;
    await navigator.clipboard.writeText(txt);
    toast.success("Copied");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-serif">Vault links</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No links yet. Use the copy icon on any folder or file above to create one.</p>
        ) : (
          <div className="space-y-1.5">
            {links.map((l) => {
              const expired = l.expires_at && new Date(l.expires_at) <= new Date();
              const dead = l.revoked_at || expired || (l.max_uses != null && l.use_count >= l.max_uses);
              return (
                <div key={l.id} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
                  <Badge variant="outline" className="capitalize text-[10px]">{l.link_type}</Badge>
                  <Badge variant="outline" className="capitalize text-[10px]">{l.scope_type}</Badge>
                  <Badge variant={l.permission === "view" ? "secondary" : "default"} className="text-[10px]">{l.permission.replace(/_/g, " + ")}</Badge>
                  <span className="flex-1 truncate font-mono">{l.drive_id}</span>
                  <span className="text-muted-foreground">
                    {l.revoked_at ? "revoked" : expired ? "expired" : l.expires_at ? `exp ${new Date(l.expires_at).toLocaleDateString()}` : "no expiry"}
                  </span>
                  {l.max_uses != null && <span className="text-muted-foreground">{l.use_count}/{l.max_uses}</span>}
                  {!dead && (
                    <>
                      <Button size="sm" variant="ghost" className="h-6 px-1.5" title="Copy URL" onClick={() => copyUrl(l)}>
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-destructive" title="Revoke" onClick={() => revoke(l.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function VaultView({ forcedHouseholdId, embedded = false, sidebarTools }: { forcedHouseholdId?: string; embedded?: boolean; sidebarTools?: React.ReactNode }) {
  const params = useParams<{ householdId?: string; contactId?: string }>();
  const [searchParams] = useSearchParams();
  const deepLinkProfessionalId = searchParams.get("shareProfessionalId");
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [householdLabel, setHouseholdLabel] = useState<string>("");
  const [familyName, setFamilyName] = useState<string>("");
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [rootId, setRootId] = useState<string>("");
  const [input, setInput] = useState<string>("");
  const [preview, setPreview] = useState<{ file: DriveFile; url: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);

  // Resolve household: from URL, or from a contactId (legacy URL → redirect)
  useEffect(() => {
    (async () => {
      const hh = forcedHouseholdId ?? params.householdId;
      if (!hh && params.contactId) {
        const { data: c } = await supabase
          .from("contacts")
          .select("household_id, vault_root_folder_id, google_drive_url")
          .eq("id", params.contactId)
          .maybeSingle();
        if (c?.household_id) {
          setRedirectTo(`/vault/household/${c.household_id}`);
          return;
        }
        const fallbackId = c?.google_drive_url?.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1];
        const id = c?.vault_root_folder_id ?? fallbackId ?? "";
        if (id) { setRootId(id); setInput(id); }
        return;
      }
      if (!hh) return;

      const { data: row } = await supabase
        .from("households")
        .select("id, label, vault_root_folder_id, families(name)")
        .eq("id", hh)
        .maybeSingle();
      const { data: members } = await supabase
        .from("contacts")
        .select("first_name, last_name, google_drive_url")
        .eq("household_id", hh)
        .order("family_role");

      setHouseholdId(hh);
      setHouseholdLabel(row?.label ?? "");
      setFamilyName((row as any)?.families?.name ?? "");
      setMemberNames((members ?? []).map((m: any) => `${m.first_name} ${m.last_name ?? ""}`.trim()));
      const id = row?.vault_root_folder_id ?? "";
      if (id) {
        setRootId(id);
        setInput(id);
      } else {
        // Pre-populate from any household member's Google Drive URL
        const driveUrl = (members ?? [])
          .map((m: any) => m.google_drive_url)
          .find((u: string | null) => !!u);
        if (driveUrl) setInput(driveUrl);
      }
    })();
  }, [params.householdId, params.contactId, forcedHouseholdId]);

  

  const provision = async (force = false) => {
    if (!householdId) {
      toast.error("Open this vault from a household.");
      return;
    }
    const raw = input.trim();
    const parentFolderId = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] ?? raw;
    if (!parentFolderId) {
      toast.error("Enter a Drive folder URL or ID first.");
      return;
    }
    if (force && !window.confirm("Create a NEW vault folder for this household? The old root will be left in Drive but unlinked.")) return;
    setProvisioning(true);
    try {
      const res = await callVault("provisionVault", { householdId, parentFolderId, force });
      toast.success(force ? "New vault provisioned" : "Vault provisioned");
      setRootId(res.folderId);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProvisioning(false);
    }
  };

  const setRootFolder = async () => {
    if (!householdId) {
      toast.error("Open this vault from a household.");
      return;
    }
    const raw = input.trim();
    const folderId = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] ?? raw;
    if (!folderId) {
      toast.error("Enter a Drive folder URL or ID.");
      return;
    }
    if (!window.confirm("Point this household's vault at this existing folder?")) return;
    setProvisioning(true);
    try {
      const res = await callVault("setVaultRoot", { householdId, folderId });
      toast.success(`Vault root set to "${res.name}"`);
      setRootId(res.folderId);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProvisioning(false);
    }
  };


  const openPreview = async (file: DriveFile) => {
    setPreviewLoading(true);
    setPreview({ file, url: "" });
    try {
      const blob = await fetchStream(file.id, "inline");
      const url = URL.createObjectURL(blob);
      setPreview({ file, url });
    } catch (e: any) {
      toast.error(e.message);
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewable = useMemo(() => {
    if (!preview) return false;
    const mt = preview.file.mimeType;
    return (
      mt === "application/pdf" ||
      mt.startsWith("image/") ||
      mt.startsWith("text/") ||
      mt.includes("vnd.google-apps.document") ||
      mt.includes("vnd.google-apps.presentation")
    );
  }, [preview]);

  const heading = familyName
    ? `${familyName}${householdLabel && householdLabel !== "Primary" ? ` — ${householdLabel}` : ""}`
    : "Household Vault";

  if (redirectTo) return <Navigate to={redirectTo} replace />;

  const body = (
    <div className={embedded ? "space-y-6" : "container max-w-5xl mx-auto py-8 space-y-6"}>
      {!embedded && (
        <div>
          <h1 className="text-3xl font-serif">The Vault</h1>
          <p className="text-muted-foreground">
            {heading}
            {memberNames.length > 0 && (
              <span className="block text-xs mt-1">Shared by: {memberNames.join(" • ")}</span>
            )}
          </p>
        </div>
      )}

      {!rootId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vault root folder</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2 items-center">
            <Input
              placeholder="Drive folder URL or ID"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <Button
              onClick={() => {
                const m = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
                setRootId(m ? m[1] : input.trim());
              }}
            >
              Load
            </Button>
            {householdId && (
              <Button variant="outline" onClick={() => provision(false)} disabled={provisioning}>
                {provisioning ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Provisioning…</>
                ) : (
                  "Provision"
                )}
              </Button>

            )}
          </CardContent>
        </Card>
      )}

      {rootId && (
        <div className={householdId ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]" : ""}>
          <div className="space-y-6 min-w-0">
            <Card>
              <CardContent className="pt-6">
                <FolderNode
                  folderId={rootId}
                  name={heading}
                  depth={0}
                  householdId={householdId ?? undefined}
                  onPreview={openPreview}
                  onShare={setShareTarget}
                />
              </CardContent>
            </Card>

          </div>

          {householdId && (
            <aside className="space-y-3 min-w-0">
              {sidebarTools && (
                <VaultSidebarSection title="Vault tools" defaultOpen>
                  <div className="px-2 pb-2">{sidebarTools}</div>
                </VaultSidebarSection>
              )}
              <VaultSidebarSection title="Shoebox review" defaultOpen>
                <ShoeboxReviewPanel householdId={householdId} showControls={!sidebarTools} />
              </VaultSidebarSection>
              <VaultSidebarSection title="Collaborators">
                <CollaboratorsPanel
                  householdId={householdId}
                  rootId={rootId}
                  shareTarget={shareTarget}
                  onShareHandled={() => setShareTarget(null)}
                  deepLinkProfessionalId={deepLinkProfessionalId}
                />
              </VaultSidebarSection>
              <VaultSidebarSection title="Member roles">
                <MemberRolesPanel householdId={householdId} />
              </VaultSidebarSection>
              <VaultSidebarSection title="Vault links">
                <VaultLinksPanel householdId={householdId} />
              </VaultSidebarSection>
              <VaultSidebarSection title="Vault root folder">
                <Card>
                  <CardContent className="space-y-3 pt-6">
                    <div className="text-xs text-muted-foreground">
                      Current root: <code className="break-all font-mono">{rootId}</code>
                    </div>
                    <Input placeholder="Drive folder URL or ID" value={input} onChange={(e) => setInput(e.target.value)} />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={setRootFolder} disabled={provisioning}>
                        Use as root
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => provision(true)} disabled={provisioning}>
                        {provisioning ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Working…</>
                        ) : (
                          "Re-provision new folder"
                        )}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      "Use as root" points the household at an existing Drive folder. "Re-provision" creates a fresh
                      vault folder (with template subfolders) under the parent you entered. The old root is left in
                      Drive but unlinked.
                    </p>
                  </CardContent>
                </Card>
              </VaultSidebarSection>
            </aside>
          )}
        </div>
      )}

      <Dialog
        open={!!preview}
        onOpenChange={(o) => {
          if (!o) {
            if (preview?.url) URL.revokeObjectURL(preview.url);
            setPreview(null);
          }
        }}
      >
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-serif">{preview?.file.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden bg-muted rounded">
            {previewLoading || !preview?.url ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : previewable ? (
              preview.file.mimeType.startsWith("image/") ? (
                <img
                  src={preview.url}
                  alt={preview.file.name}
                  className="max-h-full max-w-full mx-auto object-contain"
                />
              ) : (
                <iframe src={preview.url} className="w-full h-full" title={preview.file.name} />
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <p>Preview not available for this file type.</p>
                <Button onClick={() => preview && downloadFile(preview.file)}>
                  <Download className="h-4 w-4 mr-2" /> Download
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  return body;
}

export default function Vault() {
  return <VaultView />;
}
