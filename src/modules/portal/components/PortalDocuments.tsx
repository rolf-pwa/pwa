import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, Check, FileSignature, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import pwLogoWhite from "@/assets/prosperwise-logo-white.png";

interface Pending { id: string; title: string; sent_at: string }
interface Doc { id: string; title: string; before: string; after: string | null; needsCasl: boolean; statement: string; signerName: string; signed: boolean; signedAt: string | null; email: string; others: { name: string; signed: boolean }[] }

const call = async <T,>(portalToken: string, action: string, extra: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase.functions.invoke("portal-pm-tasks", { body: { portal_token: portalToken, action, ...extra } });
  if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || "Something went wrong");
  return data as T;
};

/** A card on the dashboard when documents are waiting for this person's signature. Shows nothing otherwise. */
export function PortalDocumentsTeaser({ portalToken, onOpen }: { portalToken: string; onOpen: () => void }) {
  const [docs, setDocs] = useState<Pending[]>([]);
  useEffect(() => { if (portalToken) call<{ documents: Pending[] }>(portalToken, "docList").then((r) => setDocs(r.documents)).catch(() => setDocs([])); }, [portalToken]);
  if (!docs.length) return null;
  return (
    <Card className="border-primary/40" data-testid="documents-teaser">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <FileSignature className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1"><p className="font-medium">{docs.length === 1 ? `Please sign your ${docs[0].title}` : `${docs.length} documents are waiting for your signature`}</p><p className="text-xs text-muted-foreground">It takes a couple of minutes. You will get a signed copy in your records.</p></div>
        <Button onClick={onOpen}>Review and sign</Button>
      </CardContent>
    </Card>
  );
}

const md = (text: string) => (
  <ReactMarkdown components={{ h1: ({ children }) => <h2 className="mt-6 text-xl font-semibold">{children}</h2>, h2: ({ children }) => <h3 className="mt-5 text-lg font-semibold">{children}</h3>, h3: ({ children }) => <h4 className="mt-4 font-semibold">{children}</h4>, p: ({ children }) => <p className="mt-2">{children}</p>, ol: ({ children }) => <ol className="mt-2 list-decimal space-y-2 pl-6">{children}</ol>, ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-6">{children}</ul>, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">{children}</a> }}>{text}</ReactMarkdown>
);

function SignOne({ portalToken, id, onDone }: { portalToken: string; id: string; onDone: () => void }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [agree, setAgree] = useState(false);
  const [casl, setCasl] = useState<"yes" | "no" | "">("");
  const [initials, setInitials] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { call<Doc>(portalToken, "docGet", { document_id: id }).then((d) => { setDoc(d); setEmail(d.email ?? ""); }).catch((e) => setErr(e.message)); }, [portalToken, id]);

  const sign = async () => {
    setBusy(true);
    try {
      await call(portalToken, "docSign", { document_id: id, signature: { typedName: typed, agree, caslChoice: casl || undefined, caslInitials: initials, caslEmail: email } });
      setDone(true); toast.success("Signed. Thank you."); onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "That did not work. Please try again."); } finally { setBusy(false); }
  };

  if (err) return <p className="text-sm text-muted-foreground">{err}</p>;
  if (!doc) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (done || doc.signed) return <Card><CardContent className="flex items-center gap-3 p-5"><Check className="h-5 w-5 text-green-700" /><div><p className="font-medium">You have signed the {doc.title}.</p>{doc.others.some((o) => !o.signed) && <p className="text-sm text-muted-foreground">Waiting for {doc.others.filter((o) => !o.signed).map((o) => o.name).join(" and ")} to sign.</p>}</div></CardContent></Card>;
  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-semibold">{doc.title}</h1>
      <Card><CardContent className="p-5 text-sm leading-relaxed">{md(doc.before)}</CardContent></Card>
      {doc.needsCasl && (
        <Card data-testid="casl-choice"><CardContent className="space-y-3 p-5 text-sm">
          <p className="font-medium">Commercial electronic messages</p>
          <label className="flex items-start gap-2"><input type="radio" name="casl" checked={casl === "yes"} onChange={() => setCasl("yes")} className="mt-1" /><span>Yes, I agree to receive commercial electronic messages.</span></label>
          <label className="flex items-start gap-2"><input type="radio" name="casl" checked={casl === "no"} onChange={() => setCasl("no")} className="mt-1" /><span>No, I do not agree to receive commercial electronic messages.</span></label>
          {casl === "yes" && <label className="block">Email address<Input className="mt-1 max-w-sm" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>}
          {casl && <label className="block">Your initials<Input className="mt-1 w-28" value={initials} onChange={(e) => setInitials(e.target.value)} maxLength={5} /></label>}
        </CardContent></Card>
      )}
      {doc.needsCasl && doc.after && <Card><CardContent className="p-5 text-sm leading-relaxed">{md(doc.after)}</CardContent></Card>}
      <Card><CardContent className="space-y-3 p-5 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" /><span>{doc.statement}</span></label>
        <label className="block">Type your full name to sign ({doc.signerName})<Input className="mt-1 max-w-sm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="name" /></label>
        <Button onClick={sign} disabled={busy || !agree || typed.trim().length < 3}>{busy ? "Signing…" : "Sign"}</Button>
        {doc.others.length > 0 && <p className="text-xs text-muted-foreground">{doc.others.map((o) => `${o.name}: ${o.signed ? "signed" : "not yet signed"}`).join(". ")}. Each person signs separately.</p>}
      </CardContent></Card>
    </div>
  );
}

/** The Documents page in the portal: the documents waiting for this person, one at a time. */
export function PortalDocumentsPage({ portalToken, onBack }: { portalToken: string; onBack: () => void }) {
  const [docs, setDocs] = useState<Pending[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => { call<{ documents: Pending[] }>(portalToken, "docList").then((r) => setDocs(r.documents)).catch(() => setDocs([])); }, [portalToken]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4">
      <div className="rounded-lg px-6 py-5 text-white" style={{ backgroundColor: "#1e293b" }} data-testid="documents-header">
        <img src={pwLogoWhite} alt="ProsperWise" className="h-9 w-auto" />
        <p className="mt-3 text-[11px] font-light uppercase tracking-[0.1em] text-white/55">ProsperWise Advisors</p>
      </div>
      <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground hover:underline" onClick={openId ? () => { setOpenId(null); load(); } : onBack}><ArrowLeft className="h-4 w-4" /> {openId ? "All documents" : "Back"}</button>
      {openId ? <SignOne portalToken={portalToken} id={openId} onDone={load} /> : docs === null ? <Loader2 className="h-5 w-5 animate-spin" /> : docs.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">Nothing is waiting for your signature. Signed documents are kept in your records.</CardContent></Card>
      ) : (
        <>
          <h1 className="font-serif text-2xl font-semibold">Documents to sign</h1>
          {docs.map((d) => <Card key={d.id}><CardContent className="flex items-center gap-3 p-4"><FileSignature className="h-5 w-5" /><span className="flex-1 font-medium">{d.title}</span><Button onClick={() => setOpenId(d.id)}>Review and sign</Button></CardContent></Card>)}
        </>
      )}
    </div>
  );
}
