import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { cleanDob, dobRequiredFor } from "../../supabase/functions/_shared/dob";
import { StepHouseholdProfile } from "@/modules/intake/components/onboarding/StepHouseholdProfile";

describe("date of birth rules", () => {
  it("accepts a real past date, blank as null, and refuses the rest", () => {
    expect(cleanDob("1955-06-01", "2026-10-16")).toBe("1955-06-01");
    expect(cleanDob("  ", "2026-10-16")).toBeNull();
    for (const bad of ["1955-13-01", "1955-02-30", "0002-06-01", "2030-01-01", "June 1", "55-06-01"]) expect(cleanDob(bad, "2026-10-16")).toBe("invalid");
  });
  it("requires it for the adults, not for children", () => {
    expect(dobRequiredFor("head_of_family")).toBe(true);
    expect(dobRequiredFor("spouse")).toBe(true);
    expect(dobRequiredFor("beneficiary")).toBe(false);
    expect(dobRequiredFor(null)).toBe(false);
  });
});

const state = (over: any = {}): any => ({
  household: { label: "Smith Household", address: "1 Main St", legacyUpgrade: false },
  contact: { fullName: "Jane Smith", lastName: "Smith", email: "j@x.ca", phone: "", dateOfBirth: null },
  members: [],
  ...over,
});

describe("the household step asks for date of birth", () => {
  it("will not continue until you give yours", () => {
    const onSave = vi.fn();
    render(<StepHouseholdProfile state={state()} saving={false} onSave={onSave} />);
    const button = screen.getByRole("button", { name: "Save and continue" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Your date of birth"), { target: { value: "1970-04-02" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dateOfBirth: "1970-04-02" }));
  });
  it("asks for a spouse already on file who has none, and needs it", () => {
    const onSave = vi.fn();
    render(<StepHouseholdProfile state={state({ contact: { fullName: "Jane Smith", lastName: "Smith", email: "", phone: "", dateOfBirth: "1970-04-02" }, members: [{ id: "s1", fullName: "Sam Smith", email: null, role: "spouse", dateOfBirth: null }] })} saving={false} onSave={onSave} />);
    const button = screen.getByRole("button", { name: "Save and continue" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Date of birth for Sam Smith"), { target: { value: "1972-09-09" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ memberDobs: { s1: "1972-09-09" } }));
  });
  it("does not ask again for someone whose date of birth is on file", () => {
    render(<StepHouseholdProfile state={state({ contact: { fullName: "Jane Smith", lastName: "Smith", email: "", phone: "", dateOfBirth: "1970-04-02" }, members: [{ id: "s1", fullName: "Sam Smith", email: null, role: "spouse", dateOfBirth: "1972-09-09" }] })} saving={false} onSave={vi.fn()} />);
    expect(screen.queryByLabelText("Date of birth for Sam Smith")).toBeNull();
    expect((screen.getByRole("button", { name: "Save and continue" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
