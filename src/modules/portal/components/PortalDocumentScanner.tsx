import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Send, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/shared/hooks/use-toast";
import { jpegPagesToPdf } from "../lib/scanPdf";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const MAX_EDGE = 2000; // px; keeps a multi-page PDF well under the 25 MB upload limit
const MAX_PAGES = 20;

interface Page { url: string; bytes: Uint8Array; width: number; height: number }

/** Draws the captured photo to a canvas and re-encodes as a downscaled JPEG (also normalises HEIC/PNG). */
async function normalise(file: File): Promise<Page> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * scale);
  const height = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't process the photo"))), "image/jpeg", 0.82));
  return { url: URL.createObjectURL(blob), bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Camera "scan": snap one or more pages, send them to the Shoebox as a single PDF. */
export function PortalDocumentScanner({ portalToken, householdId }: { portalToken: string; householdId: string | null | undefined }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => pages.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onCapture = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const added: Page[] = [];
      for (const f of Array.from(files)) added.push(await normalise(f));
      setPages((p) => [...p, ...added].slice(0, MAX_PAGES));
    } catch (e) {
      toast({ title: "Couldn't read that photo", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };

  const send = async () => {
    setBusy(true);
    try {
      const headers = { "Content-Type": "application/json", "x-portal-token": portalToken };
      const sb = await fetch(`${FUNCTIONS_URL}/vault-service`, { method: "POST", headers, body: JSON.stringify({ action: "ensureShoebox" }) });
      if (!sb.ok) throw new Error("Your Shoebox isn't ready yet");
      const { folderId } = await sb.json();
      const pdf = await jpegPagesToPdf(pages);
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
      const res = await fetch(`${FUNCTIONS_URL}/vault-service`, {
        method: "POST", headers,
        body: JSON.stringify({ action: "uploadFile", folderId, fileName: `Scan ${stamp}.pdf`, mimeType: "application/pdf", base64: toBase64(pdf) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
      toast({ title: "Sent to your Shoebox", description: `${pages.length} page${pages.length === 1 ? "" : "s"} · your Personal CFO will review and file it.` });
      pages.forEach((p) => URL.revokeObjectURL(p.url));
      setPages([]);
    } catch (e) {
      toast({ title: "Couldn't send the scan", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally { setBusy(false); }
  };

  if (!householdId) return null;
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => onCapture(e.target.files)} />
      <Button variant="outline" className="w-full justify-start border-accent/30 text-accent hover:bg-accent/10" disabled={busy || pages.length >= MAX_PAGES} onClick={() => input.current?.click()}>
        {busy && pages.length === 0 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
        {pages.length ? "Add another page" : "Scan a document"}
      </Button>
      {pages.length > 0 && (
        <>
          <ul className="grid grid-cols-4 gap-2" aria-label="Scanned pages">
            {pages.map((p, i) => (
              <li key={p.url} className="relative">
                <img src={p.url} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full rounded border object-cover" />
                <button type="button" aria-label={`Remove page ${i + 1}`} className="absolute -right-1 -top-1 rounded-full bg-background p-0.5 shadow"
                  onClick={() => { URL.revokeObjectURL(p.url); setPages((all) => all.filter((_, j) => j !== i)); }}><X className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
          <Button className="w-full" disabled={busy} onClick={send}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send {pages.length} page{pages.length === 1 ? "" : "s"} to Shoebox
          </Button>
        </>
      )}
    </div>
  );
}
