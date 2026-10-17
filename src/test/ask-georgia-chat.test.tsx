import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PortalGeorgiaChat } from "@/modules/portal/components/PortalGeorgiaChat";

const types = [{ label: "Portfolio Review", url: "https://x/short", embedUrl: "https://x/embed" }];

function reply(body: object) { return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response); }

describe("Ask Georgia chat", () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => vi.restoreAllMocks());

  it("sends the page's meetings and keeps the conversation id across turns", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => reply({ text: "Hello", functionCalls: [], conversationId: "c1" }))
      .mockImplementationOnce(() => reply({ text: "Again", functionCalls: [], conversationId: "c1" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PortalGeorgiaChat open onOpenChange={() => {}} contactName="Ed" contactId="k" portalToken="t" meetingTypes={types} bookedMeetings={[]} />);
    const input = screen.getByPlaceholderText("Type your question...");
    fireEvent.change(input, { target: { value: "one" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Hello");
    fireEvent.change(input, { target: { value: "two" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Again");
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(first.context.bookable).toEqual(["Portfolio Review"]);
    expect(first.conversation_id).toBeNull();
    expect(second.conversation_id).toBe("c1");
  });

  it("shows a booking button for a meeting the page lists, and opens it", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ text: "Happy to help.", functionCalls: [{ name: "offer_booking", args: { meeting: "portfolio review" } }], conversationId: "c1" })));
    const onOpenBooking = vi.fn();
    render(<PortalGeorgiaChat open onOpenChange={() => {}} contactName="Ed" contactId="k" portalToken="t" meetingTypes={types} onOpenBooking={onOpenBooking} />);
    const input = screen.getByPlaceholderText("Type your question...");
    fireEvent.change(input, { target: { value: "can we meet" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: /Choose a time: Portfolio Review/ }));
    expect(onOpenBooking).toHaveBeenCalledWith(types[0]);
  });

  it("offers nothing for a meeting name the page does not list", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ text: "Sure.", functionCalls: [{ name: "offer_booking", args: { meeting: "Secret Meeting" } }], conversationId: "c1" })));
    render(<PortalGeorgiaChat open onOpenChange={() => {}} contactName="Ed" contactId="k" portalToken="t" meetingTypes={types} />);
    const input = screen.getByPlaceholderText("Type your question...");
    fireEvent.change(input, { target: { value: "meet" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Sure.");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Choose a time/ })).toBeNull());
  });
});
