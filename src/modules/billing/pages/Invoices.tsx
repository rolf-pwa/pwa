import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/shared/components/AppLayout";
import { supabase } from "@/shared/integrations/supabase/client";
import { getInvoiceAgent } from "@/shared/lib/agents";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Ban,
  CheckCircle2,
  Trash2,

  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { InvoiceDialog } from "../components/InvoiceDialog";
import { VeemPayerDialog } from "../components/VeemPayerDialog";
import { formatMoney, INVOICE_STATUS_COLORS, INVOICE_STATUS_LABELS } from "../lib/money";

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  status: string;
  total: number;
  currency: string;
  issue_date: string;
  due_date: string | null;
  public_payment_url: string | null;
  is_ai_draft: boolean;
  last_error: string | null;
  paid_at: string | null;
  payment_method?: string | null;

  contact?: { id: string; full_name: string } | null;
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [prompt, setPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [squareReady, setSquareReady] = useState<boolean | null>(null);
  const [veemFor, setVeemFor] = useState<InvoiceRow | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("invoices" as any)
      .select("*, contact:contacts(id, full_name)")
      .order("created_at", { ascending: false });
    setInvoices((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    getInvoiceAgent()
      .getStatus()
      .then((s) => setSquareReady(s.configured))
      .catch(() => setSquareReady(false));
  }, []);

  const visible = useMemo(
    () => (filter === "all" ? invoices : invoices.filter((i) => i.status === filter)),
    [invoices, filter],
  );

  const totals = useMemo(() => {
    const paid = invoices.filter((i) => i.status === "paid").reduce((a, i) => a + Number(i.total || 0), 0);
    const outstanding = invoices
      .filter((i) => ["sent", "partially_paid"].includes(i.status))
      .reduce((a, i) => a + Number(i.total || 0), 0);
    const drafts = invoices.filter((i) => i.status === "draft").reduce((a, i) => a + Number(i.total || 0), 0);
    return { paid, outstanding, drafts };
  }, [invoices]);

  const draft = async () => {
    if (!prompt.trim()) {
      toast.error("Describe the invoice you'd like drafted.");
      return;
    }
    setDrafting(true);
    try {
      const result = await getInvoiceAgent().draftInvoice(prompt.trim());
      toast.success(
        result.needsContact
          ? "Draft created — pick the client before sending."
          : `Draft created for ${result.contact?.full_name}`,
      );
      setPrompt("");
      await load();
      setActiveId(result.invoiceId);
      setDialogOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setDrafting(false);
    }
  };

  const send = async (invoice: InvoiceRow) => {
    if (!invoice.contact?.id) {
      toast.error("Assign a client to this invoice first.");
      return;
    }
    setBusyId(invoice.id);
    try {
      if (invoice.payment_method === "e_transfer") {
        await getInvoiceAgent().markSentManually(invoice.id);
        toast.success("Invoice issued — send your e-Transfer request to the client.");
      } else if (invoice.payment_method === "veem") {
        // Veem needs details about the payer; ask for any that are missing before sending.
        const payer = await getInvoiceAgent().getVeemPayer(invoice.contact.id);
        if (payer.missing.length) {
          setVeemFor(invoice);
          return;
        }
        const result = await getInvoiceAgent().sendInvoice(invoice.id, "veem");
        toast.success("Invoice sent through Veem — the client has an email with a link to pay.");
        if (result.publicUrl) window.open(result.publicUrl, "_blank", "noopener");
      } else {
        const result = await getInvoiceAgent().sendInvoice(invoice.id, invoice.payment_method);
        toast.success("Invoice sent through Square");
        if (result.publicUrl) window.open(result.publicUrl, "_blank", "noopener");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusyId(null);
      load();
    }
  };

  const markPaid = async (invoice: InvoiceRow) => {
    const reference = window.prompt("e-Transfer reference or note (optional)") ?? undefined;
    setBusyId(invoice.id);
    try {
      await getInvoiceAgent().markPaidManually(invoice.id, reference?.trim() || undefined);
      toast.success("Invoice marked paid");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark paid");
    } finally {
      setBusyId(null);
      load();
    }
  };


  const refresh = async (invoice: InvoiceRow) => {
    setBusyId(invoice.id);
    try {
      await getInvoiceAgent().refreshInvoice(invoice.id, invoice.payment_method);
      toast.success("Status refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusyId(null);
      load();
    }
  };

  const cancel = async (invoice: InvoiceRow) => {
    if (!window.confirm("Cancel this invoice? The client will no longer be able to pay it.")) return;
    setBusyId(invoice.id);
    try {
      await getInvoiceAgent().cancelInvoice(invoice.id, invoice.payment_method);
      toast.success("Invoice canceled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusyId(null);
      load();
    }
  };

  const remove = async (invoice: InvoiceRow) => {
    if (
      !window.confirm(
        "Delete this invoice permanently? It will be canceled with the payment platform and removed from your records. This can't be undone.",
      )
    )
      return;
    setBusyId(invoice.id);
    try {
      await getInvoiceAgent().deleteInvoice(invoice.id, invoice.payment_method, invoice.status);
      toast.success("Invoice deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyId(null);
      load();
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl">Invoices</h1>
            <p className="text-sm text-muted-foreground">
              AI drafts, you approve. Nothing reaches the client until you press send.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button
              onClick={() => {
                setActiveId(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> New invoice
            </Button>
          </div>
        </div>

        {squareReady === false && (
          <Card className="border-accent/40">
            <CardContent className="flex items-start gap-3 py-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-accent" />
              <span>
                Square isn't connected yet. Drafting works now; sending activates once the Square access token and
                location are saved.
              </span>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Collected</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{formatMoney(totals.paid)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Outstanding</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{formatMoney(totals.outstanding)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">In draft</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{formatMoney(totals.drafts)}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-accent" /> Draft with the invoicing assistant
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Invoice the Jerczynski household for a Sovereignty Audit and two governance review sessions, due in 15 days."
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Drafts land here for your review and are logged to the review queue — never sent automatically.
              </p>
              <Button onClick={draft} disabled={drafting}>
                {drafting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Draft invoice
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">All invoices</CardTitle>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : visible.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">No invoices to show.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <div className="font-medium">{inv.contact?.full_name || "Unassigned"}</div>
                        {inv.is_ai_draft && (
                          <Badge variant="secondary" className="mt-1">
                            Draft for CFO Review
                          </Badge>
                        )}
                        {inv.last_error && <div className="mt-1 text-xs text-destructive">{inv.last_error}</div>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {inv.invoice_number || inv.id.slice(0, 8)}
                        {inv.payment_method === "veem" && <Badge variant="outline" className="ml-2 text-[10px]">Veem</Badge>}
                        <div className="text-xs">{inv.issue_date}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={INVOICE_STATUS_COLORS[inv.status] || "bg-secondary"}>
                          {INVOICE_STATUS_LABELS[inv.status] || inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatMoney(inv.total, inv.currency)}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.due_date || "—"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Open"
                            onClick={() => {
                              setActiveId(inv.id);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {inv.status === "draft" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Approve & send"
                              disabled={busyId === inv.id}
                              onClick={() => send(inv)}
                            >
                              {busyId === inv.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {["sent", "partially_paid"].includes(inv.status) && (
                            <>
                              {inv.payment_method !== "card" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Mark paid (e-Transfer received)"
                                  disabled={busyId === inv.id}
                                  onClick={() => markPaid(inv)}
                                >
                                  <CheckCircle2 className="h-4 w-4 text-accent" />
                                </Button>
                              )}
                              {inv.payment_method !== "e_transfer" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Refresh status"
                                  disabled={busyId === inv.id}
                                  onClick={() => refresh(inv)}
                                >
                                  <RefreshCw className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Cancel invoice"
                                disabled={busyId === inv.id}
                                onClick={() => cancel(inv)}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            </>
                          )}

                          {inv.public_payment_url && (
                            <Button variant="ghost" size="icon" title="Open payment page" asChild>
                              <a href={inv.public_payment_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          {!["paid", "partially_paid"].includes(inv.status) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Delete invoice"
                              disabled={busyId === inv.id}
                              onClick={() => remove(inv)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <VeemPayerDialog
          contactId={veemFor?.contact?.id ?? null}
          open={!!veemFor}
          onClose={() => setVeemFor(null)}
          onSaved={() => {
            const inv = veemFor;
            setVeemFor(null);
            if (inv) send(inv);
          }}
        />
        <InvoiceDialog
        key={activeId || "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        invoiceId={activeId}
        onSaved={load}
      />
    </AppLayout>
  );
}
