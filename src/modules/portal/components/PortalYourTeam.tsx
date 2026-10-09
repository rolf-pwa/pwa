import { useState } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Users, Scale, Calculator, Shield, ScrollText, HeartHandshake, Briefcase, ChevronDown, ChevronRight } from "lucide-react";

const TYPE_META: Record<string, { label: string; Icon: any }> = {
  lawyer: { label: "Lawyer", Icon: Scale },
  accountant: { label: "Accountant", Icon: Calculator },
  insurance_broker: { label: "Insurance Broker", Icon: Shield },
  executor: { label: "Executor", Icon: ScrollText },
  poa: { label: "Power of Attorney", Icon: ScrollText },
  financial_planner: { label: "Financial Planner", Icon: Briefcase },
  philanthropy: { label: "Philanthropy Advisor", Icon: HeartHandshake },
  other: { label: "Advisor", Icon: Briefcase },
};

interface Engagement {
  id: string;
  professional_id: string;
  pillar: string | null;
  title: string;
  status: string;
}

interface Professional {
  id: string;
  full_name: string;
  firm: string | null;
  professional_type: string;
  credentials: string | null;
}

export function PortalYourTeam({
  professionals,
  engagements,
  onSelect,
}: {
  professionals: Professional[];
  engagements: Engagement[];
  onSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!professionals?.length) return null;

  const byPro = (id: string) => engagements.filter((e) => e.professional_id === id);

  return (
    <Card className="border-accent/15">
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
          <Users className="h-4 w-4 text-accent" />
          <h3 className="font-serif text-sm text-foreground">Your Team</h3>
          <span className="ml-auto text-xs text-muted-foreground">{professionals.length}</span>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {open && <ul className="space-y-2.5">
          {professionals.map((p) => {
            const meta = TYPE_META[p.professional_type] || TYPE_META.other;
            const open = byPro(p.id).filter((e) => e.status === "active" || e.status === "invited").length;
            return (
              <li
                key={p.id}
                className="flex items-start gap-3 rounded-md border border-accent/10 bg-accent/[0.02] p-2.5"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 shrink-0">
                  <meta.Icon className="h-4 w-4 text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">
                    {p.full_name}
                    {p.credentials ? <span className="text-muted-foreground text-xs">, {p.credentials}</span> : null}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {meta.label}{p.firm ? ` · ${p.firm}` : ""}
                  </p>
                  {open > 0 && (
                    <p className="text-[10px] text-accent mt-0.5">
                      {open} active engagement{open === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>}
        {open && onSelect && (
          <button
            onClick={onSelect}
            className="w-full text-[11px] uppercase tracking-wider text-muted-foreground hover:text-accent transition-colors pt-1"
          >
            View all professionals →
          </button>
        )}
      </CardContent>
    </Card>
  );
}
