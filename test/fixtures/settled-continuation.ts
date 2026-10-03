import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Start a competing continuation at the same settled boundary used after reload. */
export default function settledContinuation(pi: ExtensionAPI) {
  let continued = false;
  pi.on("agent_settled", () => {
    if (continued) return;
    continued = true;
    pi.sendMessage(
      { customType: "test-continuation", content: "Resume the existing run.", display: true },
      { triggerTurn: true },
    );
  });
}
