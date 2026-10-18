import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { sanitizeCommentHtml, isEmptyHtml } from "@/shared/lib/sanitizeHtml";
import { CommentBody } from "@/shared/components/CommentBody";
import { RichCommentEditor } from "@/shared/components/RichCommentEditor";
import { commentRecipientIds, notifyClientsOfComment, notifyStaffOfClientReply } from "../../supabase/functions/_shared/task-notify";

describe("sanitizing comment HTML", () => {
  it("keeps formatting and drops anything active", () => {
    const out = sanitizeCommentHtml('<p onclick="x()">Hi <strong>Colleen</strong></p><script>alert(1)</script><img src=x onerror=alert(1)><ul><li>One</li></ul>');
    expect(out).toContain("<strong>Colleen</strong>");
    expect(out).toContain("<li>One</li>");
    expect(out).not.toMatch(/script|onclick|onerror|<img/i);
  });
  it("only allows web and mail links, and sends links to a new tab", () => {
    expect(sanitizeCommentHtml('<a href="javascript:alert(1)">bad</a>')).not.toContain("javascript:");
    const ok = sanitizeCommentHtml('<a href="https://example.com">ok</a>');
    expect(ok).toContain('href="https://example.com"');
    expect(ok).toContain('target="_blank"');
    expect(ok).toContain("noopener");
  });
  it("knows when nothing visible is left", () => {
    expect(isEmptyHtml("<p><br></p>")).toBe(true);
    expect(isEmptyHtml("<script>x</script>")).toBe(true);
    expect(isEmptyHtml("<p>Hello</p>")).toBe(false);
  });
});

describe("showing a comment", () => {
  it("shows staff HTML formatted, cleaned", () => {
    const { container } = render(<CommentBody format="html" body={'<ul><li>First</li></ul><script>boom()</script>'} />);
    expect(container.querySelector("li")?.textContent).toBe("First");
    expect(container.querySelector("script")).toBeNull();
  });
  it("shows plain text as text, never as markup, with live links", () => {
    const { container } = render(<CommentBody format="text" body={'<b>not bold</b> see https://example.com/x'} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>not bold</b>");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/x");
  });
  it("treats a missing format as plain text", () => {
    const { container } = render(<CommentBody body={"<i>x</i>"} />);
    expect(container.querySelector("i")).toBeNull();
  });
});

describe("the comment editor", () => {
  it("reports cleaned HTML as the person types", () => {
    const onChange = vi.fn();
    render(<RichCommentEditor value="" onChange={onChange} />);
    const box = screen.getByRole("textbox");
    box.innerHTML = '<p>Thanks <b>so much</b></p><script>x()</script>';
    fireEvent.input(box);
    const html = onChange.mock.calls.at(-1)![0] as string;
    expect(html).toContain("<b>so much</b>");
    expect(html).not.toContain("script");
  });
  it("clears when the value is reset from outside", () => {
    const { rerender } = render(<RichCommentEditor value="<p>x</p>" onChange={() => {}} />);
    const box = screen.getByRole("textbox");
    box.innerHTML = "<p>draft</p>";
    rerender(<RichCommentEditor value="" onChange={() => {}} />);
    expect(box.innerHTML).toBe("");
  });
});

describe("telling people about task comments", () => {
  const task = { id: "t1", title: "Governance Review Followup", client_visible: true, contact_id: "c1", household_id: "h1" };
  it("tells the task's contact; nobody for a task the client cannot see", () => {
    expect(commentRecipientIds(task, [])).toEqual(["c1"]);
    expect(commentRecipientIds({ ...task, client_visible: false }, [])).toEqual([]);
  });
  it("tells the adults of the household when the task has no single contact", () => {
    expect(commentRecipientIds({ ...task, contact_id: null }, [{ id: "a" }, { id: "kid", is_minor: true }, { id: "b" }])).toEqual(["a", "b"]);
  });
  it("sends one notification per recipient, naming the event, and none for hidden tasks", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await notifyClientsOfComment({}, task, "https://x.supabase.co", "key")).toBe(1);
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] ? ((fetchMock.mock.calls[0] as unknown[])[1] as { body: string }).body : "{}"));
    expect(sent).toMatchObject({ notify_type: "task", contact_id: "c1", task_event: "comment" });
    fetchMock.mockClear();
    expect(await notifyClientsOfComment({}, { ...task, client_visible: false }, "https://x", "k")).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("tells Rolf in the app when a client replies", async () => {
    const insert = vi.fn(async () => ({}));
    await notifyStaffOfClientReply({ from: () => ({ insert }) }, task, "Colleen Jerczynski", "Thank you, got it", "c1");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ title: "Colleen Jerczynski replied on: Governance Review Followup", link: "/contacts/c1", source_type: "task_client_reply" }));
  });
});
