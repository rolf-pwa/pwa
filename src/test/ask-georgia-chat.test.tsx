import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PortalGeorgiaChat } from "@/modules/portal/components/PortalGeorgiaChat";

const types = [{ label: "Portfolio Review", url: "https://x/short", embedUrl: "https://x/embed" }];

function reply(body: object) { return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response); }
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body));
/** A fetch that answers the thread load with `history` and every chat message with the next of `chats`. */
function portal(chats: object[], history: object = { conversationId: null, messages: [], advisorActive: false }) {
  const queue = [...chats];
  return vi.fn((_url: string, init: RequestInit) => (bodyOf(init).action === "history" ? reply(history) : reply(queue.shift() ?? {})));
}
const chatCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => !bodyOf(c[1]).action).map((c) => bodyOf(c[1]));

describe("Ask Georgia chat", () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => vi.restoreAllMocks());

  it("sends the page's meetings and keeps the conversation id across turns", async () => {
    const fetchMock = portal([{ text: "Hello", functionCalls: [], conversationId: "c1" }, { text: "Again", functionCalls: [], conversationId: "c1" }]);
    vi.stubGlobal("fetch", fetchMock);
    render(<PortalGeorgiaChat open onOpenChange={() => {}} contactName="Ed" contactId="k" portalToken="t" meetingTypes={types} bookedMeetings={[]} />);
    const input = screen.getByPlaceholderText("Type your question...");
    fireEvent.change(input, { target: { value: "one" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Hello");
    fireEvent.change(input, { target: { value: "two" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Again");
    const [first, second] = chatCalls(fetchMock);
    expect(first.context.bookable).toEqual(["Portfolio Review"]);
    expect(first.conversation_id).toBeNull();
    expect(second.conversation_id).toBe("c1");
  });

  it("shows a booking button for a meeting the page lists, and opens it", async () => {
    vi.stubGlobal("fetch", portal([{ text: "Happy to help.", functionCalls: [{ name: "offer_booking", args: { meeting: "portfolio review" } }], conversationId: "c1" }]));
    const onOpenBooking = vi.fn();
    render(<PortalGeorgiaChat open onOpenChange={() => {}} contactName="Ed" contactId="k" portalToken="t" meetingTypes={types} onOpenBooking={onOpenBooking} />);
    const input = screen.getByPlaceholderText("Type your question...");
    fireEvent.change(input, { target: { value: "can we meet" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: /Choose a time: Portfolio Review/ }));
    expect(onOpenBooking).toHaveBeenCalledWith(types[0]);
  });

  it("offers nothing for a meeting name the page does not list", async () => {
    vi.stubGlobal("fetch", portal([{ text: "Sure.", functionCalls: [{ name: "offer_booking", args: { meeting: "Secret Meeting" } }], conversationId: "c1" }]));
    render(<PortalGeorgiaChat open onOpenChange={() => {}} contactName="Ed" contactId="k" portalToken="t" meetingTypes={types} />);
    const input = screen.getByPlaceholderText("Type your question...");
    fireEvent.change(input, { target: { value: "meet" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Sure.");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Choose a time/ })).toBeNull());
  });

  it("picks up the running thread, shows Rolf's reply as his, and says he is handling it", async () => {
    vi.stubGlobal("fetch", portal([], { conversationId: "c9", advisorActive: true, messages: [
      { role: "user", content: "Where is my withdrawal?" },
      { role: "advisor", content: "It went out this morning." },
    ] }));
    render(<PortalGeorgiaChat open onOpenChange={() => {}} contactName="Ed" contactId="k" portalToken="t" />);
    await screen.findByText("It went out this morning.");
    expect(screen.getByText("Rolf")).toBeTruthy();
    expect(screen.getByText("Where is my withdrawal?")).toBeTruthy();
    expect(screen.getByText(/Rolf is handling this conversation/)).toBeTruthy();
  });

  it("while Rolf is handling it, a message gets no answer from Georgia and the notice stays", async () => {
    const f = portal([{ text: "", held: true, conversationId: "c9" }], { conversationId: "c9", advisorActive: false, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] });
    vi.stubGlobal("fetch", f);
    render(<PortalGeorgiaChat open onOpenChange={() => {}} contactName="Ed" contactId="k" portalToken="t" />);
    await screen.findByText("hello");
    const input = screen.getByPlaceholderText("Type your question...");
    fireEvent.change(input, { target: { value: "any news?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText(/Rolf is handling this conversation/);
    expect(chatCalls(f)[0]).toMatchObject({ message: "any news?", conversation_id: "c9" });
  });
});
