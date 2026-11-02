import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lockedMinutes, recordFailure, recordSuccess } from "./login-limit";

describe("sign-in lockout", () => {
  it("5 wrong passwords lock that email for 15 minutes, from any computer", () => {
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) recordFailure("a@x.com", `10.0.0.${i}`, t + i);
    assert.equal(lockedMinutes("a@x.com", "10.0.0.9", t + 10), 0, "4 tries: still allowed");
    recordFailure("a@x.com", "10.0.0.5", t + 20);
    assert.equal(lockedMinutes("a@x.com", "10.0.0.9", t + 30), 15);
    assert.equal(lockedMinutes("a@x.com", "10.0.0.9", t + 15 * 60_000 + 30), 0, "free again after 15 minutes");
  });

  it("one computer trying many emails is locked too", () => {
    const t = 5_000_000;
    for (let i = 0; i < 5; i++) recordFailure(`u${i}@x.com`, "10.1.1.1", t + i);
    assert.ok(lockedMinutes("new@x.com", "10.1.1.1", t + 10) > 0);
    assert.equal(lockedMinutes("new@x.com", "10.1.1.2", t + 10), 0, "other computers are not");
  });

  it("wrong tries spread over more than 15 minutes don't add up; signing in starts the count again", () => {
    const t = 9_000_000;
    for (let i = 0; i < 4; i++) recordFailure("b@x.com", "10.2.2.2", t + i * 16 * 60_000);
    assert.equal(lockedMinutes("b@x.com", "10.2.2.3", t + 64 * 60_000), 0);
    for (let i = 0; i < 4; i++) recordFailure("c@x.com", `10.3.3.${i}`, t + i);
    recordSuccess("c@x.com");
    recordFailure("c@x.com", "10.3.3.9", t + 10);
    assert.equal(lockedMinutes("c@x.com", "10.3.3.8", t + 20), 0);
  });
});
