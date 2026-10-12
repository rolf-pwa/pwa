import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Users, Crown, Home, ChevronRight, ChevronDown } from "lucide-react";
import ProPortalShell, { FN, proFetch } from "@/modules/pro/components/ProPortalShell";
import ProTasksPanel from "@/modules/pro/components/ProTasksPanel";
import { toast } from "sonner";
import { familyTitle } from "@/shared/lib/utils";

const PRO_TYPE_LABELS: Record<string, string> = {
  lawyer: "Legal Counsel", accountant: "Tax & Accounting", insurance: "Insurance",
  estate: "Estate Planner", philanthropy: "Philanthropic Advisor", banker: "Private Banker",
  other: "Advisor",
};

interface HH { id: string; label: string; family_id: string; contacts: any[] }
interface Family { id: string; name: string; households: HH[]; loose_contacts: any[] }
interface Collaborator { id: string; full_name: string; firm: string | null; professional_type: string }

export default function ProPortalFamily() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [family, setFamily] = useState<Family | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [expandedHh, setExpandedHh] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const cached = localStorage.getItem("pro_portal_profile");
      if (cached) setProfile(JSON.parse(cached));
      const res = await fetch(FN.workspace, proFetch({ action: "family", family_id: id }));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setFamily(data.family);
      setCollaborators(data.collaborators || []);
      setExpandedHh(new Set((data.family?.households || []).map((h: HH) => h.id)));
    } catch (e: any) {
      toast.error(e.message || "Could not load family");
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const toggle = (hhId: string) => setExpandedHh((prev) => {
    const n = new Set(prev); n.has(hhId) ? n.delete(hhId) : n.add(hhId); return n;
  });

  const totalHh = family?.households.length || 0;
  const totalContacts = (family?.loose_contacts.length || 0)
    + (family?.households.reduce((s, h) => s + h.contacts.length, 0) || 0);

  const firmTitle = family?.name ? familyTitle(family.name) : "Family Workspace";
  const subtitle = profile ? `${profile.full_name}${profile.professional_type ? ` · ${PRO_TYPE_LABELS[profile.professional_type] || profile.professional_type}` : ""}` : "Concierge Workspace";

  return (
    <ProPortalShell
      firmTitle={firmTitle}
      subtitle={subtitle}
      crumbs={[{ label: "Portal", to: "/pro-portal" }, { label: "Family" }]}
      stats={[
        { label: "Households", value: totalHh },
        { label: "Contacts", value: totalContacts },
        { label: "Collaborators", value: collaborators.length },
      ]}
    >
      {!family ? (
        <div className="p-16 text-center text-muted-foreground">Loading family…</div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <Card className="border-accent/20">
              <CardHeader>
                <CardTitle className="font-serif text-foreground flex items-center gap-2">
                  <Crown className="h-4 w-4 text-accent" /> The {family.name} Directory
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-0">
                <ul className="divide-y divide-border/60">
                  {family.households.map((hh) => {
                    const open = expandedHh.has(hh.id);
                    return (
                      <li key={hh.id}>
                        <div className="flex items-center gap-2 px-4 py-3">
                          <button onClick={() => toggle(hh.id)} className="text-muted-foreground shrink-0">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => navigate(`/pro-portal/household/${hh.id}`)}
                            className="flex-1 text-left flex items-center gap-2 group"
                          >
                            <Home className="h-4 w-4 text-accent" />
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate group-hover:text-accent transition-colors">{hh.label}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {hh.contacts.length} member{hh.contacts.length !== 1 ? "s" : ""}
                              </div>
                            </div>
                          </button>
                        </div>
                        {open && hh.contacts.length > 0 && (
                          <ul className="pl-12 pb-3 space-y-1">
                            {hh.contacts.map((c: any) => (
                              <li key={c.id}>
                                <button
                                  onClick={() => navigate(`/pro-portal/contact/${c.id}`)}
                                  className="w-full text-left px-3 py-1.5 rounded hover:bg-accent/[0.04] transition text-sm flex items-center justify-between group"
                                >
                                  <span className="truncate text-foreground group-hover:text-accent transition-colors">{c.name}</span>
                                  {c.family_role && (
                                    <Badge variant="outline" className="text-[10px]">{c.family_role.replace(/_/g, " ")}</Badge>
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                  {family.loose_contacts.map((c: any) => (
                    <li key={c.id}>
                      <button
                        onClick={() => navigate(`/pro-portal/contact/${c.id}`)}
                        className="w-full text-left px-4 py-3 flex items-center gap-2 hover:bg-accent/[0.03] transition"
                      >
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-foreground">{c.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <ProTasksPanel scopeType="family" scopeId={family.id} />
          </div>

          <aside className="space-y-5">
            <Card className="border-accent/15">
              <CardHeader>
                <CardTitle className="text-base font-serif flex items-center gap-2">
                  <Users className="h-4 w-4 text-accent" /> Collaborators
                </CardTitle>
              </CardHeader>
              <CardContent>
                {collaborators.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No other professionals on this family.</p>
                ) : (
                  <ul className="space-y-2">
                    {collaborators.map((c) => (
                      <li key={c.id} className="border border-border/60 rounded-md px-3 py-2 bg-muted/30">
                        <div className="text-sm text-foreground truncate">{c.full_name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {c.firm ? `${c.firm} · ` : ""}{PRO_TYPE_LABELS[c.professional_type] || c.professional_type}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted-foreground pt-3 mt-3 border-t border-border/60">
                  Direct pro-to-pro coordination routes through ProsperWise.
                </p>
              </CardContent>
            </Card>
          </aside>

        </div>
      )}
    </ProPortalShell>
  );
}
