import type { ToolStatus } from "@jagra/core/types";
import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { blockingTool, guideShown, TOOL_ORDER, toolLook } from "./environment";
import { resources } from "./i18n";

const status = (over: Partial<ToolStatus>): ToolStatus => ({
  tool: "maestro",
  required: true,
  state: "ready",
  ...over,
});

describe("toolLook (ENV-2)", () => {
  it.each([
    [status({ state: "ready" }), "passed", "env.state.ready"],
    [
      status({ state: "untested-version" }),
      "warning",
      "env.state.untested-version",
    ],
    [status({ state: "too-old" }), "failed", "env.state.too-old"],
    [status({ state: "cant-start" }), "failed", "env.state.cant-start"],
    [status({ state: "missing" }), "failed", "env.state.missing"],
    [
      status({ tool: "mockoon", required: false, state: "missing" }),
      "optional",
      "env.state.missing-optional",
    ],
    [undefined, "running", "env.state.checking"],
  ])("%j looks %s", (value, tone, label) => {
    expect(toolLook(value)).toEqual({ tone, label });
  });
});

describe("guideShown (ENV-4)", () => {
  it("opens the instructions for what stops a run, and folds the rest", () => {
    expect(guideShown(status({ state: "missing" }))).toBe("open");
    expect(guideShown(status({ state: "too-old" }))).toBe("open");
    expect(
      guideShown(
        status({ tool: "mockoon", required: false, state: "cant-start" }),
      ),
    ).toBe("open");
    expect(
      guideShown(
        status({ tool: "mockoon", required: false, state: "missing" }),
      ),
    ).toBe("closed");
    expect(guideShown(status({ state: "untested-version" }))).toBe("closed");
    expect(guideShown(status({ state: "ready" }))).toBe("none");
  });
});

describe("blockingTool (ENV-7)", () => {
  it("names the first required tool that stops runs, never an optional one", () => {
    const view = (statuses: ToolStatus[]) => ({
      tools: statuses.map((s) => ({ status: s })),
      ready: false,
      tookMs: 0,
    });
    expect(
      blockingTool(
        view([
          status({ tool: "mockoon", required: false, state: "missing" }),
          status({ tool: "java", state: "untested-version" }),
          status({ tool: "maestro", state: "missing" }),
        ]),
      )?.tool,
    ).toBe("maestro");
    expect(
      blockingTool(
        view([status({ tool: "mockoon", required: false, state: "missing" })]),
      ),
    ).toBeUndefined();
  });
});

describe("environment texts (LNG-1)", () => {
  beforeAll(async () => {
    await i18next.init({ resources, lng: "en", fallbackLng: false });
  });

  const has = (language: "en" | "id", key: string) =>
    i18next.exists(key, { lng: language, fallbackLng: false });

  it.each(["en", "id"] as const)(
    "%s names every tool and every reason",
    (lng) => {
      for (const tool of TOOL_ORDER) {
        for (const part of ["name", "title", "why"]) {
          expect(has(lng, `env.tool.${tool}.${part}`), `${tool}.${part}`).toBe(
            true,
          );
        }
      }
      for (const problem of [
        "needs-java",
        "needs-node",
        "timed-out",
        "failed",
      ]) {
        expect(has(lng, `env.problem.${problem}`), problem).toBe(true);
      }
    },
  );
});
