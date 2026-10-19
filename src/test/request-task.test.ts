import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { requestAcknowledgement, requestDueDate, requestTaskTitle } from "../../supabase/functions/_shared/request-task";
import { availability } from "../../supabase/functions/_shared/support-context";

const WED = new Date("2026-10-21T20:00:00Z");
const SAT = new Date("2026-10-17T20:00:00Z");

describe("the acknowledgement", () => {
  it("says the request is logged as a task, is closed here, and that anything further continues in the task", () => {
    const t = requestAcknowledgement({ firstName: "Geneva", type: "banking_withdrawal", availability: availability(null, WED) });
    expect(t).toContain("Thanks, Geneva.");
    expect(t).toContain("banking and withdrawal request");
    expect(t).toContain("logged it as a task in your portal");
    expect(t).toContain("This request is now closed here");
    expect(t).toContain("If anything further is required, we will do it through that task.");
    expect(t).not.toContain("out of the office");
  });
  it("says when Rolf is back if he is away, at the weekend or on set dates", () => {
    expect(requestAcknowledgement({ firstName: "Ed", type: "document_request", availability: availability(null, SAT) })).toContain("back on Monday");
    const away = availability({ away_from: "2026-10-20", away_until: "2026-10-23", note: null }, WED);
    expect(requestAcknowledgement({ firstName: null, type: "general_inquiry", availability: away })).toMatch(/^Thanks\. .*back on Monday/);
  });
  it("names the task for each kind of request", () => {
    expect(requestTaskTitle("data_access")).toBe("Personal information access request");
    expect(requestTaskTitle("something_new")).toBe("Request");
  });
});

describe("when the task is due", () => {
  it("is two business days out, skipping the weekend", () => {
    expect(requestDueDate("2026-10-21", null)).toBe("2026-10-23"); // Wed to Fri
    expect(requestDueDate("2026-10-22", null)).toBe("2026-10-26"); // Thu to Mon
    expect(requestDueDate("2026-10-17", null)).toBe("2026-10-20"); // Sat to Tue
  });
  it("counts from the day Rolf is back when he is away", () => {
    expect(requestDueDate("2026-10-21", "2026-10-26")).toBe("2026-10-28");
    expect(requestDueDate("2026-10-21", "2026-10-20")).toBe("2026-10-23");
  });
});

describe("how a submitted request is handled", () => {
  const src = readFileSync("supabase/functions/portal-assistant/index.ts", "utf8");
  it("makes a client-visible task for Rolf, and closes the request only after the task and the acknowledgement exist", () => {
    const task = src.indexOf('from("pm_tasks").insert');
    const ack = src.indexOf('from("portal_request_messages").insert');
    const close = src.indexOf('status: "resolved"');
    expect(task).toBeGreaterThan(0);
    expect(src.slice(task, task + 700)).toContain("client_visible: true");
    expect(src.slice(task, task + 700)).toContain("assignee_id: rolfId");
    expect(ack).toBeGreaterThan(task);
    expect(close).toBeGreaterThan(ack);
  });
  it("shows Georgia's comments as Georgia's in the client portal and the Pro Portal, never as the client's or the professional's", () => {
    for (const f of ["portal-pm-tasks", "pm-pro-tasks"]) {
      const s = readFileSync(`supabase/functions/${f}/index.ts`, "utf8");
      expect(s).toContain("author_agent_key");
      expect(s).toContain('"Georgia"');
    }
  });
});
