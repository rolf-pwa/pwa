import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/shared/integrations/supabase/client";
import {
  ExternalLink, FolderOpen, Landmark, ShieldCheck, FileBarChart, ScrollText,
  ChevronDown, ChevronRight,
} from "lucide-react";

const LINK_ICONS: Record<string, any> = {
  ExternalLink,
  FolderOpen,
  Landmark,
  ShieldCheck,
  FileBarChart,
  ScrollText,
  BookOpen: FolderOpen,
  Globe: ExternalLink,
};

export function PortalDynamicLinks() {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const { data: links = [] } = useQuery({
    queryKey: ["portal-links-public"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portal_links" as any)
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as any[];
    },
  });

  if (links.length === 0) return null;

  const ungrouped = links.filter((l: any) => !l.group_label);
  const grouped = links
    .filter((l: any) => l.group_label)
    .reduce<Record<string, any[]>>((acc, l: any) => {
      if (!acc[l.group_label]) acc[l.group_label] = [];
      acc[l.group_label].push(l);
      return acc;
    }, {});

  const toggleGroup = (g: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const renderLink = (link: any) => {
    const IconComp = LINK_ICONS[link.icon] || ExternalLink;
    return (
      <a
        key={link.id}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded px-3 py-2 text-sm transition-colors text-foreground hover:bg-muted/50"
      >
        <IconComp className="h-3.5 w-3.5" />
        {link.label}
        <ExternalLink className="ml-auto h-3 w-3 opacity-40" />
      </a>
    );
  };

  const systemUngrouped = ungrouped.filter((l: any) => l.is_system);
  const customUngrouped = ungrouped.filter((l: any) => !l.is_system);

  return (
    <div className="flex flex-col gap-1.5">
      {systemUngrouped.map((link: any) => {
        const IconComp = LINK_ICONS[link.icon] || ExternalLink;
        return (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium transition-colors text-foreground hover:bg-muted/50"
          >
            <IconComp className="h-4 w-4" />
            {link.label}
            <ExternalLink className="ml-auto h-3 w-3 opacity-40" />
          </a>
        );
      })}

      {Object.entries(grouped).map(([groupName, groupLinks]) => {
        const isOpen = openGroups.has(groupName);
        return (
          <div key={groupName} className="rounded-md border border-border">
            <button
              type="button"
              onClick={() => toggleGroup(groupName)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              <Landmark className="h-4 w-4" />
              {groupName}
              {isOpen ? (
                <ChevronDown className="ml-auto h-3.5 w-3.5 opacity-60" />
              ) : (
                <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60" />
              )}
            </button>
            {isOpen && (
              <div className="flex flex-col gap-0.5 px-2 pb-2">
                {groupLinks.map(renderLink)}
              </div>
            )}
          </div>
        );
      })}

      {customUngrouped.map((link: any) => {
        const IconComp = LINK_ICONS[link.icon] || ExternalLink;
        return (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            <IconComp className="h-4 w-4" />
            {link.label}
            <ExternalLink className="ml-auto h-3 w-3 opacity-40" />
          </a>
        );
      })}
    </div>
  );
}
