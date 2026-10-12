import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/shared/components/ui/command";
import {
  Brain,
  Users,
  FolderOpen,
  Receipt,
  ClipboardList,
  BookOpen,
  LayoutDashboard,
  Sparkles,
  FileText,
} from "lucide-react";
import { searchBrain } from "@/shared/lib/brain";
import { QuickCapture } from "@/shared/components/QuickCapture";
import { SECOND_BRAIN_ENABLED } from "@/shared/lib/featureFlags";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/contacts", label: "CRM", icon: Users },
  { to: "/vault", label: "Vault", icon: FolderOpen },
  { to: "/invoices", label: "Invoices", icon: Receipt },
  { to: "/requests", label: "Client Requests", icon: ClipboardList },
  { to: "/knowledge-base", label: "Bot Knowledge", icon: BookOpen },
];

function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"search" | "capture">("search");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === "k";
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setMode(e.shiftKey && SECOND_BRAIN_ENABLED ? "capture" : "search");
        setOpen((prev) => (e.shiftKey ? true : !prev));
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setMode("search");
    }
  }, [open]);

  const resultsQuery = useQuery({
    queryKey: ["command-palette-brain-search", debouncedQuery],
    queryFn: () => searchBrain(debouncedQuery),
    enabled: SECOND_BRAIN_ENABLED && open && mode === "search" && debouncedQuery.trim().length >= 2,
  });

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  if (mode === "capture") {
    return (
      <CommandDialog open={open} onOpenChange={setOpen}>
        <div className="p-4">
          <QuickCapture onCaptured={() => setOpen(false)} />
        </div>
      </CommandDialog>
    );
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={SECOND_BRAIN_ENABLED ? "Search the Second Brain, or jump to a page…" : "Jump to a page…"} value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>
          {resultsQuery.isFetching ? "Searching…" : "No results."}
        </CommandEmpty>

        {SECOND_BRAIN_ENABLED && query.trim().length > 0 && (
          <CommandGroup heading="Ask">
            <CommandItem onSelect={() => go(`/brain?ask=${encodeURIComponent(query.trim())}`)}>
              <Sparkles /> Ask the brain: "{query.trim()}"
            </CommandItem>
          </CommandGroup>
        )}

        {(resultsQuery.data || []).length > 0 && (
          <CommandGroup heading="Second Brain">
            {(resultsQuery.data || []).slice(0, 8).map((r) => (
              <CommandItem key={r.chunkId} onSelect={() => go(`/brain/${r.documentId}`)}>
                <FileText />
                <span className="truncate">{r.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <CommandItem key={to} onSelect={() => go(to)}>
              <Icon /> {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
