import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Link2, Loader2, Shield, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/components/ui/sheet";

const FUNCTIONS_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/vault-service`;

async function callVault(action: string, payload: Record<string, unknown> = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(FUNCTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export interface AccessTarget { driveId: string; name: string; isFolder: boolean }

interface Access {
  summary: string;
  members: Array<{ contactId: string; name: string; role: string; capability: "view" | "upload" | "manage" | null; reason: string | null }>;
  invited: Array<{ grantId: string; kind: "collaborator" | "professional"; name: string; email: string; permission: string; expiresAt: string | null; status: "active" | "expired"; expiringSoon: boolean; inheritedFrom: string | null }>;
  contactGrants: Array<{ grantId: string; contactId: string; name: string; permission: string; expiresAt: string | null; inheritedFrom: string | null }>;
  links: Array<{ linkId: string; type: string; permission: string; expiresAt: string | null; status: "active" | "expired" | "used_up"; uses: number; maxUses: number | null; inheritedFrom: string | null; name: string | null }>;
}

const CAP: Record<string, string> = { view: "Can view", upload: "Can view and upload", manage: "Can manage", view_upload: "Can view and upload", view_upload_download: "View, upload and download" };
const cap = (p: string) => CAP[p] ?? p;
const when = (iso: string | null) => (iso ? `until ${format(new Date(iso), "MMM d, yyyy")}` : "no expiry");

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 font-serif text-sm font-semibold text-foreground">{icon}{title}</h3>
      <div className="divide-y divide-border rounded-md border border-border">{children}</div>
    </section>
  );
}

/** Everyone and everything that can open one file or folder, with the controls to change it. */
export function VaultAccessSheet({ open, onOpenChange, householdId, target, onInvite }: {
  open: boolean; onOpenChange: (o: boolean) => void; householdId: string; target: AccessTarget | null; onInvite: (t: AccessTarget) => void;
}) {
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    try {
      const res = await callVault("getItemAccess", { householdId, driveId: target.driveId });
      setAccess(res.access as Access);
    } catch (e: any) {
      toast.error(`Couldn't load access: ${e.message}`);
      setAccess(null);
    } finally { setLoading(false); }
  }, [householdId, target]);

  useEffect(() => { if (open) { setAccess(null); load(); } }, [open, load]);

  const act = async (key: string, run: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await run(); toast.success(done); await load(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };
  const plus30 = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
  const inherited = (from: string | null) => from && <span className="block text-[11px] text-amber-700">From folder “{from}”: changing it changes everything inside</span>;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="text-left">
          <SheetTitle className="font-serif">Who has access</SheetTitle>
          <SheetDescription className="truncate">{target?.isFolder ? "Folder" : "File"}: {target?.name}</SheetDescription>
        </SheetHeader>

        {loading && !access && <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

        {access && target && (
          <div className="mt-4 space-y-6">
            <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-foreground">{access.summary}</p>

            <Section icon={<Users className="h-4 w-4 text-accent" />} title="Household members">
              {access.members.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No members on this household.</p>}
              {access.members.map((m) => (
                <div key={m.contactId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{m.name}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{m.role} role</p>
                  </div>
                  {m.capability
                    ? <Badge variant="outline" className="shrink-0 text-[11px] font-normal">{cap(m.capability)}</Badge>
                    : <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">{m.reason ?? "No access"}</Badge>}
                </div>
              ))}
            </Section>

            <Section icon={<Shield className="h-4 w-4 text-accent" />} title="Invited people and professionals">
              {access.invited.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">Nobody outside the household has been invited to this.</p>}
              {access.invited.map((g) => (
                <div key={g.grantId} className="space-y-1.5 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{g.name} {g.kind === "professional" && <Badge variant="outline" className="ml-1 text-[10px] font-normal">Professional</Badge>}</p>
                      {g.name !== g.email && <p className="truncate text-[11px] text-muted-foreground">{g.email}</p>}
                      {inherited(g.inheritedFrom)}
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="outline" className="text-[11px] font-normal">{cap(g.permission)}</Badge>
                      <p className={`mt-0.5 text-[11px] ${g.status === "expired" ? "text-destructive" : g.expiringSoon ? "text-amber-700" : "text-muted-foreground"}`}>
                        {g.status === "expired" ? `Expired ${format(new Date(g.expiresAt!), "MMM d")}` : g.expiringSoon ? `Expires soon · ${when(g.expiresAt)}` : when(g.expiresAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy === g.grantId}
                      onClick={() => act(g.grantId, () => callVault("updateGrant", { grantId: g.grantId, expires_at: plus30() }), "Extended 30 days")}>Extend 30 days</Button>
                    {g.expiresAt && <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy === g.grantId}
                      onClick={() => act(g.grantId, () => callVault("updateGrant", { grantId: g.grantId, expires_at: null }), "Expiry removed")}>No expiry</Button>}
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-destructive" disabled={busy === g.grantId}
                      onClick={() => { if (window.confirm(`Remove ${g.name}'s access${g.inheritedFrom ? ` to everything in “${g.inheritedFrom}”` : ""}?`)) act(g.grantId, () => callVault("updateGrant", { grantId: g.grantId, revoke: true }), "Access removed"); }}>Remove access</Button>
                  </div>
                </div>
              ))}
              {access.contactGrants.map((g) => (
                <div key={g.grantId} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{g.name} <span className="text-[11px] text-muted-foreground">(household member, named access)</span></p>
                    {inherited(g.inheritedFrom)}
                    <Button size="sm" variant="ghost" className="mt-1 h-6 px-2 text-[11px] text-destructive" disabled={busy === g.grantId}
                      onClick={() => { if (window.confirm(`Remove ${g.name}'s named access?`)) act(g.grantId, () => callVault("revokeContactGrant", { grantId: g.grantId }), "Access removed"); }}>Remove access</Button>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge variant="outline" className="text-[11px] font-normal">{cap(g.permission)}</Badge>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{when(g.expiresAt)}</p>
                  </div>
                </div>
              ))}
            </Section>

            <Section icon={<Link2 className="h-4 w-4 text-accent" />} title="Share links">
              {access.links.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No active links.</p>}
              {access.links.map((l) => (
                <div key={l.linkId} className="space-y-1 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{l.name || (l.type === "guest" ? "Guest link (unlock code)" : "Portal link")}</p>
                      <p className="text-[11px] text-muted-foreground">{l.uses}{l.maxUses != null ? ` of ${l.maxUses}` : ""} use{l.uses === 1 ? "" : "s"}</p>
                      {inherited(l.inheritedFrom)}
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant={l.status === "active" ? "outline" : "secondary"} className="text-[11px] font-normal">{l.status === "active" ? cap(l.permission) : l.status === "expired" ? "Expired" : "Used up"}</Badge>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{when(l.expiresAt)}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-destructive" disabled={busy === l.linkId}
                    onClick={() => { if (window.confirm("Revoke this link? Anyone holding it loses access.")) act(l.linkId, () => callVault("revokeShareLink", { linkId: l.linkId }), "Link revoked"); }}>Revoke link</Button>
                </div>
              ))}
            </Section>

            <p className="text-xs text-muted-foreground">All ProsperWise staff can open every file in the Vault. Every change here is recorded in the Vault audit log.</p>
            <Button className="w-full" onClick={() => { onOpenChange(false); onInvite(target); }}>
              <UserPlus className="mr-2 h-4 w-4" />Invite someone to this {target.isFolder ? "folder" : "file"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
