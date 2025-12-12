import type { Env } from "./cors";
import { sleep } from "./utils";

export type Msg = { role: "system" | "user"; content: string };

export interface JsonSchemaFormat {
  type: "json_schema";
  name: string;
  strict: boolean;
  schema: any;
}

export interface OpenAIJsonSchemaRequest {
  model: string;
  input: Msg[] | string;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  schema_name: string;
  schema: any;
  // If true, don't store (recommended for games / evals)
  store?: boolean;
}

export async function callOpenAIJsonSchema<T>(
  env: Env,
  req: OpenAIJsonSchemaRequest,
): Promise<T> {
  // Convert input to messages format
  let messages: Msg[];
  if (typeof req.input === "string") {
    messages = [{ role: "user", content: req.input }];
  } else {
    messages = req.input;
  }

  const body: any = {
    model: req.model,
    messages: messages,
    temperature: req.temperature ?? 0.2,
    top_p: req.top_p ?? 1.0,
    max_tokens: req.max_output_tokens ?? 256,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: req.schema_name,
        schema: req.schema,
        strict: true,
      },
    },
  };

  const url = "https://api.openai.com/v1/chat/completions";

  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      const txt = await r.text();
      if (!r.ok) {
        throw new Error(`OpenAI error ${r.status}: ${txt.slice(0, 500)}`);
      }

      const data = JSON.parse(txt);
      const outText = extractOutputText(data);
      return JSON.parse(outText) as T;
    } catch (e: any) {
      lastErr = e;
      // small backoff
      await sleep(200 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("OpenAI request failed");
}

function extractOutputText(resp: any): string {
  // Chat completions API: choices[0].message.content
  const choices = resp?.choices ?? [];
  if (choices.length > 0) {
    const message = choices[0]?.message;
    if (message?.content) {
      return message.content.trim();
    }
  }

  // Fallback for Responses API format (legacy)
  const output = resp?.output ?? [];
  let chunks: string[] = [];
  for (const item of output) {
    if (item?.type !== "message") continue;
    const content = item?.content ?? [];
    for (const c of content) {
      if (c?.type === "output_text" && typeof c?.text === "string") {
        chunks.push(c.text);
      }
    }
  }
  const joined = chunks.join("").trim();
  if (!joined) {
    const fallback = resp?.output_text;
    if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
    throw new Error("No output_text found in OpenAI response");
  }
  return joined;
}
