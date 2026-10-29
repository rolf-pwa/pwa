import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { ShieldCheck, Mail, Phone, User } from "lucide-react";
import ProPortalShell, { FN, proFetch } from "@/modules/pro/components/ProPortalShell";
import ProTasksPanel from "@/modules/pro/components/ProTasksPanel";
import SharedFolderCard from "@/modules/pro/components/SharedFolderCard";
import { format } from "date-fns";
import { toast } from "sonner";

export default function ProPortalContact() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(FN.workspace, proFetch({ action: "contact", contact_id: id }));
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      setData(d);
    } catch (e: any) {
      toast.error(e.message || "Could not load contact");
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const contact = data?.contact;
  const governance = data?.governance;

  const displayName = contact
    ? (contact.full_name || `${contact.first_name || ""} ${contact.last_name || ""}`.trim())
    : "Contact";

  return (
    <ProPortalShell
      firmTitle={displayName}
      subtitle={contact?.family_role ? contact.family_role.replace(/_/g, " ") : "Client"}
      crumbs={[
        { label: "Portal", to: "/pro-portal" },
        { label: data?.family?.name || "Family", to: data?.family?.id ? `/pro-portal/family/${data.family.id}` : undefined },
        { label: data?.household?.label || "Household", to: data?.household?.id ? `/pro-portal/household/${data.household.id}` : undefined },
        { label: displayName },
      ]}
      stats={[
        { label: "Charter", value: (governance?.charter ? "Ratified" : "Pending") },
      ]}
    >
      {!data ? (
        <div className="p-16 text-center text-muted-foreground">Loading contact…</div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <Card className="border-accent/20">
              <CardHeader>
                <CardTitle className="font-serif text-foreground flex items-center gap-2">
                  <User className="h-4 w-4 text-accent" /> Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Email</div>
                  <div className="flex items-center gap-1.5 mt-1"><Mail className="h-3 w-3 text-muted-foreground" />{contact?.email || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Phone</div>
                  <div className="flex items-center gap-1.5 mt-1"><Phone className="h-3 w-3 text-muted-foreground" />{contact?.phone || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Household</div>
                  <div className="mt-1">{data?.household?.label || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Family</div>
                  <div className="mt-1">{data?.family?.name || "—"}</div>
                </div>
                {contact?.is_minor && (
                  <div className="sm:col-span-2">
                    <Badge variant="outline" className="text-[10px]">Minor — restricted disclosure</Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <ProTasksPanel scopeType="contact" scopeId={id!} />
          </div>

          <aside className="space-y-5">
            <Card className="border-accent/15">
              <CardHeader>
                <CardTitle className="text-base font-serif flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-accent" /> Charter Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!governance?.charter ? (
                  <p className="text-sm text-muted-foreground">No individual charter on file.</p>
                ) : (
                  <div>
                    <div className="text-sm text-foreground font-medium">{governance.charter.title || "Sovereignty Charter™"}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Last updated {format(new Date(governance.charter.updated_at), "PP")}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <SharedFolderCard householdId={data?.household?.id ?? null} />
          </aside>
        </div>
      )}
    </ProPortalShell>
  );
}
