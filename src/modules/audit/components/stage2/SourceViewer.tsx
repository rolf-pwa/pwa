import { useEffect, useRef, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { supabase } from "@/shared/integrations/supabase/client";
import { boxToPercent, type BoundingBox } from "../../lib/stage2";

const VAULT_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/vault-service`;

export interface Highlight { page: number; box: BoundingBox | null; quote: string | null }

/** Fetches the source file through vault-service (the same staff-authenticated path the Vault uses). */
async function fetchSourceBlob(driveId: string): Promise<Blob> {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(`${VAULT_URL}?disposition=inline`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    body: JSON.stringify({ action: "streamFile", fileId: driveId }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Couldn't load the source file (HTTP ${res.status})`);
  }
  return res.blob();
}

interface Props { driveId?: string; fileName?: string; highlight: Highlight | null; blobLoader?: (id: string) => Promise<Blob> }

/**
 * Renders the source document and draws the selected figure's bounding box
 * on it. The box comes from the model and is best-effort: when there's no
 * valid box, the page still opens and the quote is shown instead.
 */
export function SourceViewer({ driveId, fileName, highlight, blobLoader = fetchSourceBlob }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mime, setMime] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!driveId) { setStatus("idle"); return; }
    let cancelled = false;
    let objectUrl: string | null = null;
    setStatus("loading"); setError(null); setPdf(null); setImgUrl(null);
    (async () => {
      try {
        const blob = await blobLoader(driveId);
        if (cancelled) return;
        setMime(blob.type);
        if (blob.type.startsWith("image/")) {
          objectUrl = URL.createObjectURL(blob);
          setImgUrl(objectUrl); setPageCount(1); setPage(1); setStatus("ready");
          return;
        }
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (cancelled) return;
        setPdf(doc); setPageCount(doc.numPages); setPage(1); setStatus("ready");
      } catch (e: any) {
        if (!cancelled) { setError(e.message || "Couldn't open the source file"); setStatus("error"); }
      }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [driveId, blobLoader]);

  // Jump to the highlighted figure's page.
  useEffect(() => {
    if (highlight && pageCount && highlight.page >= 1 && highlight.page <= pageCount) setPage(highlight.page);
  }, [highlight, pageCount]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const p = await pdf.getPage(page);
      if (cancelled || !canvasRef.current) return;
      const viewport = p.getViewport({ scale: 1.4 });
      const canvas = canvasRef.current;
      canvas.width = viewport.width; canvas.height = viewport.height;
      await p.render({ canvasContext: canvas.getContext("2d")!, canvas, viewport }).promise;
    })().catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [pdf, page]);

  if (!driveId) return <p className="text-sm text-muted-foreground">No source file is linked to this extraction.</p>;
  if (status === "loading") return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading {fileName ?? "source"}…</div>;
  if (status === "error") return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (status !== "ready") return null;

  const rect = highlight && highlight.page === page && highlight.box ? boxToPercent(highlight.box) : null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">{fileName}</span>
        <span className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
          Page {page} / {pageCount}
          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
        </span>
      </div>
      <div className="relative inline-block max-w-full overflow-auto rounded border bg-white">
        {imgUrl ? <img src={imgUrl} alt={fileName} className="block max-w-full" /> : <canvas ref={canvasRef} className="block max-w-full" data-testid="source-canvas" />}
        {rect && (
          <div
            data-testid="source-highlight"
            className="pointer-events-none absolute rounded-sm border-2 border-amber-500 bg-amber-300/30"
            style={{ top: `${rect.top}%`, left: `${rect.left}%`, width: `${rect.width}%`, height: `${rect.height}%` }}
          />
        )}
      </div>
      {highlight && !rect && (
        <p className="text-xs text-muted-foreground">
          {highlight.box ? `Located on page ${highlight.page}.` : "The model gave no reliable location for this figure."}
          {highlight.quote ? <> Read as: <q>{highlight.quote}</q></> : null}
        </p>
      )}
      {mime && !mime.startsWith("image/") && mime !== "application/pdf" && <p className="text-xs text-amber-700">Unexpected file type ({mime}); rendering as PDF may fail.</p>}
    </div>
  );
}
