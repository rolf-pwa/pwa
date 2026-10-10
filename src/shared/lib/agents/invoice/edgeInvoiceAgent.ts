/**
 * Invoice agent adapter. UI never calls the edge function directly — it goes
 * through `getInvoiceAgent()` so the runtime can move (edge, Cloud Run) without
 * touching components.
 */
import { supabase } from "@/shared/integrations/supabase/client";
import type { IInvoiceAgentProvider, InvoiceDraftResult, VeemPayerState } from "../types";

const serviceFor = (paymentMethod?: string | null) => (paymentMethod === "veem" ? "veem-service" : "square-service");

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let details = error.message;
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.text === "function") {
        const text = await ctx.text();
        const parsed = JSON.parse(text);
        details = parsed?.error || text || details;
      }
    } catch {
      /* keep original message */
    }
    throw new Error(details);
  }
  return data as T;
}

export const edgeInvoiceAgent: IInvoiceAgentProvider = {
  id: "edge-invoice-agent",

  async draftInvoice(prompt: string): Promise<InvoiceDraftResult> {
    const data = await invoke<InvoiceDraftResult & { ok: boolean; error?: string }>("invoice-agent", { prompt });
    if (!data?.ok) throw new Error(data?.error || "The assistant could not draft this invoice.");
    return data;
  },

  async sendInvoice(invoiceId: string, paymentMethod?: string | null) {
    const data = await invoke<{ ok: boolean; error?: string; publicUrl?: string; status?: string }>(
      serviceFor(paymentMethod),
      { action: "sendInvoice", invoiceId },
    );
    if (!data?.ok) throw new Error(data?.error || (paymentMethod === "veem" ? "Veem rejected this invoice." : "Square rejected this invoice."));
    return data;
  },

  async getVeemPayer(contactId: string) {
    const data = await invoke<VeemPayerState & { error?: string }>("veem-service", { action: "getPayer", contactId });
    if (!data?.ok) throw new Error(data?.error || "Could not read the client's Veem details.");
    return data;
  },

  async saveVeemPayer(contactId: string, details: Record<string, string>) {
    const data = await invoke<VeemPayerState & { error?: string }>("veem-service", { action: "savePayer", contactId, details });
    if (!data?.ok) throw new Error(data?.error || "Could not save the client's Veem details.");
    return data;
  },

  async refreshInvoice(invoiceId: string, paymentMethod?: string | null) {
    const data = await invoke<{ ok: boolean; error?: string; status?: string }>(serviceFor(paymentMethod), {
      action: "refreshInvoice",
      invoiceId,
    });
    if (!data?.ok) throw new Error(data?.error || "Could not refresh this invoice.");
    return data;
  },

  async cancelInvoice(invoiceId: string, paymentMethod?: string | null) {
    const data = await invoke<{ ok: boolean; error?: string }>(serviceFor(paymentMethod), {
      action: "cancelInvoice",
      invoiceId,
    });
    if (!data?.ok) throw new Error(data?.error || "Could not cancel this invoice.");
    return data;
  },

  async markSentManually(invoiceId: string) {
    const data = await invoke<{ ok: boolean; error?: string; status?: string }>("square-service", {
      action: "markSentManually",
      invoiceId,
    });
    if (!data?.ok) throw new Error(data?.error || "Could not issue this invoice.");
    return data;
  },

  async markPaidManually(invoiceId: string, reference?: string) {
    const data = await invoke<{ ok: boolean; error?: string; status?: string }>("square-service", {
      action: "markPaidManually",
      invoiceId,
      reference,
    });
    if (!data?.ok) throw new Error(data?.error || "Could not mark this invoice paid.");
    return data;
  },


  async deleteInvoice(invoiceId: string, paymentMethod?: string | null, status?: string | null) {
    // A Veem invoice already sent is canceled in Veem first, so the payer can no longer claim it; then our records go.
    if (paymentMethod === "veem" && status === "sent") {
      const c = await invoke<{ ok: boolean; error?: string }>("veem-service", { action: "cancelInvoice", invoiceId });
      if (!c?.ok) throw new Error(c?.error || "Could not cancel this invoice in Veem.");
    }
    const data = await invoke<{ ok: boolean; error?: string }>("square-service", {
      action: "deleteInvoice",
      invoiceId,
    });
    if (!data?.ok) throw new Error(data?.error || "Could not delete this invoice.");
    return data;
  },

  async syncService(serviceId: string) {
    const data = await invoke<{ ok: boolean; error?: string; squareId?: string }>("square-service", {
      action: "syncService",
      serviceId,
    });
    if (!data?.ok) throw new Error(data?.error || "Could not sync this service to Square.");
    return data;
  },

  async deleteService(serviceId: string) {
    const data = await invoke<{ ok: boolean; error?: string }>("square-service", {
      action: "deleteService",
      serviceId,
    });
    if (!data?.ok) throw new Error(data?.error || "Could not delete this service.");
    return data;
  },


  async getStatus() {
    const data = await invoke<{ ok: boolean; configured?: boolean; environment?: string }>("square-service", {
      action: "status",
    });
    return { configured: Boolean(data?.configured), environment: data?.environment || "sandbox" };
  },
};
