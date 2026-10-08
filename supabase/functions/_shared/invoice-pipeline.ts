// Paid invoice -> business_pipeline consulting-revenue row, for any invoicing platform.
// deno-lint-ignore-file no-explicit-any

export async function syncPipelineForPaidInvoice(db: any, invoiceId: string, platform: string): Promise<void> {
  const { data: inv } = await db.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!inv || !inv.contact_id) return;
  const payload = {
    contact_id: inv.contact_id,
    category: "pws_consulting",
    status: "completed",
    amount: Number(inv.total || 0),
    expected_close_date: (inv.paid_at || new Date().toISOString()).slice(0, 10),
    notes: `${platform} invoice ${inv.invoice_number || inv.veem_invoice_id || inv.square_invoice_id || inv.id}`,
  };
  if (inv.pipeline_id) {
    await db.from("business_pipeline").update(payload).eq("id", inv.pipeline_id);
    return;
  }
  const { data: created } = await db.from("business_pipeline").insert(payload).select("id").maybeSingle();
  if (created?.id) await db.from("invoices").update({ pipeline_id: created.id }).eq("id", invoiceId);
}
