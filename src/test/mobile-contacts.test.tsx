// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const rows = [
  { id: "c1", first_name: "Justin", last_name: "Santos", email: "j@x.ca", phone: "+16045550101", address: null, household_id: "h1", households: { label: "Santos Household", governance_status: "sovereign", fiduciary_entity: "pwa", relationship_ended_at: null }, updated_at: "2026-10-20" },
  { id: "c2", first_name: "Lisa", last_name: "Santos", email: null, phone: null, address: null, household_id: "h1", households: { label: "Santos Household", governance_status: "sovereign", fiduciary_entity: "pwa", relationship_ended_at: null }, updated_at: "2026-10-19" },
  { id: "c3", first_name: "Aamir", last_name: "Zed", email: "a@x.ca", phone: "+12505550102", address: null, household_id: null, households: null, updated_at: "2026-10-01" },
];
const dial = vi.hoisted(() => vi.fn());
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ order: () => ({ order: () => Promise.resolve({ data: rows }) }) }) }) } }));
vi.mock("@/shared/components/AppLayout", () => ({ AppLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/modules/crm/components/ContactCsvImport", () => ({ ContactCsvImport: () => <span>IMPORT</span> }));
vi.mock("@/shared/lib/quo-dial", () => ({ dialViaQuo: dial }));

import Contacts from "@/modules/crm/pages/Contacts";
import { CrmTabs, CRM_TABS } from "@/modules/crm/components/CrmTabs";
import { MobileSectionList } from "@/shared/components/MobileSectionList";
import { Phone, Mail } from "lucide-react";

const width = (w: number) => { Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: w }); };
afterEach(() => width(1024));
const at = (path: string, ui: React.ReactNode) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe("a page's sections on a phone", () => {
  it("are large rows that open the section, not a strip of tabs", () => {
    const onOpen = vi.fn();
    render(<MobileSectionList sections={[{ value: "comms", label: "Communications", icon: Phone, hint: "Texts and calls" }, { value: "tax", label: "Tax", icon: Mail }]} onOpen={onOpen} />);
    const list = screen.getByTestId("mobile-sections");
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(within(list).getByText("Texts and calls")).toBeTruthy();
    expect(screen.getByTestId("section-comms").className).toContain("min-h-14"); // 56px: a comfortable tap
    fireEvent.click(screen.getByTestId("section-tax"));
    expect(onOpen).toHaveBeenCalledWith("tax");
  });
});

describe("the CRM sections on a phone", () => {
  it("are one button naming where you are, opening the other sections from the bottom", () => {
    width(390);
    at("/households", <CrmTabs />);
    const button = screen.getByTestId("crm-section-button");
    expect(button.textContent).toBe("Households");
    expect(screen.queryByTestId("crm-sections")).toBeNull();
    fireEvent.click(button);
    const sheet = screen.getByTestId("crm-sections");
    for (const t of CRM_TABS) expect(within(sheet).getByText(t.label).closest("a")?.getAttribute("href"), t.label).toBe(t.to);
    expect(within(sheet).getByText("Former clients").closest("a")?.getAttribute("href")).toBe("/former-clients");
    expect(sheet.className).toContain("bottom-0");
  });
  it("stay a row of tabs on a desktop", () => {
    width(1280);
    at("/contacts", <CrmTabs />);
    expect(screen.queryByTestId("crm-section-button")).toBeNull();
    expect(screen.getByText("Corporate Holdings")).toBeTruthy();
  });
});

describe("the contacts list on a phone", () => {
  it("has a big search, a filters button, rows that open the person with a Call button, a letter index and a new-contact button", async () => {
    width(390);
    at("/contacts", <Contacts />);
    const header = await screen.findByTestId("contacts-phone-header");
    expect(within(header).getByLabelText("Search contacts").className).toContain("h-11");
    expect(screen.queryByTestId("contacts-filters")).toBeNull();
    fireEvent.click(within(header).getByLabelText("Filters"));
    expect(screen.getByTestId("contacts-filters")).toBeTruthy();
    expect(screen.getByTestId("contacts-count").textContent).toBe("2 contacts"); // clients only: Aamir has no household

    const list = screen.getAllByTestId("phone-contact-row");
    expect(list).toHaveLength(2);
    expect(within(list[0]).getByText("Justin Santos").closest("a")?.getAttribute("href")).toBe("/contacts/c1");
    expect(within(list[0]).getByText("Santos Household")).toBeTruthy(); // the household replaces the hidden column
    fireEvent.click(within(list[0]).getByLabelText("Call Justin Santos"));
    expect(dial).toHaveBeenCalledWith("+16045550101");
    expect(within(list[1]).queryByLabelText(/Call/)).toBeNull(); // no number, no button

    const index = screen.getByTestId("letter-index");
    expect(within(index).getAllByRole("button").map((b) => b.textContent)).toEqual(["S"]); // only the letters that have someone
    expect(screen.getByTestId("new-contact-fab").getAttribute("href")).toBe("/contacts/new");
    expect(screen.queryByText("IMPORT")).toBeNull(); // the CSV import is a desktop job
  });
  it("narrows by the search", async () => {
    width(390);
    at("/contacts", <Contacts />);
    await screen.findByTestId("contacts-phone-header");
    fireEvent.change(screen.getByLabelText("Search contacts"), { target: { value: "lisa" } });
    expect(screen.getAllByTestId("phone-contact-row")).toHaveLength(1);
    expect(screen.getByTestId("contacts-count").textContent).toBe("1 contact");
  });
});

describe("the contact page on a phone", () => {
  const src = readFileSync("src/modules/crm/pages/ContactDetail.tsx", "utf8");
  it("opens each section as the next screen, with the open one in the address so Back returns to the list", () => {
    expect(src).toContain('{...(phone ? { value: section ?? "" } : { defaultValue: "comms" })}');
    expect(src).toContain("const openSection = (value: string) => setSectionParams({ section: value });"); // a new history entry, not a replacement
    expect(src).toContain("{phone && !section && <MobileSectionList sections={CONTACT_SECTIONS}");
    expect(src).toContain("{!phone && <TabsList");
    for (const v of ["comms", "vault", "insurance", "actions", "vineyard", "tax", "analytics"]) expect(src).toContain(`value: "${v}"`);
  });
  it("has Call, Text and Email at the top, and hides the header while a section is open", () => {
    expect(src).toContain('data-testid="contact-quick-actions"');
    expect(src).toContain("dialViaQuo(contact.phone)");
    expect(src).toContain('onClick={() => openSection("comms")}');
    expect(src).toContain('window.location.href = `mailto:${contact.email}`');
    expect(src).toContain('<Card className={phone && section ? "hidden" : undefined}>');
  });
  it("puts View Portal and More Actions on their own full-width row", () => {
    expect(src).toContain("flex w-full items-center gap-2 md:w-auto md:shrink-0");
    expect(src).toContain("h-11 flex-1");
    expect(src).toContain("hidden shrink-0 md:inline-flex"); // the arrow: the phone's Back does that
  });
  it("has no breadcrumb trail on a phone", () => {
    expect(readFileSync("src/shared/components/PageBreadcrumbs.tsx", "utf8")).toContain('className="mb-4 hidden md:block"');
  });
});
