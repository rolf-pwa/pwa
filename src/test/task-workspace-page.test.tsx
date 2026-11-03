// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const day = (n: number) => { const d = new Date(Date.now() + n * 86_400_000); return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); };
const task = (id: string, title: string, o: Record<string, unknown> = {}) => ({ id, project_id: null, parent_task_id: null, title, description: null, status: "open", due_date: null, assignee_id: "rolf", assigned_agent_key: null, household_id: null, contact_id: null, corporation_id: null, family_id: null, completed_at: null, client_visible: false, created_by: "rolf", created_at: "", updated_at: "", ...o });
const tasks = [task("a", "Send the transfer form", { due_date: day(-2) }), task("b", "Call Jane", { due_date: day(0) }), task("c", "File the statements", { assignee_id: null, assigned_agent_key: "georgia", due_date: day(-1) }), task("d", "Review the plan", { due_date: day(30) })];

vi.mock("@/shared/components/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/shared/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "rolf" } }) }));
vi.mock("@/shared/hooks/use-mobile", () => ({ useIsMobile: () => false }));
const updateTask = vi.fn(async (id: string, u: Record<string, unknown>) => ({ ...tasks.find((t) => t.id === id)!, ...u }));
vi.mock("@/shared/lib/agents", () => ({ getTaskAgent: () => ({ listTasks: async () => tasks, listProjects: async () => [], updateTask: (id: string, u: Record<string, unknown>) => updateTask(id, u) }) }));
vi.mock("@/modules/pm/lib/taskEntityLinks", () => ({ resolveTaskEntityLinks: async () => ({}) }));
vi.mock("@/modules/pm/components/TaskDetailPanel", () => ({ TaskDetailPanel: ({ task: t }: { task: { title: string } }) => <div data-testid="panel">panel for {t.title}</div> }));
import TaskWorkspace from "@/modules/pm/pages/TaskWorkspace";

const show = (url = "/tasks") => render(<MemoryRouter initialEntries={[url]}><TaskWorkspace /></MemoryRouter>);
beforeEach(() => { document.body.innerHTML = ""; updateTask.mockClear(); });

describe("the task workspace page", () => {
  it("lists my overdue tasks first, with counts on the tabs, and opens a task in the full panel", async () => {
    show();
    await waitFor(() => expect(screen.getAllByTestId("task-row")).toHaveLength(1));
    expect(screen.getByText("Send the transfer form")).toBeTruthy();
    expect(within(screen.getByTestId("task-tabs")).getByText("Overdue (1)")).toBeTruthy();
    expect(within(screen.getByTestId("task-tabs")).getByText("Today (1)")).toBeTruthy();
    expect(screen.queryByTestId("panel")).toBeNull();
    fireEvent.click(screen.getByTestId("task-row"));
    expect(screen.getByTestId("panel").textContent).toBe("panel for Send the transfer form");
  });
  it("opens a linked task on its own group, with its panel already open", async () => {
    show("/tasks?task=b");
    await waitFor(() => expect(screen.getByTestId("panel").textContent).toBe("panel for Call Jane"));
    expect(screen.getAllByTestId("task-row").map((r) => r.textContent)).toEqual(["Call JaneToday"]);
  });
  it("opens a Georgia task by switching to her scope", async () => {
    show("/tasks?task=c");
    await waitFor(() => expect(screen.getByTestId("panel").textContent).toBe("panel for File the statements"));
  });
  it("searches within the open group", async () => {
    show();
    await waitFor(() => expect(screen.getAllByTestId("task-row")).toHaveLength(1));
    fireEvent.change(screen.getByPlaceholderText(/Search tasks/), { target: { value: "zzz" } });
    expect(screen.queryAllByTestId("task-row")).toHaveLength(0);
    expect(screen.getByText("No task matches.")).toBeTruthy();
  });
  it("renames the open task: click the title, type, Enter saves it and the list follows", async () => {
    show("/tasks?task=a");
    await waitFor(() => expect(screen.getByTestId("task-title").textContent).toBe("Send the transfer form"));
    fireEvent.click(screen.getByTestId("task-title"));
    const input = screen.getByTestId("task-title-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Send the signed transfer form  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("a", { title: "Send the signed transfer form" }));
    await waitFor(() => expect(screen.getByTestId("task-title").textContent).toBe("Send the signed transfer form"));
    expect(within(screen.getByTestId("task-list")).getByText("Send the signed transfer form")).toBeTruthy();
  });
  it("leaves the title alone on Escape, when it is unchanged or when it is emptied", async () => {
    show("/tasks?task=a");
    await waitFor(() => expect(screen.getByTestId("task-title")).toBeTruthy());
    fireEvent.click(screen.getByTestId("task-title"));
    fireEvent.change(screen.getByTestId("task-title-input"), { target: { value: "Something else" } });
    fireEvent.keyDown(screen.getByTestId("task-title-input"), { key: "Escape" });
    expect(screen.getByTestId("task-title").textContent).toBe("Send the transfer form");
    fireEvent.click(screen.getByTestId("task-title"));
    fireEvent.change(screen.getByTestId("task-title-input"), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByTestId("task-title-input"), { key: "Enter" });
    expect(screen.getByTestId("task-title").textContent).toBe("Send the transfer form");
    expect(updateTask).not.toHaveBeenCalled();
  });
});
