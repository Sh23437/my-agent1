// Chat endpoint for the web chief of staff.
// Streams Claude's reply as newline-delimited JSON events:
//   {"t":"text","d":"..."}            a piece of reply text
//   {"t":"done","content":[...]}      the full assistant content blocks (sent back unchanged next turn)
//   {"t":"error","m":"..."}           something went wrong
import Anthropic from "npm:@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompt.generated.ts";

const MAX_TURNS = 60; // messages kept from the end of the conversation
const MAX_USER_CHARS = 8000;

declare const Netlify: { env: { get(name: string): string | undefined } };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function samePassword(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function today() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export default async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const password = Netlify.env.get("CHAT_PASSWORD");
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!password || !apiKey) {
    return json(500, { error: "The site is missing CHAT_PASSWORD or ANTHROPIC_API_KEY in Netlify's environment variables." });
  }
  if (!samePassword(req.headers.get("x-chat-password") ?? "", password)) {
    return json(401, { error: "Wrong password." });
  }

  let body: { messages?: Anthropic.MessageParam[] };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Bad request." });
  }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_TURNS) : [];
  // The kept history must start with a user turn.
  while (messages.length && messages[0].role !== "user") messages.shift();
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || typeof last.content !== "string" || !last.content.trim()) {
    return json(400, { error: "Send a message first." });
  }
  if (last.content.length > MAX_USER_CHARS) {
    return json(400, { error: `Please keep messages under ${MAX_USER_CHARS} characters.` });
  }

  const client = new Anthropic({ apiKey });
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        const s = client.beta.messages.stream({
          model: "claude-opus-5-5",
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low" },
          system: [
            { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            { type: "text", text: `Right now it is ${today()} (Central European Time).` },
          ],
          messages,
        } as Anthropic.Beta.Messages.MessageCreateParamsStreaming);

        for await (const event of s) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ t: "text", d: event.delta.text });
          }
        }
        const final = await s.finalMessage();
        if (final.stop_reason === "refusal") {
          send({ t: "error", m: "Claude declined to answer that one. Try asking another way." });
        } else {
          send({ t: "done", content: final.content, stop: final.stop_reason });
        }
      } catch (err) {
        let m = "Something went wrong. Please try again.";
        if (err instanceof Anthropic.RateLimitError) m = "Too many requests right now. Wait a moment and try again.";
        else if (err instanceof Anthropic.AuthenticationError) m = "The Anthropic API key in Netlify is not valid.";
        else if (err instanceof Anthropic.BadRequestError) m = "The request was rejected. Start a new chat and try again.";
        else if (err instanceof Anthropic.APIConnectionError) m = "Couldn't reach Claude. Please try again.";
        console.error(err);
        send({ t: "error", m });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
};

export const config = { path: "/api/chat" };
