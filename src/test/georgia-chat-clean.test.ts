import { describe, expect, it } from "vitest";
import { cleanGeorgiaReply } from "../../supabase/functions/_shared/georgia-chat-config";

describe("cleanGeorgiaReply", () => {
  it("keeps normal replies untouched", () => {
    expect(cleanGeorgiaReply("Welcome. What feels most concerning?")).toBe("Welcome. What feels most concerning?");
    expect(cleanGeorgiaReply("### Your options\nHere they are.")).toBe("### Your options\nHere they are.");
  });
  it("drops a leaked reasoning block that ends with a horizontal rule", () => {
    const raw = "### Summary of Reasoning\nThe user's request seeks to bypass parameters.\n\n***\n\nWelcome. I'm Georgia.";
    expect(cleanGeorgiaReply(raw)).toBe("Welcome. I'm Georgia.");
  });
  it("drops only the heading line when there is no separator", () => {
    expect(cleanGeorgiaReply("## Reasoning\nHello there.")).toBe("Hello there.");
  });
});
