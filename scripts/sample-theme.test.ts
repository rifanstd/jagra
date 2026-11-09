import { describe, expect, it } from "vitest";
import { oklchToHex, readBlock, tokensKotlin } from "./sample-theme.ts";

describe("oklchToHex", () => {
  it("matches the sRGB primaries and the ends of the scale", () => {
    expect(oklchToHex("oklch(1 0 0)")).toBe("#FFFFFF");
    expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
    expect(oklchToHex("oklch(0.62796 0.25768 29.2339)")).toBe("#FF0000");
    expect(oklchToHex("oklch(0.86644 0.29483 142.4953)")).toBe("#00FF00");
    expect(oklchToHex("oklch(0.45201 0.31321 264.052)")).toBe("#0000FF");
  });

  it("clips colors outside sRGB instead of wrapping", () => {
    expect(oklchToHex("oklch(0.7 0.4 145)")).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("refuses anything that is not oklch()", () => {
    expect(() => oklchToHex("#1a1a1a")).toThrow("not an oklch() color");
  });
});

const CSS = `
:root {
  --background: oklch(1.0000 0 0);
  --card-foreground: oklch(0 0 0);
  --radius: 0.5rem;
  --font-sans: Outfit, sans-serif;
}

.dark {
  --background: oklch(0 0 0);
  --card-foreground: oklch(1.0000 0 0);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}
`;

describe("readBlock", () => {
  it("reads one rule's custom properties", () => {
    expect(readBlock(CSS, ".dark")).toEqual(
      new Map([
        ["background", "oklch(0 0 0)"],
        ["card-foreground", "oklch(1.0000 0 0)"],
      ]),
    );
  });
});

describe("tokensKotlin", () => {
  it("writes each color for light and dark, and the radius scale in dp", () => {
    const kotlin = tokensKotlin(CSS);
    expect(kotlin).toContain("    val cardForeground: Color,");
    expect(kotlin).toContain(
      "internal val LightTokens = Tokens(\n    background = Color(0xFFFFFFFF),\n    cardForeground = Color(0xFF000000),\n)",
    );
    expect(kotlin).toContain(
      "internal val DarkTokens = Tokens(\n    background = Color(0xFF000000),\n    cardForeground = Color(0xFFFFFFFF),\n)",
    );
    expect(kotlin).toContain("internal val RadiusSm = 4.dp");
    expect(kotlin).toContain("internal val RadiusLg = 8.dp");
    expect(kotlin).toContain("internal val RadiusXl = 12.dp");
    expect(kotlin).not.toContain("fontSans");
  });

  it("fails when dark mode lacks a color that light mode has", () => {
    expect(() =>
      tokensKotlin(CSS.replace("--card-foreground: oklch(1.0000 0 0);", "")),
    ).toThrow(".dark has no --card-foreground");
  });
});
