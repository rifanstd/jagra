import { describe, expect, it } from "vitest";
import { formatAgo, formatWhen } from "./format";

// Wednesday 11 November 2026, 18:39 local time.
const now = new Date(2026, 10, 11, 18, 39).getTime();
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 10, day, hour, minute).getTime();

describe("formatWhen", () => {
  it.each([
    ["en", at(11, 18, 39), /^Today, 0?6:39\sPM$|^Today, 18:39$/],
    ["id", at(11, 18, 39), /^Hari ini, 18\.39$/],
    ["en", at(10, 16, 5), /^Yesterday, /],
    ["id", at(10, 16, 5), /^Kemarin, 16\.05$/],
    ["en", at(9, 10, 12), /^Monday, /],
    ["id", at(9, 10, 12), /^Senin, 10\.12$/],
    ["en", at(1, 9, 0), /2026, /],
  ])("%s %s", (language, when, expected) => {
    expect(formatWhen(when, now, language)).toMatch(expected);
  });
});

describe("formatAgo (PRJ-5)", () => {
  it.each([
    [now - 20_000, "en", "this minute"],
    [now - 12 * 60_000, "en", "12 minutes ago"],
    [now - 12 * 60_000, "id", "12 menit yang lalu"],
    [now - 3 * 3_600_000, "en", "3 hours ago"],
    [now - 2 * 86_400_000, "en", "2 days ago"],
  ])("%s in %s", (when, language, expected) => {
    expect(formatAgo(when, now, language)).toBe(expected);
  });
});
