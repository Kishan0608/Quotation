/**
 * Stops password guessing: after MAX_FAILURES wrong passwords within WINDOW_MS for one email, or
 * from one computer, sign-in is blocked for LOCK_MS. Supabase's own limit counts per IP address,
 * and every sign-in reaches Supabase from this server, so it can't tell attackers apart.
 * Kept in memory: the app runs as one server process.
 */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
const MAX_KEYS = 5_000;

type Entry = { failures: number[]; lockedUntil: number };
const entries = new Map<string, Entry>();

const keysFor = (email: string, ip: string) => [`email:${email}`, `ip:${ip}`];

/** Minutes left on a lock for this email or computer (0 = may try). */
export function lockedMinutes(email: string, ip: string, now = Date.now()) {
  const until = Math.max(0, ...keysFor(email, ip).map((k) => entries.get(k)?.lockedUntil ?? 0));
  return until > now ? Math.ceil((until - now) / 60_000) : 0;
}

/** A wrong password: counts against the email and the computer; locks either one on the 5th. */
export function recordFailure(email: string, ip: string, now = Date.now()) {
  if (entries.size > MAX_KEYS) {
    for (const [k, e] of entries) if (e.lockedUntil <= now && e.failures.every((t) => now - t > WINDOW_MS)) entries.delete(k);
  }
  for (const key of keysFor(email, ip)) {
    const entry = entries.get(key) ?? { failures: [], lockedUntil: 0 };
    entry.failures = [...entry.failures.filter((t) => now - t < WINDOW_MS), now];
    if (entry.failures.length >= MAX_FAILURES) {
      entry.lockedUntil = now + LOCK_MS;
      entry.failures = [];
    }
    entries.set(key, entry);
  }
}

/** Signed in: the email's count starts again (the computer's stays, so one account can't reset it). */
export function recordSuccess(email: string) {
  entries.delete(`email:${email}`);
}
