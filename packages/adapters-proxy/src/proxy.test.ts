import { describe, expect, it } from "vitest";
import { DecideProxy } from "./proxy.js";

describe("DecideProxy", () => {
  it("blocks dangerous tool calls without upstream", async () => {
    const proxy = new DecideProxy({ goal: "safe work", routingMode: "guard" });
    const gated = await proxy.gateTools({
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              id: "1",
              type: "function",
              function: {
                name: "shell",
                arguments: "rm -rf ./prod",
              },
            },
          ],
        },
      ],
    });
    expect(gated.blocked).toBe(true);
    expect(gated.verdicts[0]?.action).toBe("deny");
  });
});
