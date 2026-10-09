import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import {
  Folder,
  FileText,
  Download,
  Eye,
  ChevronRight,
  Loader2,
  ShieldCheck,
  Home,
  Upload,
  Inbox,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { useToast } from "@/shared/hooks/use-toast";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

interface VaultEntry {
  id: string;
  name: string;
  modifiedTime?: string;
  mimeType?: string;
  size?: number | null;
}

interface Crumb {
  id: string;
  name: string;
}

interface Props {
  portalToken: string;
  householdId: string | null;
}

const PDF_MIMES = new Set(["application/pdf"]);

function formatSize(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PortalVault({ portalToken, householdId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<VaultEntry[]>([]);
  const [files, setFiles] = useState<VaultEntry[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [shoeboxId, setShoeboxId] = useState<string | null>(null);
  const [currentPerm, setCurrentPerm] = useState<"none" | "view" | "upload" | "manage">("view");
  const folderUploadRef = useRef<HTMLInputElement | null>(null);

  const callVault = useCallback(
    async (action: string, payload: Record<string, any> = {}) => {
      const res = await fetch(`${FUNCTIONS_URL}/vault-service`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-token": portalToken,
        },
        body: JSON.stringify({ action, ...payload }),
      });
      return res;
    },
    [portalToken],
  );

  const loadFolder = useCallback(
    async (folder: Crumb, replaceCrumbs?: Crumb[]) => {
      setLoading(true);
      setError(null);
      try {
        const res = await callVault("listFolder", { folderId: folder.id });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "Failed to load");
        }
        const data = await res.json();
        setFolders(data.folders || []);
        setFiles(data.files || []);
        if (replaceCrumbs) setCrumbs(replaceCrumbs);
        // Fetch effective permission for this folder
        try {
          const pRes = await callVault("getEffectivePermission", { driveId: folder.id });
          if (pRes.ok) {
            const pj = await pRes.json();
            setCurrentPerm(pj.cap || "view");
          }
        } catch { setCurrentPerm("view"); }
      } catch (e: any) {
        setError(e.message || "Failed to load vault");
      } finally {
        setLoading(false);
      }
    },
    [callVault],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const rootRes = await callVault("getRoot");
        if (!rootRes.ok) {
          if (cancelled) return;
          setError("not_provisioned");
          setLoading(false);
          return;
        }
        const root = await rootRes.json();
        if (cancelled) return;
        const rootCrumb: Crumb = { id: root.rootFolderId, name: root.rootName || "Vault" };
        await loadFolder(rootCrumb, [rootCrumb]);
        // Resolve (or create) the shoebox so uploads always have a target
        try {
          const sbRes = await callVault("ensureShoebox");
          if (sbRes.ok) {
            const sb = await sbRes.json();
            if (!cancelled) setShoeboxId(sb.folderId);
          }
        } catch {
          /* shoebox best-effort */
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message || "Failed to open vault");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callVault, loadFolder, householdId]);

  const enterFolder = (folder: VaultEntry) => {
    const next = [...crumbs, { id: folder.id, name: folder.name }];
    loadFolder({ id: folder.id, name: folder.name }, next);
  };

  const goToCrumb = (idx: number) => {
    const trimmed = crumbs.slice(0, idx + 1);
    loadFolder(trimmed[trimmed.length - 1], trimmed);
  };

  const streamFile = async (file: VaultEntry, disposition: "inline" | "attachment") => {
    setBusyFileId(file.id);
    try {
      const url = `${FUNCTIONS_URL}/vault-service?disposition=${disposition}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-token": portalToken,
        },
        body: JSON.stringify({ action: "streamFile", fileId: file.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Download failed");
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      if (disposition === "attachment") {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.open(blobUrl, "_blank", "noopener,noreferrer");
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e: any) {
      toast({
        title: "Could not open file",
        description: e.message || "Please try again or ask your Personal CFO.",
        variant: "destructive",
      });
    } finally {
      setBusyFileId(null);
    }
  };

  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

  const uploadToFolder = async (fileList: FileList | null, targetFolderId: string) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    let okCount = 0;
    try {
      for (const file of Array.from(fileList)) {
        if (file.size > MAX_UPLOAD_BYTES) {
          toast({ title: `${file.name} is too large`, description: "Please keep uploads under 25 MB.", variant: "destructive" });
          continue;
        }
        const buf = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as any);
        }
        const base64 = btoa(binary);
        const res = await callVault("uploadFile", {
          folderId: targetFolderId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Upload failed: ${file.name}`);
        }
        okCount += 1;
      }
      if (okCount > 0) {
        toast({ title: okCount === 1 ? "File uploaded" : `${okCount} files uploaded` });
        await loadFolder(crumbs[crumbs.length - 1], crumbs);
      }
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (folderUploadRef.current) folderUploadRef.current.value = "";
    }
  };

  const handleHereUpload = (fileList: FileList | null) => {
    const target = crumbs[crumbs.length - 1]?.id;
    if (!target) return;
    return uploadToFolder(fileList, target);
  };

  const newSubfolder = async () => {
    const target = crumbs[crumbs.length - 1]?.id;
    if (!target) return;
    const name = window.prompt("New folder name");
    if (!name) return;
    try {
      const res = await callVault("createFolder", { parentFolderId: target, name });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed");
      }
      toast({ title: "Folder created" });
      await loadFolder(crumbs[crumbs.length - 1], crumbs);
    } catch (e: any) {
      toast({ title: "Could not create folder", description: e.message, variant: "destructive" });
    }
  };

  const renameItem = async (driveId: string, currentName: string, isFolder: boolean) => {
    const next = window.prompt(`Rename ${isFolder ? "folder" : "file"}`, currentName);
    if (!next || next === currentName) return;
    try {
      const res = await callVault("renameItem", { driveId, newName: next });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Rename failed");
      }
      toast({ title: "Renamed" });
      await loadFolder(crumbs[crumbs.length - 1], crumbs);
    } catch (e: any) {
      toast({ title: "Could not rename", description: e.message, variant: "destructive" });
    }
  };

  const deleteItem = async (driveId: string, isFolder: boolean) => {
    if (!window.confirm(`Move this ${isFolder ? "folder" : "file"} to the trash?`)) return;
    try {
      const res = await callVault("deleteItem", { driveId });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Delete failed");
      }
      toast({ title: "Moved to trash" });
      await loadFolder(crumbs[crumbs.length - 1], crumbs);
    } catch (e: any) {
      toast({ title: "Could not delete", description: e.message, variant: "destructive" });
    }
  };

  if (!householdId) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            Your vault becomes available once your household is set up.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading && folders.length === 0 && files.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error === "not_provisioned") {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Your secure vault has not been activated yet.
          </p>
          <p className="text-xs text-muted-foreground">
            Your Personal CFO will set this up for your household.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-destructive">Unable to load your vault. Please try again.</p>
        </CardContent>
      </Card>
    );
  }

  const isEmpty = folders.length === 0 && files.length === 0;
  const inShoebox = !!shoeboxId && crumbs[crumbs.length - 1]?.id === shoeboxId;

  return (
    <div className="space-y-3">
      {crumbs.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
          <button onClick={() => goToCrumb(0)} className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-accent">
            <Home className="h-3.5 w-3.5" /> Documents
          </button>
          {crumbs.slice(1).map((c, i) => (
            <div key={c.id} className="flex items-center gap-2">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              {i === crumbs.length - 2 ? (
                <span className="max-w-[260px] truncate font-serif text-foreground">{c.name}</span>
              ) : (
                <button onClick={() => goToCrumb(i + 1)} className="max-w-[200px] truncate text-muted-foreground transition-colors hover:text-accent">{c.name}</button>
              )}
            </div>
          ))}
          {loading && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      )}

      {/* Folder-level controls when client has elevated permission here */}
      {/* The Shoebox has its own uploader in the sidebar, so "Upload here" is not repeated inside it. */}
      {(currentPerm === "manage" || (currentPerm === "upload" && !inShoebox)) && crumbs.length > 0 && (
        <Card>
          <CardContent className="p-3 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground mr-1">In this folder:</span>
            <input
              ref={folderUploadRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleHereUpload(e.target.files)}
            />
            {!inShoebox && (
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => folderUploadRef.current?.click()} className="gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                Upload here
              </Button>
            )}
            {currentPerm === "manage" && (
              <Button size="sm" variant="outline" onClick={newSubfolder} className="gap-1.5">
                <FolderPlus className="h-3.5 w-3.5" />
                New folder
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {isEmpty ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Folder className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {crumbs.length === 1
                ? "Your Personal CFO has not shared any documents yet."
                : "This folder is empty."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            <div className="flex items-center gap-2 px-4 py-3">
              <Folder className="h-4 w-4 text-accent" />
              <h3 className="font-serif text-sm font-semibold text-foreground">{crumbs.length > 1 ? crumbs[crumbs.length - 1].name : "Documents"}</h3>
              {crumbs.length <= 1 && loading && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            {folders.map((f) => {
              const isShoebox = f.id === shoeboxId || f.name?.toLowerCase().includes("shoebox");
              return (
                <button
                  key={f.id}
                  onClick={() => enterFolder(f)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  {isShoebox ? (
                    <Inbox className="h-4 w-4 text-accent shrink-0" />
                  ) : (
                    <Folder className="h-4 w-4 text-accent shrink-0" />
                  )}
                  <span className="text-sm flex-1 truncate">
                    {f.name}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              );
            })}
            {files.map((f) => {
              const canPreview = PDF_MIMES.has(f.mimeType || "") || (f.mimeType || "").startsWith("image/");
              const isBusy = busyFileId === f.id;
              return (
                <div
                  key={f.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{f.name}</div>
                    {f.size != null && (
                      <div className="text-[11px] text-muted-foreground">{formatSize(f.size)}</div>
                    )}
                  </div>
                  {canPreview && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isBusy}
                      onClick={() => streamFile(f, "inline")}
                      className="h-8 gap-1"
                    >
                      {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline">View</span>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => streamFile(f, "attachment")}
                    className="h-8 gap-1"
                  >
                    {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                  {currentPerm === "manage" && (
                    <>
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => renameItem(f.id, f.name, false)} title="Rename">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive" onClick={() => deleteItem(f.id, false)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
