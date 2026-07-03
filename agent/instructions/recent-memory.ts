import { defineDynamic, defineInstructions } from "eve/instructions";
import { currentThread, renderRecentContext } from "../lib/recent-memory.js";

// Injects the rolling window of recent cross-conversation messages into Puar's
// context each turn. The current thread is excluded (currentThread is set by the
// Slack channel's turn.started handler) so Puar never sees a message twice — once
// in live history and once here. Returns null when there's nothing to add, which
// composes cleanly after the always-on agent/instructions.md.
export default defineDynamic({
  events: {
    "turn.started": async () => {
      const markdown = await renderRecentContext(currentThread.get());
      if (!markdown) return null;
      return defineInstructions({ markdown });
    },
  },
});
