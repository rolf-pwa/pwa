import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { AppLayout } from "@/shared/components/AppLayout";
import { Card, CardContent } from "@/shared/components/ui/card";
import { ListRowStatic } from "@/shared/components/ListRow";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { CrmTabs } from "@/modules/crm/components/CrmTabs";
import { ContactCsvImport } from "@/modules/crm/components/ContactCsvImport";
import { dialViaQuo } from "@/shared/lib/quo-dial";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import {
  Plus,
  Search,
  Folder,
  FolderOpen,
  CheckSquare,
  ShieldCheck,
  Mail,
  Phone,
  MapPin,
  Lock,
} from "lucide-react";

interface Contact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  household_id: string | null;
  households: { governance_status: string | null; fiduciary_entity: string | null } | null;
  updated_at: string;
  google_drive_url: string | null;
  asana_url: string | null;
  ia_financial_url: string | null;
}

const RESOURCE_ICONS = [
  { key: "google_drive_url" as const, label: "Google Drive", icon: FolderOpen },
  { key: "asana_url" as const, label: "Asana", icon: CheckSquare },
  { key: "ia_financial_url" as const, label: "IA Financial", icon: ShieldCheck },
];

const Contacts = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchContacts = useCallback(async () => {
    const { data } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email, phone, address, household_id, households(governance_status, fiduciary_entity), updated_at, google_drive_url, asana_url, ia_financial_url")
      .order("last_name")
      .order("first_name");
    setContacts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const [searchParams] = useSearchParams();
  const view = searchParams.get("view") === "general" ? "general" : "individuals";
  const [tier, setTier] = useState<string>("all");
  const [stage, setStage] = useState<string>("all");
  const [sort, setSort] = useState<string>("name-asc");

  const filtered = useMemo(() => {
    const clientEntities = new Set(["pwa", "pws"]);
    const base = contacts.filter((c) =>
      view === "general"
        ? !clientEntities.has((c.households?.fiduciary_entity || "").toLowerCase())
        : clientEntities.has((c.households?.fiduciary_entity || "").toLowerCase())
    );
    const searched = base.filter((c) => {
      const name = `${c.first_name} ${c.last_name || ""}`.toLowerCase();
      return name.includes(search.toLowerCase());
    });
    const sorted = [...searched].sort((a, b) => {
      const an = `${a.last_name || a.first_name}`.toLowerCase();
      const bn = `${b.last_name || b.first_name}`.toLowerCase();
      if (sort === "name-desc") return bn.localeCompare(an);
      if (sort === "recent") return (b.updated_at || "").localeCompare(a.updated_at || "");
      return an.localeCompare(bn);
    });
    return sorted;
  }, [contacts, search, view, sort]);

  // Group by first letter of last name
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const grouped = filtered.reduce<Record<string, Contact[]>>((acc, c) => {
    const letter = (c.last_name || c.first_name).charAt(0).toUpperCase();
    const key = alphabet.includes(letter) ? letter : "#";
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  const activeLetters = new Set(Object.keys(grouped));

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Contacts" },
        ]} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <CrmTabs />
          <div className="flex items-center gap-2">
            <ContactCsvImport onImported={fetchContacts} />
            <Link to="/contacts/new">
              <Button
                type="button"
                className="bg-sanctuary-bronze text-sanctuary-charcoal hover:bg-sanctuary-bronze/90"
              >
                <Plus className="mr-2 h-4 w-4" />
                New Contact
              </Button>
            </Link>
          </div>
        </div>

        {/* Filter bar */}
        <Card>
          <CardContent className="grid gap-3 p-4 md:grid-cols-4">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-sanctuary-bronze">
                Search Directory
              </p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Type to search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Membership Tier
              </p>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tiers</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Pipeline Stage
              </p>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Pipeline Stages</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Sort Order
              </p>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="name-asc">Name (A → Z)</SelectItem>
                  <SelectItem value="name-desc">Name (Z → A)</SelectItem>
                  <SelectItem value="recent">Recently Updated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Alphabet nav */}
        {!loading && filtered.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {alphabet.map((letter) => (
              <button
                key={letter}
                disabled={!activeLetters.has(letter)}
                onClick={() => {
                  document.getElementById(`letter-${letter}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={
                  activeLetters.has(letter)
                    ? "h-8 w-8 rounded-md text-xs font-semibold transition-colors bg-muted hover:bg-primary hover:text-primary-foreground"
                    : "h-8 w-8 rounded-md text-xs text-muted-foreground/30 cursor-default"
                }
              >
                {letter}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading contacts...</p>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <p className="text-muted-foreground">
                {search ? "No contacts match your search." : "No contacts yet."}
              </p>
              {!search && (
                <Button asChild variant="outline">
                  <Link to="/contacts/new">Add your first contact</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {[...alphabet, "#"].filter((l) => grouped[l]).map((letter) => (
              <div key={letter} id={`letter-${letter}`} className="scroll-mt-4">
                <p className="sticky top-0 z-10 bg-background px-1 py-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground border-b mb-2">
                  {letter}
                </p>
                <div>
                  {grouped[letter].map((c) => (
              <ListRowStatic key={c.id}>
                  {/* Name & Info */}
                  <Link to={`/contacts/${c.id}`} className="flex-1 min-w-0">
                    <p className="font-medium truncate">{c.first_name} {c.last_name}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {c.email && (
                        <span className="flex items-center gap-1 truncate">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{c.email}</span>
                        </span>
                      )}
                      {c.phone && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); dialViaQuo(c.phone!); }}
                          title="Call via Quo"
                          className="flex items-center gap-1 hover:text-foreground hover:underline"
                        >
                          <Phone className="h-3 w-3 shrink-0" />
                          {c.phone}
                        </button>
                      )}
                      {c.address && (
                        <span className="flex items-center gap-1 truncate">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{c.address}</span>
                        </span>
                      )}
                      {!c.email && !c.phone && !c.address && "No contact info"}
                    </div>
                  </Link>

                  {/* Resource Icons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          to={`/vault/${c.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 rounded-md text-sanctuary-bronze hover:text-sanctuary-bronze hover:bg-sanctuary-bronze/10 transition-colors"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        Vault
                      </TooltipContent>
                    </Tooltip>
                    {RESOURCE_ICONS.map(({ key, label, icon: Icon }) => {
                      const url = c[key];
                      if (!url) return null;
                      return (
                        <Tooltip key={key}>
                          <TooltipTrigger asChild>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </a>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">
                            {label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-2 shrink-0">
                    {c.households?.fiduciary_entity && (
                      <Badge variant="outline" className="text-xs uppercase">
                        {c.households.fiduciary_entity}
                      </Badge>
                    )}
                    {c.households?.governance_status && c.households.governance_status !== "none" && (
                      <Badge
                        variant={c.households.governance_status === "sovereign" ? "default" : "secondary"}
                        className={
                          c.households.governance_status === "sovereign"
                            ? "bg-sanctuary-bronze/20 text-sanctuary-bronze border-sanctuary-bronze/30"
                            : ""
                        }
                      >
                        {c.households.governance_status === "sovereign" ? "Sovereign" : c.households.governance_status === "core" ? "Core" : "Stabilization"}
                      </Badge>
                    )}
                  </div>
              </ListRowStatic>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Contacts;
