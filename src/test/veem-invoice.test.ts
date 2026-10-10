import { describe, expect, it } from "vitest";
import { buildVeemInvoiceBody, mapVeemStatus, missingPayerFields, parseInvoiceEvent, verifyVeemSignature, veemNotes } from "../../supabase/functions/_shared/veem-invoice";

const personal = { payer_type: "Personal" as const, first_name: "Colleen", last_name: "J", phone: "2505551234", phone_country_code: "+1", country_code: "CA" };
const business = { ...personal, payer_type: "Business" as const, business_name: "Acme Ltd", industry: "Services", sub_industry: "Consulting", entity: "Corporation", tax_id_number: "123", street: "1 Main", city: "Vernon", province: "BC", postal_code: "V1T1A1" };

describe("Veem payer requirements", () => {
  it("lists what is missing, in plain words, and needs the business block only for a business", () => {
    expect(missingPayerFields(personal, "c@x.ca")).toEqual([]);
    expect(missingPayerFields(personal, "")).toEqual(["email address"]);
    expect(missingPayerFields({ ...personal, phone_country_code: "1" }, "c@x.ca")).toEqual(["phone country code (with +)"]);
    expect(missingPayerFields({ ...business, tax_id_number: "", street: "" }, "c@x.ca")).toEqual(["tax ID", "business address"]);
    expect(missingPayerFields(null, null)).toContain("first name");
  });
});

describe("Veem invoice body", () => {
  const inv = { id: "inv1", total: "1250.5", currency: "cad", due_date: "2026-11-01", notes: "Thank you", invoice_number: "INV-7" };
  const lines = [{ description: "Sovereignty Audit", quantity: 1, unit_amount: 1000 }, { description: "Review session", quantity: 2, unit_amount: 125.25 }];
  it("puts the lines in the notes and keeps our invoice id as the external reference", () => {
    const b = buildVeemInvoiceBody(inv, lines, "c@x.ca", personal) as any;
    expect(b.amount).toEqual({ number: 1250.5, currency: "CAD" });
    expect(b.externalInvoiceRefId).toBe("inv1");
    expect(b.notes).toContain("Review session — 2 x 125.25");
    expect(b.payer.businessName).toBe("Colleen J");
    expect(b.payer.business).toBeUndefined();
    expect(b.dueDate).toBe("2026-11-01");
    expect(veemNotes(inv, lines).length).toBeLessThanOrEqual(1000);
  });
  it("includes the business block for a business payer", () => {
    const b = buildVeemInvoiceBody(inv, lines, "c@x.ca", business) as any;
    expect(b.payer.businessName).toBe("Acme Ltd");
    expect(b.payer.business.taxIdNumber).toBe("123");
    expect(b.payer.business.address.countryCode).toBe("CA");
  });
});

describe("Veem status and webhook", () => {
  it("maps Veem's statuses; Claimed is still outstanding", () => {
    expect(mapVeemStatus("MarkAsPaid")).toBe("paid");
    expect(mapVeemStatus("Claimed")).toBe("sent");
    expect(mapVeemStatus("Cancelled")).toBe("canceled");
    expect(mapVeemStatus("Closed")).toBe("failed");
    expect(mapVeemStatus("Drafted")).toBe("draft");
  });
  it("reads an invoice event whether data is an object or a JSON string, and ignores other events", () => {
    expect(parseInvoiceEvent({ type: "OUTBOUND_INVOICE_STATUS_UPDATED", data: { id: 55, status: "MarkAsPaid", paymentId: 9 } })).toEqual({ type: "OUTBOUND_INVOICE_STATUS_UPDATED", invoiceId: "55", status: "MarkAsPaid", paymentId: "9" });
    expect(parseInvoiceEvent({ type: "INBOUND_INVOICE_STATUS_UPDATED", data: JSON.stringify({ id: 7, status: "Sent" }) })?.invoiceId).toBe("7");
    expect(parseInvoiceEvent({ type: "OUTBOUND_PAYMENT_STATUS_UPDATED", data: { id: 1 } })).toBeNull();
  });
  it("verifies an HMAC-SHA256 signature keyed by the client id, in hex or base64", async () => {
    const body = '{"type":"X"}';
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("client-1"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
    const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verifyVeemSignature(body, hex, "client-1")).toBe(true);
    expect(await verifyVeemSignature(body, btoa(String.fromCharCode(...sig)), "client-1")).toBe(true);
    expect(await verifyVeemSignature(body, hex, "other")).toBe(false);
    expect(await verifyVeemSignature(body, null, "client-1")).toBe(false);
  });
});
