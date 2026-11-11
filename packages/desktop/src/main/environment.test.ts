import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_TOOLS, installGuide } from "@jagra/core";
import { FakeToolProbe } from "@jagra/core/fakes";
import { describe, expect, it } from "vitest";
import { checkTools, knownLinks } from "./environment.js";

function allFound(): FakeToolProbe {
  const probe = new FakeToolProbe();
  probe.set("java", { found: true, path: "/jdk/bin/java", version: "17.0.12" });
  probe.set("adb", { found: true, path: "/sdk/adb", version: "37.0.0" });
  probe.set("maestro", {
    found: true,
    path: "/maestro/bin/maestro",
    version: "2.12.1",
  });
  probe.set("emulator", {
    found: true,
    path: "/sdk/emulator",
    version: "36.5.11.0",
  });
  probe.set("mockoon", {
    found: true,
    path: "/npm/mockoon-cli",
    version: "9.10.0",
  });
  return probe;
}

const clock = () => {
  let t = 1000;
  return () => (t += 250);
};

describe("checkTools (ENV-1, ENV-4)", () => {
  it("is ready when every tool is ready, and adds no instructions", async () => {
    const view = await checkTools({
      probe: allFound(),
      paths: {},
      platform: "win32",
      now: clock(),
    });
    expect(view.ready).toBe(true);
    expect(view.tools.every((t) => t.guide === undefined)).toBe(true);
    expect(view.tookMs).toBe(250);
  });

  it("is not ready when a required tool is missing, and adds that system's instructions", async () => {
    const probe = allFound();
    probe.set("maestro", { found: false });
    const view = await checkTools({
      probe,
      paths: {},
      platform: "win32",
      now: clock(),
    });
    expect(view.ready).toBe(false);
    const maestro = view.tools.find((t) => t.status.tool === "maestro");
    expect(maestro?.status.state).toBe("missing");
    expect(maestro?.guide?.steps.map((s) => s.id)).toContain(
      "maestro.windows.download-zip",
    );
  });

  it("stays ready when only an optional tool is missing", async () => {
    const probe = allFound();
    probe.set("mockoon", { found: false });
    const view = await checkTools({
      probe,
      paths: {},
      platform: "darwin",
      now: clock(),
    });
    expect(view.ready).toBe(true);
    expect(
      view.tools.find((t) => t.status.tool === "mockoon")?.guide,
    ).toBeDefined();
  });

  it("stays ready with an untested version, and still shows instructions for it (ENV-3)", async () => {
    const probe = allFound();
    probe.set("maestro", { found: true, path: "/m", version: "2.13.0" });
    const view = await checkTools({
      probe,
      paths: {},
      platform: "darwin",
      now: clock(),
    });
    expect(view.ready).toBe(true);
    const maestro = view.tools.find((t) => t.status.tool === "maestro");
    expect(maestro?.status.state).toBe("untested-version");
    expect(maestro?.guide?.steps.map((s) => s.id)).toContain(
      "maestro.macos.run-install-script",
    );
  });

  it("reports each tool as soon as it is known", async () => {
    const seen: string[] = [];
    await checkTools({
      probe: allFound(),
      paths: {},
      platform: "win32",
      now: clock(),
      onProgress: (s) => seen.push(s.tool),
    });
    expect(seen.sort()).toEqual([
      "adb",
      "emulator",
      "java",
      "maestro",
      "mockoon",
    ]);
  });
});

describe("knownLinks", () => {
  it("holds every link of the instructions on both systems, all over https", () => {
    const links = knownLinks();
    expect(links.has("https://adoptium.net/")).toBe(true);
    expect(links.size).toBeGreaterThan(3);
    for (const link of links) expect(link.startsWith("https://")).toBe(true);
  });
});

// The renderer turns step ids into text (LNG-1); its tests cannot load core's Node code.
describe("install step texts", () => {
  const locale = (language: string): unknown =>
    JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "..",
          "renderer",
          "src",
          "locales",
          `${language}.json`,
        ),
        "utf8",
      ),
    );
  const lookUp = (texts: unknown, key: string): unknown =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        texts,
      );

  it.each(["en", "id"])(
    "%s has a text for every step, on both systems",
    (language) => {
      const texts = locale(language);
      for (const platform of ["win32", "darwin"] as const) {
        for (const tool of ALL_TOOLS) {
          for (const step of installGuide(tool, platform).steps) {
            expect(typeof lookUp(texts, `install.${step.id}`), step.id).toBe(
              "string",
            );
          }
        }
      }
    },
  );

  // The renderer lays out the rows before the first result arrives, so it keeps its own copy.
  it("required tools match the renderer's REQUIRED_TOOLS", async () => {
    const view = await checkTools({
      probe: new FakeToolProbe(),
      paths: {},
      platform: "win32",
      now: clock(),
    });
    expect(view.tools.map((t) => t.status.tool)).toEqual([...ALL_TOOLS]);
    expect(
      view.tools.filter((t) => t.status.required).map((t) => t.status.tool),
    ).toEqual(["java", "adb", "maestro"]);
  });
});
