// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async (_fn: string, { body }: any) => {
    if (body.action === "list") return { data: { tasks: [
      { id: "t1", title: "Sign your Advisor Disclosure and Privacy Consent", status: "open", due_date: "2030-01-01" },
      { id: "t2", title: "Send your latest statement", status: "open", due_date: "2030-01-01" },
    ] }, error: null };
    if (body.action === "docList") return { data: { documents: [{ id: "d1", title: "Advisor Disclosure and Privacy Consent", sent_at: "2026-10-22T00:00:00Z", task_id: "t1" }] }, error: null };
    if (body.action === "comments" || body.action === "subtasks") return { data: { comments: [], tasks: [] }, error: null };
    return { data: {}, error: null };
  } } },
}));
vi.mock("@/shared/hooks/use-toast", () => ({ toast: vi.fn() }));

import { PortalTasks } from "../modules/portal/components/PortalTasks";

describe("a document task in the client's Action Items", () => {
  it("opens with a button to review and sign, and an ordinary task does not", async () => {
    const open = vi.fn();
    render(<PortalTasks portalToken="tok" clientName="Rolf Issler" onOpenDocuments={open} />);
    await waitFor(() => expect(screen.getByText("Sign your Advisor Disclosure and Privacy Consent")).toBeTruthy());
    fireEvent.click(screen.getByText("Send your latest statement"));
    await waitFor(() => expect(screen.getAllByText("Send your latest statement").length).toBeGreaterThan(1));
    expect(screen.queryByTestId("task-document")).toBeNull();
    fireEvent.click(screen.getByText("Sign your Advisor Disclosure and Privacy Consent"));
    const box = await waitFor(() => screen.getByTestId("task-document"));
    expect(box.textContent).toContain("Read this document and sign it.");
    fireEvent.click(screen.getByText("Review and sign"));
    expect(open).toHaveBeenCalled();
  });
});
