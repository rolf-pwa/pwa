import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/integrations/supabase/client";
import { syncKnowledgeBaseToBrain } from "@/shared/lib/brain";
import { SECOND_BRAIN_ENABLED } from "@/shared/lib/featureFlags";
import { useAuth } from "@/shared/hooks/useAuth";
import { AppLayout } from "@/shared/components/AppLayout";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { Badge } from "@/shared/components/ui/badge";
import { Switch } from "@/shared/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { Separator } from "@/shared/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus,
  BookOpen,
  FileText,
  Upload,
  Trash2,
  Pencil,
  Loader2,
  Search,
  Link2,
  ExternalLink,
  GripVertical,
  Brain as BrainIcon,
} from "lucide-react";

// ─── Knowledge Entry Types ───
type KnowledgeEntry = {
  id: string;
  title: string;
  content: string;
  category: string;
  source_type: string;
  file_path: string | null;
  is_active: boolean;
  target: string;
  created_at: string;
  updated_at: string;
};

type PortalLink = {
  id: string;
  label: string;
  url: string;
  icon: string;
  group_label: string | null;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
  link_type: string;
  created_at: string;
  updated_at: string;
};

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "services", label: "Services & Fees" },
  { value: "compliance", label: "Compliance & PIPEDA" },
  { value: "faq", label: "FAQs" },
  { value: "process", label: "Processes" },
  { value: "team", label: "Team & Bios" },
];

const ICON_OPTIONS = [
  { value: "ExternalLink", label: "External Link" },
  { value: "FolderOpen", label: "Folder" },
  { value: "Landmark", label: "Landmark" },
  { value: "ShieldCheck", label: "Shield" },
  { value: "FileText", label: "Document" },
  { value: "ScrollText", label: "Scroll" },
  { value: "BookOpen", label: "Book" },
  { value: "Globe", label: "Globe" },
];

