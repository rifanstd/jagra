import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakePortChecker } from "../fakes/mockoon.js";
import { parseConfig } from "../project/config.js";
import { mockoonSettings, projectMockoon } from "./project.js";

let project: string;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "jagra-mockoon-"));
  await mkdir(join(project, ".jagra"));
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

const config = (yaml: string) => {
  const parsed = parseConfig(`format: 1\n${yaml}`, "config.yaml", "p");
  if (!parsed.ok) throw new Error("bad config");
  return parsed.value;
};
const MOCKOON_FILE = () => join(project, ".jagra", "mockoon.json");

describe("projectMockoon (MCK-1, MCK-3)", () => {
  it("is undefined for a project without a mockoon block", async () => {
    expect(
      await projectMockoon(project, config(""), new FakePortChecker()),
    ).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("takes the port from config.yaml first", async () => {
    await writeFile(MOCKOON_FILE(), JSON.stringify({ port: 3001 }));
    const result = await projectMockoon(
      project,
      config("mockoon:\n  file: .jagra/mockoon.json\n  port: 4000\n"),
      new FakePortChecker(),
    );
    expect(result).toEqual({
      ok: true,
      value: { file: MOCKOON_FILE(), port: 4000 },
    });
  });

  it("else from the Mockoon file, which it never changes", async () => {
    const text = JSON.stringify({ uuid: "x", port: 3001, hostname: "0.0.0.0" });
    await writeFile(MOCKOON_FILE(), text);
    const result = await projectMockoon(
      project,
      config("mockoon:\n  file: .jagra/mockoon.json\n"),
      new FakePortChecker(),
    );
    expect(result).toEqual({
      ok: true,
      value: { file: MOCKOON_FILE(), port: 3001 },
    });
    expect(await readFile(MOCKOON_FILE(), "utf8")).toBe(text);
  });

  it("refuses a busy port and names it", async () => {
    await writeFile(MOCKOON_FILE(), JSON.stringify({ port: 3000 }));
    const ports = new FakePortChecker();
    ports.busy.add(3000);
    expect(
      await projectMockoon(
        project,
        config("mockoon:\n  file: .jagra/mockoon.json\n"),
        ports,
      ),
    ).toEqual({ ok: false, error: { code: "MOCKOON_PORT_BUSY", port: 3000 } });
  });

  it("gives the file and port for the project page without checking the port", async () => {
    await writeFile(MOCKOON_FILE(), JSON.stringify({ port: 3000 }));
    expect(
      await mockoonSettings(
        project,
        config("mockoon:\n  file: .jagra/mockoon.json\n"),
      ),
    ).toEqual({ ok: true, value: { file: MOCKOON_FILE(), port: 3000 } });
  });

  it("reports a missing file, a broken file and a file without a port", async () => {
    const block = config("mockoon:\n  file: .jagra/mockoon.json\n");
    const check = () => projectMockoon(project, block, new FakePortChecker());
    expect(await check()).toEqual({
      ok: false,
      error: { code: "FILE_NOT_FOUND", file: MOCKOON_FILE() },
    });
    await writeFile(MOCKOON_FILE(), "{ broken");
    const broken = await check();
    expect(broken.ok ? undefined : broken.error.code).toBe(
      "MOCKOON_FILE_INVALID",
    );
    await writeFile(MOCKOON_FILE(), JSON.stringify({ name: "no port" }));
    expect(await check()).toEqual({
      ok: false,
      error: { code: "MOCKOON_PORT_MISSING", file: MOCKOON_FILE() },
    });
  });
});
