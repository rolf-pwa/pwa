// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock("@/shared/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async (_fn: string, { body }: any) => {
    calls.list.push(body.action);
    if (body.action === "docList") return { data: { documents: [{ id: "d1", title: "Advisor Disclosure and Privacy Consent", sent_at: "2026-10-22T00:00:00Z", task_id: "t1" }] }, error: null };
    if (body.action === "docSigned") return { data: { documents: [] }, error: null };
    if (body.action === "docGet") return { data: { id: "d1", title: "Advisor Disclosure and Privacy Consent", before: "## Licensing\n\nI am licensed as a life insurance broker in BC.", after: "## More\n\nClosing words.", needsCasl: true, statement: "I have read this document and I agree to it.", signerName: "Rolf Issler", signed: false, signedAt: null, email: "rolf@x.ca", others: [], agent: null }, error: null };
    return { data: {}, error: null };
  } } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PortalDocumentsPage, PortalDocumentsTeaser } from "../modules/portal/components/PortalDocuments";

describe("the client reads and signs a document in the portal", () => {
  it("lists the document waiting, opens it, and shows its wording, the CASL choice and the signing box", async () => {
    render(<PortalDocumentsPage portalToken="tok" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Documents to sign")).toBeTruthy());
    fireEvent.click(screen.getByText("Review and sign"));
    await waitFor(() => expect(screen.getByText("I am licensed as a life insurance broker in BC.")).toBeTruthy());
    expect(screen.getByText("Licensing")).toBeTruthy();
    expect(screen.getByText("Closing words.")).toBeTruthy();
    expect(screen.getByTestId("casl-choice")).toBeTruthy();
    expect(screen.getByText(/I have read this document and I agree to it\./)).toBeTruthy();
    expect(screen.getByText("Sign").closest("button")!.hasAttribute("disabled")).toBe(true);
  });
  it("shows the dashboard card when something is waiting", async () => {
    const open = vi.fn();
    render(<PortalDocumentsTeaser portalToken="tok" onOpen={open} />);
    await waitFor(() => expect(screen.getByTestId("documents-teaser")).toBeTruthy());
    fireEvent.click(screen.getByText("Review and sign"));
    expect(open).toHaveBeenCalled();
  });
});
