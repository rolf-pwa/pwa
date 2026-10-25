import { isFormer } from "@/shared/lib/retention";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { AppLayout } from "@/shared/components/AppLayout";
import { Card, CardContent } from "@/shared/components/ui/card";
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
import { useIsMobile } from "@/shared/hooks/use-mobile";
import {
  Plus,
  Search,
  Mail,
  Phone,
  Lock,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";

interface Contact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  household_id: string | null;
  households: { label: string | null; governance_status: string | null; fiduciary_entity: string | null; relationship_ended_at?: string | null } | null;
  updated_at: string;
}


/** One person in the phone's list: a large row (initials, name, household) that opens them, and a Call button that does not need the page. */
function PhoneRow({ c }: { c: Contact }) {
  const name = `${c.first_name} ${c.last_name ?? ""}`.trim();
  const initials = `${(c.first_name?.[0] ?? "")}${(c.last_name?.[0] ?? "")}`.toUpperCase();
  return (
    <div className="flex items-center gap-1 border-b border-border/60 last:border-0" data-testid="phone-contact-row">
      <Link to={`/contacts/${c.id}`} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 active:bg-muted">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sanctuary-green text-sm font-semibold text-sanctuary-bronze">{initials}</span>
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{name}</span><span className="block truncate text-xs text-muted-foreground">{c.households?.label || c.email || "No household"}</span></span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
      {c.phone && <button type="button" onClick={() => dialViaQuo(c.phone!)} aria-label={`Call ${name}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent active:bg-muted"><Phone className="h-5 w-5" /></button>}
    </div>
  );
}

const Contacts = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const phone = useIsMobile();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const fetchContacts = useCallback(async () => {
    const { data } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email, phone, address, household_id, households(label, governance_status, fiduciary_entity, relationship_ended_at), updated_at")
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
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<string>("name-asc");

  const filtered = useMemo(() => {
    const clientEntities = new Set(["pwa", "pws"]);
    // People whose household has ended its relationship are Former clients: not in this list, but still reachable from the Former clients page.
    const base = contacts.filter((c) => !isFormer(c.households)).filter((c) =>
      view === "general"
        ? !clientEntities.has((c.households?.fiduciary_entity || "").toLowerCase())
        : clientEntities.has((c.households?.fiduciary_entity || "").toLowerCase())
    );
    const byStatus = base.filter((c) =>
      status === "all" ? true
        : status === "none" ? !c.household_id
        : (c.households?.governance_status || "") === status,
    );
    const searched = byStatus.filter((c) => {
      const name = `${c.first_name} ${c.last_name || ""} ${c.households?.label || ""}`.toLowerCase();
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
  }, [contacts, search, view, sort, status]);

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

        {phone && (
          <div className="space-y-2" data-testid="contacts-phone-header">
            <CrmTabs />
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search name or household" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 rounded-xl pl-9" aria-label="Search contacts" type="search" />
              </div>
              <Button type="button" variant="outline" className="h-11 w-11 shrink-0 rounded-xl p-0" onClick={() => setFiltersOpen((o) => !o)} aria-label="Filters" aria-expanded={filtersOpen}><SlidersHorizontal className="h-4 w-4" /></Button>
            </div>
            {filtersOpen && (
              <div className="grid gap-2" data-testid="contacts-filters">
                <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="sovereign">Sovereign</SelectItem><SelectItem value="core">Core</SelectItem><SelectItem value="none">No household</SelectItem></SelectContent></Select>
                <Select value={sort} onValueChange={setSort}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="name-asc">Name (A → Z)</SelectItem><SelectItem value="name-desc">Name (Z → A)</SelectItem><SelectItem value="recent">Recently updated</SelectItem></SelectContent></Select>
              </div>
            )}
            {!loading && <p className="px-1 text-xs text-muted-foreground" data-testid="contacts-count">{filtered.length} {filtered.length === 1 ? "contact" : "contacts"}</p>}
          </div>
        )}

        {!phone && <>
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

        {/* Filters: one slim row */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search by name or household" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="sovereign">Sovereign</SelectItem>
              <SelectItem value="core">Core</SelectItem>
              <SelectItem value="none">No household</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name (A → Z)</SelectItem>
              <SelectItem value="name-desc">Name (Z → A)</SelectItem>
              <SelectItem value="recent">Recently updated</SelectItem>
            </SelectContent>
          </Select>
          {!loading && <span className="text-sm text-muted-foreground">{filtered.length} {filtered.length === 1 ? "contact" : "contacts"}</span>}
        </div>
        </>}

        {/* Alphabet nav (desktop: a row of buttons; phone: the side index below) */}
        {!phone && !loading && filtered.length > 0 && (
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
          <div className={phone ? "space-y-4 pr-5" : "space-y-4"}>
            {[...alphabet, "#"].filter((l) => grouped[l]).map((letter) => (
              <div key={letter} id={`letter-${letter}`} className="scroll-mt-4">
                <p className="sticky top-0 z-10 bg-background px-1 py-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground border-b mb-2">
                  {letter}
                </p>
                <div>
                  {grouped[letter].map((c) => phone ? <PhoneRow key={c.id} c={c} /> : (
              <div key={c.id} className="flex items-center gap-4 border-b border-border/60 px-1 py-2.5 last:border-0">
                  <Link to={`/contacts/${c.id}`} className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.first_name} {c.last_name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
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
                      {!c.email && !c.phone && "No contact info"}
                    </div>
                  </Link>

                  <div className="hidden w-48 shrink-0 text-sm sm:block">
                    {c.household_id ? (
                      <Link to={`/households/${c.household_id}`} className="block truncate text-muted-foreground hover:text-foreground hover:underline">
                        {c.households?.label || "Household"}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground/70">No household</span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {c.households?.governance_status && c.households.governance_status !== "none" && (
                      <Badge
                        variant={c.households.governance_status === "sovereign" ? "default" : "secondary"}
                        className={c.households.governance_status === "sovereign" ? "bg-sanctuary-bronze/20 text-sanctuary-bronze border-sanctuary-bronze/30" : ""}
                      >
                        {c.households.governance_status === "sovereign" ? "Sovereign" : c.households.governance_status === "core" ? "Core" : c.households.governance_status}
                      </Badge>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          to={`/vault/${c.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-md p-1.5 text-sanctuary-bronze transition-colors hover:bg-sanctuary-bronze/10"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">Vault</TooltipContent>
                    </Tooltip>
                  </div>
              </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {phone && (
        <>
          {/* The index down the edge, as in Contacts on an iPhone: tap a letter to jump to it. */}
          {!loading && filtered.length > 0 && (
            <nav aria-label="Jump to letter" data-testid="letter-index" className="fixed right-0.5 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center py-1 text-[10px] font-semibold text-accent">
              {[...alphabet, "#"].filter((l) => activeLetters.has(l)).map((l) => (
                <button key={l} type="button" onClick={() => document.getElementById(`letter-${l}`)?.scrollIntoView({ block: "start" })} className="flex h-[1.1rem] w-6 items-center justify-center" aria-label={`Jump to ${l}`}>{l}</button>
              ))}
            </nav>
          )}
          <Link to="/contacts/new" aria-label="New contact" data-testid="new-contact-fab" className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg active:scale-95"><Plus className="h-6 w-6" /></Link>
        </>
      )}
    </AppLayout>
  );
};

export default Contacts;
