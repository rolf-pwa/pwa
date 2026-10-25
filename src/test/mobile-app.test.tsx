// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "rolf@prosperwise.ca" } as any }));
vi.mock("@/shared/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@/shared/hooks/useAttentionCounts", () => ({ useAttentionCounts: () => ({ inbox: 3, requests: 2, review: 0 }) }));
vi.mock("@/shared/components/NotificationBell", () => ({ NotificationBell: () => <button aria-label="Notifications">bell</button> }));
vi.mock("@/shared/components/EmailSignatureDialog", () => ({ EmailSignatureDialog: ({ open }: any) => (open ? <p>SIGNATURE DIALOG</p> : null) }));
vi.mock("@/shared/lib/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { from: () => ({ insert: () => Promise.resolve({}) }), functions: { invoke: vi.fn() }, channel: () => { const c: any = { on: () => c, subscribe: () => c }; return c; }, removeChannel: vi.fn() } }));
vi.mock("@/shared/components/AppSidebar", async (orig) => ({ ...(await orig<typeof import("@/shared/components/AppSidebar")>()), AppSidebar: () => <div data-testid="desktop-sidebar" /> }));
vi.mock("@/shared/components/AssistantSidebar", () => ({ AssistantSidebar: () => null }));
vi.mock("@/shared/components/CommandPalette", () => ({ CommandPalette: () => null }));

import { MobileShell, MOBILE_TABS, isTabRoot, tabFor } from "@/shared/components/MobileShell";
import { AppLayout } from "@/shared/components/AppLayout";
import MorePage from "@/modules/crm/pages/MorePage";
import { GROUPS } from "@/shared/components/AppSidebar";
import { useIsMobile } from "@/shared/hooks/use-mobile";

const width = (w: number) => { Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: w }); };
afterEach(() => width(1024));
const at = (path: string, ui: React.ReactNode) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe("the phone's bottom bar", () => {
  it("has Today, Messages, Clients, Georgia and More, in that order, each going where it should", () => {
    expect(MOBILE_TABS.map((t) => [t.label, t.to])).toEqual([["Today", "/briefing"], ["Messages", "/inbox"], ["Clients", "/contacts"], ["Georgia", "/georgia"], ["More", "/more"]]);
  });
  it("lights the tab a page belongs to, and More for everything else", () => {
    expect(tabFor("/briefing")).toBe("today");
    expect(tabFor("/households/h1")).toBe("clients");
    expect(tabFor("/contacts/c1")).toBe("clients");
    expect(tabFor("/inbox")).toBe("messages");
    expect(tabFor("/insurance/h1/needs")).toBe("more");
    expect(tabFor("/projects")).toBe("more");
  });
  it("shows Back only on pages deeper than a tab's front page", () => {
    expect(isTabRoot("/contacts")).toBe(true);
    expect(isTabRoot("/contacts/c1")).toBe(false);
    at("/contacts/c1", <MobileShell>page</MobileShell>);
    expect(screen.getByLabelText("Back")).toBeTruthy();
  });
  it("renders the bar with the active tab marked, counts on Today and Messages, and the page between the bars", () => {
    at("/briefing", <MobileShell><p>THE PAGE</p></MobileShell>);
    expect(screen.getByTestId("tab-today").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("tab-clients").getAttribute("aria-current")).toBeNull();
    expect(screen.getByTestId("badge-messages").textContent).toBe("3");
    expect(screen.getByTestId("badge-today").textContent).toBe("2");
    expect(screen.queryByTestId("badge-clients")).toBeNull();
    expect(within(screen.getByTestId("mobile-main")).getByText("THE PAGE")).toBeTruthy();
    expect(screen.queryByLabelText("Back")).toBeNull(); // a tab's own page
    expect(screen.getByTestId("mobile-top-bar").textContent).toContain("Today");
  });
  it("keeps the notch and home bar clear, and is as tall as the real screen", () => {
    at("/briefing", <MobileShell>x</MobileShell>);
    expect(screen.getByTestId("mobile-top-bar").className).toContain("env(safe-area-inset-top)");
    expect(screen.getByTestId("mobile-tabs").className).toContain("env(safe-area-inset-bottom)");
    expect(screen.getByTestId("mobile-shell").className).toContain("h-[100dvh]");
    for (const t of MOBILE_TABS) expect(screen.getByTestId(`tab-${t.key}`).className).toContain("h-14"); // 56px: well over the 44px touch minimum
  });
});

describe("the layout on a phone and on a desktop", () => {
  it("is the app shell below the tablet width, from the first render", () => {
    width(390);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    at("/briefing", <AppLayout><p>PAGE</p></AppLayout>);
    expect(screen.getByTestId("mobile-shell")).toBeTruthy();
    expect(screen.queryByTestId("desktop-sidebar")).toBeNull();
  });
  it("is the desktop sidebar layout on a wide screen", () => {
    width(1280);
    at("/briefing", <AppLayout><p>PAGE</p></AppLayout>);
    expect(screen.getByTestId("desktop-sidebar")).toBeTruthy();
    expect(screen.queryByTestId("mobile-shell")).toBeNull();
  });
});

describe("More", () => {
  it("lists every screen from the sidebar's groups, and the account", () => {
    width(390);
    at("/more", <MorePage />);
    const page = screen.getByTestId("more-page");
    for (const g of GROUPS) for (const i of g.items) expect(within(page).getByText(i.label).closest("a")?.getAttribute("href"), i.to).toBe(i.to);
    expect(within(page).getByText("Sign out")).toBeTruthy();
    fireEvent.click(within(page).getByText("Email signature"));
    expect(screen.getByText("SIGNATURE DIALOG")).toBeTruthy();
  });
  it("says how to put the app on the home screen until it is there", () => {
    width(390);
    at("/more", <MorePage />);
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
  });
});

describe("the installable app", () => {
  const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
  it("has a manifest that opens full screen on Today with the navy colour", () => {
    expect(m).toMatchObject({ name: "ProsperWise", display: "standalone", start_url: "/briefing", theme_color: "#1e293b", background_color: "#1e293b" });
    expect(m.icons.map((i: any) => i.sizes)).toEqual(["192x192", "512x512"]);
  });
  it("has square icons of the sizes it promises", () => {
    const size = (f: string) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    expect(size("public/icon-192.png")).toEqual([192, 192]);
    expect(size("public/icon-512.png")).toEqual([512, 512]);
    expect(size("public/apple-touch-icon.png")).toEqual([180, 180]);
  });
  it("tells iPhone to run it as an app and to draw under the notch", () => {
    const html = readFileSync("index.html", "utf8");
    for (const s of ["viewport-fit=cover", 'rel="manifest" href="/manifest.webmanifest"', 'rel="apple-touch-icon" href="/apple-touch-icon.png"', 'name="apple-mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-status-bar-style"', 'name="theme-color" content="#1e293b"']) expect(html).toContain(s);
  });
  it("stops iOS zooming into form fields", () => {
    expect(readFileSync("src/index.css", "utf8")).toMatch(/max-width: 767px[\s\S]*\.advisor-app input, \.advisor-app select, \.advisor-app textarea \{ font-size: 16px; \}/);
  });
  it("has the Georgia and More pages routed", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain('path="/georgia"'); expect(app).toContain('path="/more"');
  });
});
