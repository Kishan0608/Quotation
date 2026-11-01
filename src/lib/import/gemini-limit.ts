import "server-only";

/**
 * Keeps every AI (Gemini) request of this server inside the free tier's per-minute limit
 * (15 requests a minute): at most REQUESTS_PER_MINUTE start in any 60 seconds, the rest wait their
 * turn instead of being refused ("429 Too Many Requests").
 */
const REQUESTS_PER_MINUTE = 12;
const WINDOW_MS = 60_000;

const started: number[] = [];
let queue: Promise<void> = Promise.resolve();

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/** Waits until a request may start (in order of asking); throws if `signal` aborts first. */
export function geminiTurn(signal?: AbortSignal): Promise<void> {
  const turn = queue.then(async () => {
    for (;;) {
      const now = Date.now();
      while (started.length && now - started[0] >= WINDOW_MS) started.shift();
      if (started.length < REQUESTS_PER_MINUTE) {
        started.push(now);
        return;
      }
      await sleep(WINDOW_MS - (now - started[0]) + 50, signal);
    }
  });
  queue = turn.catch(() => undefined);
  return turn;
}

/**
 * How long Google asks to wait before trying again (the "retryDelay" of a 429 answer), in ms;
 * a few seconds when it doesn't say.
 */
export async function retryAfterMs(res: Response): Promise<number> {
  try {
    const body = (await res.json()) as { error?: { details?: { retryDelay?: string }[] } };
    const delay = body.error?.details?.find((d) => d.retryDelay)?.retryDelay;
    const seconds = delay ? Number.parseFloat(delay) : NaN;
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 1), 60) * 1000;
  } catch {
    // no JSON body
  }
  return 5_000;
}

export { sleep as waitFor };