// ─── Knowledge Tab ───
function KnowledgeTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterTarget, setFilterTarget] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [syncingToBrain, setSyncingToBrain] = useState(false);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [target, setTarget] = useState("both");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["knowledge-base"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_base" as any)
        .select("*")
        .order("category")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as any[]) as KnowledgeEntry[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (entry: {
      id?: string;
      title: string;
      content: string;
      category: string;
      source_type: string;
      file_path?: string | null;
      target?: string;
    }) => {
      if (entry.id) {
        const { error } = await (supabase.from("knowledge_base" as any) as any)
          .update({
            title: entry.title,
            content: entry.content,
            category: entry.category,
            source_type: entry.source_type,
            file_path: entry.file_path,
            target: entry.target,
          })
          .eq("id", entry.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("knowledge_base" as any) as any).insert({
          title: entry.title,
          content: entry.content,
          category: entry.category,
          source_type: entry.source_type,
          file_path: entry.file_path || null,
          target: entry.target,
          created_by: user?.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-base"] });
      toast.success(editing ? "Entry updated" : "Entry added");
      resetForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase.from("knowledge_base" as any) as any)
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-base"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (entry: KnowledgeEntry) => {
      if (entry.file_path) {
        await supabase.storage.from("knowledge-base").remove([entry.file_path]);
      }
      const { error } = await (supabase.from("knowledge_base" as any) as any)
        .delete()
        .eq("id", entry.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-base"] });
      toast.success("Entry deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => {
    setTitle("");
    setContent("");
    setCategory("general");
    setTarget("both");
    setFile(null);
    setEditing(null);
    setDialogOpen(false);
  };

  const openEdit = (entry: KnowledgeEntry) => {
    setEditing(entry);
    setTitle(entry.title);
    setContent(entry.content);
    setCategory(entry.category);
    setTarget(entry.target || "both");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    let filePath: string | null = editing?.file_path || null;
    let finalContent = content;
    let sourceType = "text";

    if (file) {
      setUploading(true);
      const ext = file.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("knowledge-base")
        .upload(path, file);

      if (uploadError) {
        toast.error("File upload failed: " + uploadError.message);
        setUploading(false);
        return;
      }

      filePath = path;
      sourceType = "file";

      if (file.type === "text/plain" || file.name.endsWith(".md") || file.name.endsWith(".txt")) {
        finalContent = await file.text();
      } else {
        if (!finalContent.trim()) {
          finalContent = `[Content from uploaded file: ${file.name}]`;
        }
      }
      setUploading(false);
    }

    if (!finalContent.trim() && !file) {
      toast.error("Content is required");
      return;
    }

    saveMutation.mutate({
      id: editing?.id,
      title: title.trim(),
      content: finalContent,
      category,
      target,
      source_type: sourceType,
      file_path: filePath,
    });
  };

  const filtered = entries.filter((e) => {
    const matchesSearch =
      !search ||
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.content.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = filterCategory === "all" || e.category === filterCategory;
    const matchesTarget = filterTarget === "all" || e.target === filterTarget || e.target === "both";
    return matchesSearch && matchesCategory && matchesTarget;
  });

  const activeCount = entries.filter((e) => e.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
        <p className="text-muted-foreground">
          This feeds Georgia, the client-facing portal assistant — keep it client-safe.
          {SECOND_BRAIN_ENABLED && <> For your own private notes and memory, use the <Link to="/brain" className="font-medium text-accent underline">Second Brain</Link> instead.</>}
        </p>
        {SECOND_BRAIN_ENABLED && <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          disabled={syncingToBrain}
          onClick={async () => {
            setSyncingToBrain(true);
            try {
              const result = await syncKnowledgeBaseToBrain();
              toast.success(`Synced ${result.synced} ${result.synced === 1 ? "entry" : "entries"} to the Second Brain`);
            } catch (e: any) {
              toast.error(e.message || "Sync failed");
            } finally {
              setSyncingToBrain(false);
            }
          }}
        >
          {syncingToBrain ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BrainIcon className="h-3.5 w-3.5" />}
          Sync to Second Brain
        </Button>}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {activeCount} active {activeCount === 1 ? "entry" : "entries"}
        </p>
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setDialogOpen(open); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Entry
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Entry" : "Add Knowledge Entry"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Fee Structure Overview"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Target Bot</Label>
                  <Select value={target} onValueChange={setTarget}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both">Both Georgias</SelectItem>
                      <SelectItem value="transition">Transition Assistant</SelectItem>
                      <SelectItem value="portal">Client Portal</SelectItem>
                      <SelectItem value="charter-draft">Charter Draft Generator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Content</Label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter knowledge content that Georgia should know..."
                  rows={8}
                  className="font-mono text-sm"
                />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Or Upload a File</Label>
                <p className="text-xs text-muted-foreground">
                  Upload .txt or .md files. Content will be extracted automatically.
                </p>
                <Input
                  type="file"
                  accept=".txt,.md,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                {file && (
                  <p className="text-xs text-muted-foreground">
                    Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending || uploading}
                >
                  {(saveMutation.isPending || uploading) && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {editing ? "Update" : "Save"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entries..."
            className="pl-9"
          />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterTarget} onValueChange={setFilterTarget}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All targets" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Targets</SelectItem>
            <SelectItem value="transition">Transition Assistant</SelectItem>
            <SelectItem value="portal">Client Portal</SelectItem>
            <SelectItem value="charter-draft">Charter Draft Generator</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Entries */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No knowledge entries yet</p>
              <p className="text-sm text-muted-foreground">
                Add entries to give Georgia domain-specific knowledge about your practice.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((entry) => (
            <Card
              key={entry.id}
              className={!entry.is_active ? "opacity-50" : ""}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {entry.source_type === "file" ? (
                      <Upload className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                    <CardTitle className="text-sm font-semibold">
                      {entry.title}
                    </CardTitle>
                    <Badge variant="secondary" className="text-[10px]">
                      {CATEGORIES.find((c) => c.value === entry.category)?.label || entry.category}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {entry.target === "both"
                        ? "Both"
                        : entry.target === "transition"
                        ? "Transition"
                        : entry.target === "charter-draft"
                        ? "Charter Draft"
                        : "Portal"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={entry.is_active}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({ id: entry.id, is_active: checked })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEdit(entry)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => deleteMutation.mutate(entry)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                  {entry.content}
                </p>
                <p className="mt-2 text-[10px] text-muted-foreground/60">
                  Updated {new Date(entry.updated_at).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Portal Links Tab ───
function PortalLinksTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PortalLink | null>(null);

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState("ExternalLink");
  const [groupLabel, setGroupLabel] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [linkType, setLinkType] = useState("external");

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["portal-links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portal_links" as any)
        .select("*")
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return (data as any[]) as PortalLink[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (entry: {
      id?: string;
      label: string;
      url: string;
      icon: string;
      group_label: string | null;
      sort_order: number;
      link_type: string;
    }) => {
      if (entry.id) {
        const { error } = await (supabase.from("portal_links" as any) as any)
          .update({
            label: entry.label,
            url: entry.url,
            icon: entry.icon,
            group_label: entry.group_label,
            sort_order: entry.sort_order,
            link_type: entry.link_type,
          })
          .eq("id", entry.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("portal_links" as any) as any).insert({
          label: entry.label,
          url: entry.url,
          icon: entry.icon,
          group_label: entry.group_label,
          sort_order: entry.sort_order,
          link_type: entry.link_type,
          created_by: user?.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-links"] });
      toast.success(editing ? "Link updated" : "Link added");
      resetForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase.from("portal_links" as any) as any)
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-links"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("portal_links" as any) as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-links"] });
      toast.success("Link deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => {
    setLabel("");
    setUrl("");
    setIcon("ExternalLink");
    setGroupLabel("");
    setSortOrder(0);
    setLinkType("external");
    setEditing(null);
    setDialogOpen(false);
  };

  const openEdit = (link: PortalLink) => {
    setEditing(link);
    setLabel(link.label);
    setUrl(link.url);
    setIcon(link.icon);
    setGroupLabel(link.group_label || "");
    setSortOrder(link.sort_order);
    setLinkType(link.link_type);
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!label.trim() || !url.trim()) {
      toast.error("Label and URL are required");
      return;
    }
    saveMutation.mutate({
      id: editing?.id,
      label: label.trim(),
      url: url.trim(),
      icon,
      group_label: groupLabel.trim() || null,
      sort_order: sortOrder,
      link_type: linkType,
    });
  };

  // Group links by group_label
  const grouped = links.reduce<Record<string, PortalLink[]>>((acc, link) => {
    const key = link.group_label || "__ungrouped__";
    if (!acc[key]) acc[key] = [];
    acc[key].push(link);
    return acc;
  }, {});

  const activeCount = links.filter((l) => l.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {activeCount} active link{activeCount !== 1 ? "s" : ""} · Displayed in the client portal sidebar
        </p>
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setDialogOpen(open); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Link
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Link" : "Add Portal Link"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. IA Financial"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Icon</Label>
                  <Select value={icon} onValueChange={setIcon}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ICON_OPTIONS.map((i) => (
                        <SelectItem key={i.value} value={i.value}>
                          {i.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>URL</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Group (optional)</Label>
                  <Input
                    value={groupLabel}
                    onChange={(e) => setGroupLabel(e.target.value)}
                    placeholder="e.g. My Accounts"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Links with the same group name will be nested under a collapsible header.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Sort Order</Label>
                  <Input
                    type="number"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saveMutation.isPending}>
                  {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editing ? "Update" : "Save"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : links.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Link2 className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No portal links yet</p>
              <p className="text-sm text-muted-foreground">
                Add links that will appear in the client portal sidebar.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([groupKey, groupLinks]) => (
            <div key={groupKey}>
              {groupKey !== "__ungrouped__" && (
                <div className="flex items-center gap-2 mb-2">
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {groupKey}
                  </span>
                </div>
              )}
              <div className="grid gap-2">
                {groupLinks.map((link) => (
                  <Card
                    key={link.id}
                    className={`${!link.is_active ? "opacity-50" : ""} ${groupKey !== "__ungrouped__" ? "ml-5" : ""}`}
                  >
                    <CardContent className="flex items-center justify-between py-3 px-4">
                      <div className="flex items-center gap-3">
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{link.label}</p>
                          <p className="text-[11px] text-muted-foreground truncate max-w-[300px]">{link.url}</p>
                        </div>
                        {link.is_system && (
                          <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                            System
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {ICON_OPTIONS.find((i) => i.value === link.icon)?.label || link.icon}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          #{link.sort_order}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={link.is_active}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ id: link.id, is_active: checked })
                          }
                        />
                        {!link.is_system && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(link)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => deleteMutation.mutate(link.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───
export default function KnowledgeBase() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">
            Manage Georgia's knowledge and portal configuration
          </p>
        </div>

        <Tabs defaultValue="knowledge" className="w-full">
          <TabsList>
            <TabsTrigger value="knowledge" className="gap-1.5">
              <BookOpen className="h-4 w-4" />
              Knowledge Entries
            </TabsTrigger>
            <TabsTrigger value="portal-links" className="gap-1.5">
              <Link2 className="h-4 w-4" />
              Portal Links
            </TabsTrigger>
          </TabsList>

          <TabsContent value="knowledge" className="mt-4">
            <KnowledgeTab />
          </TabsContent>

          <TabsContent value="portal-links" className="mt-4">
            <PortalLinksTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
