import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Inbox, Loader2 } from "lucide-react";
import { useToast } from "@/shared/hooks/use-toast";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface Props {
  portalToken: string;
  householdId: string | null | undefined;
  /** Render as a plain list row (for the Concierge) instead of an outlined button. */
  row?: boolean;
}

/** Standalone "send a document to your Shoebox" uploader for the Concierge
 * sidebar — same underlying vault-service calls as PortalVault.tsx's
 * upload bar, without the folder-browser state (crumbs/loadFolder) that
 * lives there, since this has no folder view to refresh. */
export function PortalShoeboxUpload({ portalToken, householdId, row }: Props) {
  const { toast } = useToast();
  const [shoeboxId, setShoeboxId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${FUNCTIONS_URL}/vault-service`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-portal-token": portalToken },
          body: JSON.stringify({ action: "ensureShoebox" }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setShoeboxId(data.folderId);
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, [portalToken, householdId]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (!shoeboxId) {
      toast({ title: "Upload unavailable", description: "Your Shoebox isn't ready yet.", variant: "destructive" });
      return;
    }
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
        const res = await fetch(`${FUNCTIONS_URL}/vault-service`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-portal-token": portalToken },
          body: JSON.stringify({
            action: "uploadFile",
            folderId: shoeboxId,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            base64,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Upload failed: ${file.name}`);
        }
        okCount += 1;
      }
      if (okCount > 0) {
        toast({
          title: okCount === 1 ? "Sent to your Shoebox" : `${okCount} files sent to Shoebox`,
          description: "Your Personal CFO will review and file it for you.",
        });
      }
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!householdId) return null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt,.csv"
      />
      {row ? (
        <button
          type="button"
          disabled={uploading || !shoeboxId}
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Inbox className="h-4 w-4 text-accent" />}
          {uploading ? "Uploading…" : "Send to Shoebox"}
        </button>
      ) : (
      <Button
        variant="outline"
        className="w-full border-accent/30 text-accent hover:bg-accent/10 justify-start"
        disabled={uploading || !shoeboxId}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Inbox className="h-4 w-4 mr-2" />}
        {uploading ? "Uploading…" : "Send to Shoebox"}
      </Button>
      )}
    </>
  );
}
