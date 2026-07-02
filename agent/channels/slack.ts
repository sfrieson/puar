import { connectSlackCredentials } from "@vercel/connect/eve";
import { Card, Image, slackChannel } from "eve/channels/slack";

// Slack only auto-unfurls bare, standalone URLs, and treats bot-posted links
// conservatively — so a generated image URL dropped into the reply text renders
// as a link chip, not a picture. Instead, when generate_puar_image finishes, we
// post the result as a native Block Kit image so it always shows inline. The
// tool's toModelOutput tells the model the image is already delivered, so it
// just writes a caption and never pastes the URL.
export default slackChannel({
  credentials: connectSlackCredentials("slack/puar"),
  events: {
    async "action.result"(data, channel) {
      const result = data.result;
      if (result?.kind !== "tool-result") return;
      if (result.toolName !== "generate_puar_image") return;

      const output = result.output as { imageUrl?: string; scene?: string } | null;
      if (!output?.imageUrl) return;

      const alt = output.scene ?? "Puar";
      await channel.thread.post({
        card: Card({ children: [Image({ url: output.imageUrl, alt })] }),
        fallbackText: alt,
      });
    },
  },
});
