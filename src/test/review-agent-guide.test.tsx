import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewAgentGuide } from "@/modules/crm/components/ReviewAgentGuide";

describe("ReviewAgentGuide", () => {
  it("is collapsed until opened, then explains the rebalancing steps", () => {
    render(<ReviewAgentGuide />);
    expect(screen.queryByText(/Publish to portal/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /How this page works/ }));
    expect(screen.getAllByText(/Publish to portal/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Waiting for the client/)).toBeTruthy();
    expect(screen.getAllByText(/To carry out/)).toBeTruthy();
  });
});
