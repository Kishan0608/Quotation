import "server-only";
import { AI_MODEL } from "./ai-prompt";
import { geminiTurn, retryAfterMs, waitFor } from "./gemini-limit";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`;

/**
 * One JSON answer from the AI (Gemini) for `text`, shaped by `schema`. Null when the AI is not set
 * up; throws when the request fails (the caller decides what to do then).
 */
export async function geminiJson(system: string, text: string, schema: object, timeoutMs: number): Promise<unknown | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const signal = AbortSignal.timeout(timeoutMs);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, thinkingConfig: { thinkingLevel: "medium" }, maxOutputTokens: 32_768 },
  });
  // In its turn under the free per-minute limit; once more after the wait Google asks for when busy.
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    await geminiTurn(signal);
    res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body, signal });
    if (res.status !== 429 || attempt > 0) break;
    await waitFor(await retryAfterMs(res), signal);
  }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const reply = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const candidate = reply.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") throw new Error(`Gemini gave no full answer (${candidate.finishReason})`);
  return JSON.parse((candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join(""));
}
