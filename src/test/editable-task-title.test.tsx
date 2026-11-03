// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTask = vi.fn(async (id: string, u: Record<string, unknown>) => ({ id, title: "x", ...u }));
vi.mock("@/shared/lib/agents", () => ({ getTaskAgent: () => ({ updateTask: (id: string, u: Record<string, unknown>) => updateTask(id, u) }) }));
import { EditableTaskTitle } from "@/modules/pm/components/EditableTaskTitle";

const task = { id: "a", title: "Send the transfer form" } as never;
beforeEach(() => { document.body.innerHTML = ""; updateTask.mockClear(); });

describe("renaming a task from its title", () => {
  it("click, type, Enter saves the trimmed title and hands the updated task back", async () => {
    const onSaved = vi.fn();
    render(<EditableTaskTitle task={task} onSaved={onSaved} />);
    fireEvent.click(screen.getByTestId("task-title"));
    const input = screen.getByTestId("task-title-input");
    fireEvent.change(input, { target: { value: "  Send the signed transfer form  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("a", { title: "Send the signed transfer form" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "a", title: "Send the signed transfer form" })));
  });
  it("saves when the box is left", async () => {
    render(<EditableTaskTitle task={task} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByTestId("task-title"));
    fireEvent.change(screen.getByTestId("task-title-input"), { target: { value: "Renamed" } });
    fireEvent.blur(screen.getByTestId("task-title-input"));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("a", { title: "Renamed" }));
  });
  it("leaves the title alone on Escape, when unchanged, or when emptied", () => {
    render(<EditableTaskTitle task={task} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByTestId("task-title"));
    fireEvent.change(screen.getByTestId("task-title-input"), { target: { value: "Something else" } });
    fireEvent.keyDown(screen.getByTestId("task-title-input"), { key: "Escape" });
    expect(screen.getByTestId("task-title").textContent).toBe("Send the transfer form");
    fireEvent.click(screen.getByTestId("task-title"));
    fireEvent.change(screen.getByTestId("task-title-input"), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByTestId("task-title-input"), { key: "Enter" });
    fireEvent.click(screen.getByTestId("task-title"));
    fireEvent.keyDown(screen.getByTestId("task-title-input"), { key: "Enter" });
    expect(updateTask).not.toHaveBeenCalled();
  });
  it("is at the top of the shared task panel, so every list that opens a task has it", () => {
    expect(readFileSync("src/modules/pm/components/TaskDetailPanel.tsx", "utf8")).toContain("<EditableTaskTitle task={task} onSaved={onChanged} />");
  });
});
