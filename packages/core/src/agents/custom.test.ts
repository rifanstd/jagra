import { describe, expect, it } from "vitest";
import { fillCommand, readCustomAgent, splitCommand } from "./custom.js";

describe("splitCommand (D-21)", () => {
  it("splits on spaces and keeps quoted parts whole", () => {
    expect(
      splitCommand(
        `"C:\\Program Files\\Agent\\agent.exe" run --file {instructions} --name 'my agent'`,
      ),
    ).toEqual({
      ok: true,
      value: [
        "C:\\Program Files\\Agent\\agent.exe",
        "run",
        "--file",
        "{instructions}",
        "--name",
        "my agent",
      ],
    });
  });

  it("keeps shell characters as plain text", () => {
    expect(splitCommand("agent ; rm -rf ~ && echo $HOME | x")).toEqual({
      ok: true,
      value: ["agent", ";", "rm", "-rf", "~", "&&", "echo", "$HOME", "|", "x"],
    });
  });

  it("keeps an empty quoted argument", () => {
    expect(splitCommand(`agent "" x`)).toEqual({
      ok: true,
      value: ["agent", "", "x"],
    });
  });

  it("refuses an empty command and an unclosed quote", () => {
    expect(splitCommand("   ")).toEqual({
      ok: false,
      error: { code: "AGENT_COMMAND_EMPTY" },
    });
    expect(splitCommand(`agent "unclosed`)).toEqual({
      ok: false,
      error: { code: "AGENT_COMMAND_QUOTE" },
    });
    expect(splitCommand(`"" run`)).toEqual({
      ok: false,
      error: { code: "AGENT_COMMAND_EMPTY" },
    });
  });
});

describe("readCustomAgent (AGT-2, AGT-3, D-108)", () => {
  it("reads an ACP agent", () => {
    expect(
      readCustomAgent(
        { name: " Kiro ", protocol: "acp", command: "kiro acp" },
        "c1",
      ),
    ).toEqual({
      ok: true,
      value: {
        id: "c1",
        name: "Kiro",
        protocol: "acp",
        command: ["kiro", "acp"],
      },
    });
  });

  it("reads a command agent with and without a continue command", () => {
    expect(
      readCustomAgent(
        {
          name: "Aider",
          protocol: "cli",
          start: "aider --message-file {instructions}",
          continue: "  ",
        },
        "c2",
      ),
    ).toEqual({
      ok: true,
      value: {
        id: "c2",
        name: "Aider",
        protocol: "cli",
        start: ["aider", "--message-file", "{instructions}"],
      },
    });
    expect(
      readCustomAgent(
        {
          name: "Aider",
          protocol: "cli",
          start: "aider --id {session} --file={instructions}",
          continue: "aider --resume {session} --file={instructions}",
        },
        "c3",
      ),
    ).toMatchObject({
      ok: true,
      value: {
        continue: ["aider", "--resume", "{session}", "--file={instructions}"],
      },
    });
  });

  it("asks for the placeholders each command needs", () => {
    expect(
      readCustomAgent({ name: "A", protocol: "cli", start: "agent go" }, "c"),
    ).toEqual({
      ok: false,
      error: { code: "AGENT_COMMAND_NEEDS", placeholder: "{instructions}" },
    });
    expect(
      readCustomAgent(
        {
          name: "A",
          protocol: "cli",
          start: "agent {instructions}",
          continue: "agent {instructions}",
        },
        "c",
      ),
    ).toEqual({
      ok: false,
      error: { code: "AGENT_COMMAND_NEEDS", placeholder: "{session}" },
    });
    // The program itself does not count.
    expect(
      readCustomAgent(
        { name: "A", protocol: "cli", start: "{instructions}" },
        "c",
      ),
    ).toMatchObject({ ok: false });
  });
});

describe("fillCommand (D-21)", () => {
  it("fills placeholders inside single arguments, whatever the values hold", () => {
    const evil = `C:\\data\\"; rm -rf ~ & calc.exe`;
    expect(
      fillCommand(["agent", "--file={instructions}", "{session}", "{x}"], {
        instructions: evil,
        session: "id-1",
      }),
    ).toEqual(["agent", `--file=${evil}`, "id-1", "{x}"]);
  });

  it("never fills the program", () => {
    expect(
      fillCommand(["{instructions}", "a"], { instructions: "x", session: "s" }),
    ).toEqual(["{instructions}", "a"]);
  });
});
