import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlow } from "./flow.js";

const FOLDER = resolve("/repo/.jagra/flows");
const FILE = join(FOLDER, "login-wrong-password.yaml");
const parse = (text: string) => parseFlow(text, FILE, false);
const codes = (text: string) => parse(text).problems.map((p) => p.code);

describe("parseFlow", () => {
  it("reads the example from the spec (FLOW-2)", () => {
    const flow = parse(`appId: com.company.appa
name: Login with wrong password
properties:
  condition: success
---
- launchApp:
    clearState: true
- runFlow: parts/open-login.yaml
- tapOn: "Password"
- inputText: \${WRONG_PASSWORD}
- tapOn: "Sign In"
- assertVisible: "Wrong password"
`);
    expect(flow.problems).toEqual([]);
    expect(flow.appId).toBe("com.company.appa");
    expect(flow.name).toBe("Login with wrong password");
    expect(flow.properties).toEqual({ condition: "success" });
    expect(flow.variables).toEqual(["WRONG_PASSWORD"]);
    expect(flow.calls).toEqual([
      { file: join(FOLDER, "parts", "open-login.yaml"), passes: [], line: 8 },
    ]);
    expect(flow.steps).toEqual([
      {
        kind: "action",
        command: "launchApp",
        args: { clearState: true },
        line: 6,
      },
      {
        kind: "action",
        command: "runFlow",
        args: "parts/open-login.yaml",
        line: 8,
      },
      { kind: "action", command: "tapOn", args: "Password", line: 9 },
      {
        kind: "action",
        command: "inputText",
        args: "${WRONG_PASSWORD}",
        line: 10,
      },
      { kind: "action", command: "tapOn", args: "Sign In", line: 11 },
      {
        kind: "check",
        command: "assertVisible",
        args: "Wrong password",
        line: 12,
      },
    ]);
  });

  it("uses the file name when the header has no name (FLOW-2)", () => {
    expect(parse("appId: a\n---\n- back\n").name).toBe("login-wrong-password");
  });

  it("reads a command written without a value", () => {
    expect(parse("appId: a\n---\n- back\n- hideKeyboard\n").steps).toEqual([
      { kind: "action", command: "back", args: null, line: 3 },
      { kind: "action", command: "hideKeyboard", args: null, line: 4 },
    ]);
  });

  it("marks every assertion Maestro has as a check", () => {
    const flow = parse(`appId: a
---
- assertVisible: x
- assertNotVisible: x
- assertTrue: \${output.ok}
- assertScreenshot: home
- assertDarkMode
- assertLightMode
- extendedWaitUntil:
    visible: x
`);
    expect(flow.steps.map((s) => s.kind)).toEqual([
      "check",
      "check",
      "check",
      "check",
      "check",
      "check",
      "action",
    ]);
  });

  it("keeps nested commands under runFlow, repeat and retry", () => {
    const flow = parse(`appId: a
---
- runFlow:
    when:
      visible: Allow notifications
    commands:
      - tapOn: Allow
      - assertNotVisible: Allow notifications
- repeat:
    times: 2
    commands:
      - scroll
- retry:
    maxRetries: 2
    commands:
      - tapOn: Retry
`);
    expect(flow.problems).toEqual([]);
    expect(
      flow.steps.map((s) => [
        s.command,
        s.steps?.map((n) => [n.kind, n.command, n.line]),
      ]),
    ).toEqual([
      [
        "runFlow",
        [
          ["action", "tapOn", 7],
          ["check", "assertNotVisible", 8],
        ],
      ],
      ["repeat", [["action", "scroll", 12]]],
      ["retry", [["action", "tapOn", 16]]],
    ]);
  });

  it("records helper calls with the variables they pass", () => {
    const flow = parse(`appId: a
---
- runFlow:
    file: parts/login.yaml
    env:
      USERNAME: demo
- retry:
    file: ../shared/wait.yaml
`);
    expect(flow.calls).toEqual([
      {
        file: join(FOLDER, "parts", "login.yaml"),
        passes: ["USERNAME"],
        line: 3,
      },
      { file: resolve(FOLDER, "../shared/wait.yaml"), passes: [], line: 7 },
    ]);
  });

  it("turns properties into text, as Maestro reads them", () => {
    expect(
      parse(
        "appId: a\nproperties:\n  priority: 1\n  smoke: true\n---\n- back\n",
      ).properties,
    ).toEqual({ priority: "1", smoke: "true" });
  });

  describe("variables (RUN-10)", () => {
    it("finds every ${NAME}, in the header, hooks and nested commands", () => {
      const flow = parse(`appId: a
env:
  GREETING: Hello \${USERNAME}
onFlowStart:
  - inputText: \${SETUP_TOKEN}
---
- inputText: \${ PASSWORD }
- runFlow:
    commands:
      - inputText: "\${OTP}"
- inputText: \${PASSWORD}
`);
      expect(flow.variables).toEqual([
        "OTP",
        "PASSWORD",
        "SETUP_TOKEN",
        "USERNAME",
      ]);
    });

    it("leaves out names the flow defines, Maestro's own names and JavaScript", () => {
      const flow = parse(`appId: a
env:
  COUNTRY: ID
---
- inputText: \${COUNTRY}
- inputText: \${MAESTRO_FILENAME}
- inputText: \${output.token}
- inputText: \${maestro.copiedText}
- inputText: \${USER || "guest"}
- inputText: $NOT_A_VARIABLE
`);
      expect(flow.variables).toEqual([]);
    });
  });

  describe("problems (FLOW-6)", () => {
    it("broken YAML, with its line", () => {
      const flow = parse("appId: a\n---\n- tapOn: [unclosed\n- back: : x\n");
      expect(flow.problems[0]).toMatchObject({
        code: "FLOW_YAML_INVALID",
        file: FILE,
      });
      expect(flow.problems[0]).toHaveProperty("line");
    });

    it("an empty file", () => {
      expect(codes("")).toEqual(["FLOW_HEADER_MISSING"]);
    });

    it("a header with no --- and no steps", () => {
      expect(codes("appId: a\n")).toEqual(["FLOW_HEADER_MISSING"]);
    });

    it("steps with no header", () => {
      expect(codes("- launchApp\n- back\n")).toEqual(["FLOW_HEADER_MISSING"]);
    });

    it("a second ---", () => {
      expect(parse("appId: a\n---\n- back\n---\n- back\n").problems).toEqual([
        { code: "FLOW_TOO_MANY_DOCUMENTS", file: FILE, line: 5 },
      ]);
    });

    it("a header that is not a map", () => {
      expect(codes("- appId: a\n---\n- back\n")).toEqual([
        "FLOW_HEADER_NOT_A_MAP",
      ]);
    });

    it("a missing appId, while still reading the steps", () => {
      const flow = parse("name: x\n---\n- back\n");
      expect(flow.problems).toEqual([
        { code: "FLOW_APP_ID_MISSING", file: FILE, line: 1 },
      ]);
      expect(flow.steps).toHaveLength(1);
    });

    it("properties that are not a map of values", () => {
      expect(
        parse("appId: a\nproperties:\n  - x\n---\n- back\n").problems,
      ).toEqual([{ code: "FLOW_PROPERTIES_INVALID", file: FILE, line: 3 }]);
    });

    it("no steps after ---", () => {
      expect(codes("appId: a\n---\n")).toEqual(["FLOW_STEPS_MISSING"]);
      expect(codes("appId: a\n---\n[]\n")).toEqual(["FLOW_STEPS_MISSING"]);
      expect(codes("appId: a\n---\ntapOn: x\n")).toEqual([
        "FLOW_STEPS_MISSING",
      ]);
    });

    it("a step that is not one command", () => {
      expect(
        parse("appId: a\n---\n- back\n- tapOn: x\n  inputText: y\n- 42\n")
          .problems,
      ).toEqual([
        { code: "FLOW_STEP_INVALID", file: FILE, line: 4 },
        { code: "FLOW_STEP_INVALID", file: FILE, line: 6 },
      ]);
    });

    it("a duplicate key", () => {
      expect(codes("appId: a\nappId: b\n---\n- back\n")).toEqual([
        "FLOW_YAML_INVALID",
      ]);
    });
  });

  describe("AI commands (FLOW-10)", () => {
    it("reports every command that hands a result to an AI model, nested ones too", () => {
      const flow = parse(`appId: a
---
- assertWithAI:
    assertion: The login screen is shown
- runFlow:
    commands:
      - assertNoDefectsWithAI
      - extractTextWithAI:
          query: the order number
`);
      expect(flow.problems).toEqual([
        {
          code: "FLOW_AI_COMMAND",
          file: FILE,
          line: 3,
          command: "assertWithAI",
        },
        {
          code: "FLOW_AI_COMMAND",
          file: FILE,
          line: 7,
          command: "assertNoDefectsWithAI",
        },
        {
          code: "FLOW_AI_COMMAND",
          file: FILE,
          line: 8,
          command: "extractTextWithAI",
        },
      ]);
    });

    it("reports them in hooks", () => {
      expect(
        codes("appId: a\nonFlowStart:\n  - assertWithAI: x\n---\n- back\n"),
      ).toEqual(["FLOW_AI_COMMAND"]);
    });
  });
});
