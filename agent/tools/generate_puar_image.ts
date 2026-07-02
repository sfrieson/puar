import { defineTool } from "eve/tools";
import { z } from "zod";

// Flora AI "Puar Image Gen" technique. It already knows what Puar looks like, so
// the scene text just needs to describe the situation. Base URL is overridable
// for testing against a different Flora host.
const FLORA_API_BASE = process.env.FLORA_API_BASE ?? "https://app.flora.ai/api/v1";
const TECHNIQUE_SLUG = "puar-image-gen-hbm07b";
const INPUT_ID = "text-1";
const OUTPUT_ID = "puar-image-gen";

// Async runs finish in ~10-40s; give up after this so a stuck run doesn't hang
// the turn forever.
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 90_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type FloraRun = {
  run_id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress?: number;
  poll_url?: string;
  charged_cost?: number;
  error_code?: string;
  error_message?: string;
  outputs?: Array<{ output_id: string; type: string; url?: string; value?: string }>;
};

// Flora errors come back as { error: { code, message } }. Pull out a readable
// line, falling back to the raw body when the shape is unexpected.
async function floraError(res: Response): Promise<string> {
  const body = await res.text();
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } };
    if (parsed.error?.message) {
      return parsed.error.code
        ? `${parsed.error.message} (${parsed.error.code})`
        : parsed.error.message;
    }
  } catch {
    // fall through to raw body
  }
  return body || `${res.status} ${res.statusText}`;
}

export default defineTool({
  description:
    "Generate an image of Puar in a described situation using Flora AI. Pass a " +
    "vivid, specific one-line scene (subject, action, setting, mood), e.g. " +
    "'Puar sipping coffee in a rainy Williamsburg cafe at dusk.' The technique " +
    "already depicts Puar, so you don't need to explain who Puar is. Each call " +
    "costs money and takes ~10-40s, so use it when someone actually asks for a " +
    "picture of Puar. Returns an image URL you can share in your reply.",
  inputSchema: z.object({
    scene: z
      .string()
      .min(3)
      .max(1000)
      .describe(
        "A vivid one-line description of the situation to depict Puar in, e.g. " +
          "'Puar sipping coffee in a rainy Williamsburg cafe at dusk.'",
      ),
  }),
  async execute({ scene }) {
    const apiKey = process.env.FLORA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "FLORA_API_KEY is not set, so I can't generate images yet. Add your Flora " +
          "API key to the environment.",
      );
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    const submitRes = await fetch(`${FLORA_API_BASE}/techniques/${TECHNIQUE_SLUG}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs: [{ id: INPUT_ID, type: "text", value: scene.trim() }],
        mode: "async",
      }),
    });
    if (!submitRes.ok) {
      throw new Error(`Flora rejected the image request: ${await floraError(submitRes)}`);
    }

    const run = (await submitRes.json()) as FloraRun;
    const pollUrl =
      run.poll_url ?? `${FLORA_API_BASE}/techniques/${TECHNIQUE_SLUG}/runs/${run.run_id}`;

    const deadline = Date.now() + MAX_WAIT_MS;
    let current = run;
    while (current.status === "pending" || current.status === "running") {
      if (Date.now() >= deadline) {
        throw new Error("Puar's portrait is taking too long; please try again.");
      }
      await sleep(POLL_INTERVAL_MS);

      const pollRes = await fetch(pollUrl, { headers });
      if (!pollRes.ok) {
        throw new Error(`Couldn't check on the image: ${await floraError(pollRes)}`);
      }
      current = (await pollRes.json()) as FloraRun;
    }

    if (current.status === "failed") {
      const detail = current.error_message ?? current.error_code ?? "unknown error";
      throw new Error(`Flora couldn't generate the image: ${detail}`);
    }

    const output =
      current.outputs?.find((o) => o.output_id === OUTPUT_ID) ??
      current.outputs?.find((o) => o.type === "imageUrl");
    const imageUrl = output?.url ?? output?.value;
    if (!imageUrl) {
      throw new Error("Flora finished but returned no image URL.");
    }

    return {
      imageUrl,
      scene: scene.trim(),
      cost: current.charged_cost,
      runId: current.run_id,
    };
  },
  // On Slack the channel posts the image itself as a native block (see
  // agent/channels/slack.ts) using the full object. Other surfaces (eve web,
  // etc.) don't, so the model should also share the raw URL as a fallback so
  // the image is always reachable. Ask for it on its own line so channels that
  // unfurl/render bare URLs can.
  toModelOutput(output) {
    return {
      type: "text",
      value:
        `Generated an image of Puar (scene: ${output.scene}). Add a short, fun ` +
        `caption in your reply, then include the image URL on its own line so ` +
        `it renders everywhere:\n${output.imageUrl}`,
    };
  },
});
