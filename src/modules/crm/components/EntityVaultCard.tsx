import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FolderLock, Loader2, Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { callVault } from "@/modules/crm/pages/Vault";

interface Props {
  corporation: { id: string; name: string; vault_root_folder_id?: string | null; home_household_id?: string | null };
  /** Contact ids of the corporation's individual shareholders: suggested, never granted automatically. */
  shareholderContactIds: string[];
  onChanged: () => void;
}

interface Person { id: string; name: string; household_id: string | null }
interface Access { id: string; contactId: string; name: string; role: string; capability: string }

const CAP_LABEL: Record<string, string> = { view: "View", upload: "View + upload", manage: "Manage" };
const ROLES = ["shareholder", "director", "officer", "accountant", "other"];

/** A corporation's Drive vault: pick its home household, create it, and name who may open it. Access is explicit. */
export function EntityVaultCard({ corporation, shareholderContactIds, onChanged }: Props) {
  const [households, setHouseholds] = useState<{ id: string; label: string }[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [busy, setBusy] = useState(false);
  const [contactId, setContactId] = useState("");
  const [role, setRole] = useState("shareholder");
  const [capability, setCapability] = useState("upload");
  const homeId = corporation.home_household_id ?? "";
  const hasVault = !!corporation.vault_root_folder_id;

  const load = useCallback(async () => {
    const { data: hh } = await supabase.from("households").select("id, label").not("vault_folder_id", "is", null).order("label");
    setHouseholds((hh ?? []) as any);
    const ids = new Set(shareholderContactIds);
    const { data: sh } = ids.size ? await supabase.from("contacts").select("id, first_name, last_name, household_id").in("id", [...ids]) : { data: [] as any[] };
    const { data: members } = homeId ? await supabase.from("contacts").select("id, first_name, last_name, household_id").eq("household_id", homeId) : { data: [] as any[] };
    const byId = new Map<string, Person>();
    for (const c of [...(sh ?? []), ...(members ?? [])] as any[]) byId.set(c.id, { id: c.id, name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(), household_id: c.household_id });
    setPeople([...byId.values()]);
    if (hasVault) {
      try { setAccess(((await callVault("getEntityAccess", { corporationId: corporation.id })).access ?? []) as Access[]); } catch { setAccess([]); }
    }
  }, [corporation.id, homeId, hasVault, shareholderContactIds.join(",")]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); onChanged(); }
    catch (e: any) { toast.error(e?.message === "household_no_vault" ? "That household has no Vault yet." : e?.message ?? "Something went wrong"); }
    finally { setBusy(false); }
  };

  const setHome = (id: string) => run(async () => {
    const { error } = await supabase.from("corporations").update({ home_household_id: id } as any).eq("id", corporation.id);
    if (error) throw error;
  }, "Home household saved");
  const create = () => run(async () => { await callVault("provisionEntityVault", { corporationId: corporation.id }); }, "Corporate Vault created");
  const grant = () => run(async () => { await callVault("setEntityAccess", { corporationId: corporation.id, contactId, role, capability }); setContactId(""); }, "Access saved");
  const revoke = (cid: string) => run(async () => { await callVault("setEntityAccess", { corporationId: corporation.id, contactId: cid, revoke: true }); }, "Access removed");

  const named = new Set(access.map((a) => a.contactId));
  const candidates = people.filter((p) => !named.has(p.id));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><FolderLock className="h-5 w-5 text-accent" /> Corporate Vault</CardTitle>
        {hasVault && <Button asChild size="sm" variant="outline"><Link to={`/vault/drawer/entity/${corporation.id}`}>Open</Link></Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Home household: the Household Vault this company's vault is filed under.</p>
          <Select value={homeId} onValueChange={setHome} disabled={busy || hasVault}>
            <SelectTrigger><SelectValue placeholder="Choose a household" /></SelectTrigger>
            <SelectContent>{households.map((h) => <SelectItem key={h.id} value={h.id}>{h.label}</SelectItem>)}</SelectContent>
          </Select>
          {hasVault && <p className="text-xs text-muted-foreground">Fixed once the vault exists.</p>}
        </div>

        {!hasVault ? (
          <Button onClick={create} disabled={busy || !homeId} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create Corporate Vault
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">Who can open it</p>
            <p className="text-xs text-muted-foreground">Only the people named here (and staff). Being a shareholder or a household member does not open it by itself.</p>
            {access.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nobody has been named yet.</p>}
            {access.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 border-b border-border py-1.5 text-sm last:border-0">
                <div className="min-w-0"><span className="font-medium">{a.name}</span> <span className="text-muted-foreground">· {a.role} · {CAP_LABEL[a.capability] ?? a.capability}</span></div>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`Remove ${a.name}`} disabled={busy} onClick={() => revoke(a.contactId)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger className="w-[190px]"><SelectValue placeholder="Add a person" /></SelectTrigger>
                <SelectContent>{candidates.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={capability} onValueChange={setCapability}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CAP_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" onClick={grant} disabled={busy || !contactId} className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Add</Button>
            </div>
            {candidates.length === 0 && <p className="text-xs text-muted-foreground">Shareholders and members of the home household appear here.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
