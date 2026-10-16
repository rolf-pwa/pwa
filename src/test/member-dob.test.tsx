import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const update = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { from: () => ({ update: (...a: any[]) => { update(...a); return { eq: () => Promise.resolve({ error: null }) }; } }) } }));

import { MemberDobInput, isValidDob } from "@/modules/crm/components/MemberDobInput";

describe("date of birth in the members directory", () => {
  beforeEach(() => { update.mockReset(); });
  it("accepts a plausible date, or empty to clear, and refuses the rest", () => {
    expect(isValidDob("1955-06-01", "2026-10-16")).toBe(true);
    expect(isValidDob("", "2026-10-16")).toBe(true);
    expect(isValidDob("0002-06-01", "2026-10-16")).toBe(false);
    expect(isValidDob("2030-01-01", "2026-10-16")).toBe(false);
    expect(isValidDob("junk", "2026-10-16")).toBe(false);
  });
  it("saves when the field loses focus, without opening the contact", async () => {
    const onSaved = vi.fn();
    render(<MemberDobInput contactId="c1" value={null} onSaved={onSaved} />);
    const input = screen.getByLabelText("Date of birth");
    fireEvent.change(input, { target: { value: "1955-06-01" } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ date_of_birth: "1955-06-01" }));
    expect(onSaved).toHaveBeenCalledWith("1955-06-01");
  });
  it("does nothing when the date is unchanged", () => {
    render(<MemberDobInput contactId="c1" value="1955-06-01" />);
    fireEvent.blur(screen.getByLabelText("Date of birth"));
    expect(update).not.toHaveBeenCalled();
  });
});
