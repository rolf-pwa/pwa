import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMarkdown } from "@/shared/components/ChatMarkdown";

describe("an assistant's message", () => {
  it("shows bold and lists as formatting, not as asterisks", () => {
    const { container } = render(<ChatMarkdown text={"1. **Edward Banfield (iA):** Create a task?\n2. **Irene:** Draft a reply?"} />);
    expect(container.querySelectorAll("strong")).toHaveLength(2);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).not.toContain("**");
  });
  it("turns plain web addresses into links that open in a new tab", () => {
    render(<ChatMarkdown text={"See https://example.com/a for it."} />);
    const a = screen.getByRole("link");
    expect(a.getAttribute("href")).toBe("https://example.com/a");
  });
  it("never renders HTML from the message", () => {
    const { container } = render(<ChatMarkdown text={'<img src=x onerror="alert(1)"> hi <script>x()</script>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});
