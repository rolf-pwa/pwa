import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const candidates = [
  { id: "t1", title: "Governance Review Followup", client: "Colleen Jerczynski", completed_at: "2026-10-22T18:00:00Z", subtasks: 3, comments: 2, meeting_followup: false, has_record: false, suggested: true },
  { id: "t2", title: "Non-Reg Withdrawal - $10,000", client: "Colleen Jerczynski", completed_at: "2026-09-02T18:00:00Z", subtasks: 0, comments: 2, meeting_followup: false, has_record: false, suggested: false },
  { id: "t3", title: "Sovereignty Review", client: "Ed Weiss", completed_at: "2026-10-01T18:00:00Z", subtasks: 2, comments: 1, meeting_followup: true, has_record: true, suggested: false },
];
const created: string[][] = [];
const create = async (ids: string[]) => { created.push(ids); return ids.map((id) => ({ id, status: "created" as const })); };
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/crm/lib/meetingRecords", () => ({
  BACKFILL_SINCE: "2026-09-01",
  getRecordCandidates: async () => candidates,
  createRecords: (ids: string[]) => create(ids),
}));
import { MeetingRecordsCard } from "@/modules/crm/components/MeetingRecordsCard";

describe("meeting records backfill", () => {
  beforeEach(() => { created.length = 0; });

  it("lists completed follow-ups since September with the likely ones ticked, and marks those already filed", async () => {
    render(<MeetingRecordsCard />);
    fireEvent.click(screen.getByRole("button", { name: "Find completed follow-ups" }));
    await screen.findByText(/Governance Review Followup/);
    expect((screen.getByLabelText("Select Governance Review Followup") as HTMLElement).getAttribute("data-state")).toBe("checked");
    expect((screen.getByLabelText("Select Non-Reg Withdrawal - $10,000") as HTMLElement).getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByText("Filed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "File 1 record" })).toBeTruthy();
  });

  it("files only the ticked tasks", async () => {
    render(<MeetingRecordsCard />);
    fireEvent.click(screen.getByRole("button", { name: "Find completed follow-ups" }));
    await screen.findByText(/Governance Review Followup/);
    fireEvent.click(screen.getByLabelText("Select Non-Reg Withdrawal - $10,000"));
    fireEvent.click(screen.getByRole("button", { name: "File 2 records" }));
    await waitFor(() => expect(created).toEqual([["t1", "t2"]]));
  });
});
