import { describe, expect, it } from "vitest";
import { FakeToolFiles } from "../../fakes/tool-files.js";
import type { Machine } from "../tools/locate.js";
import { agentLaunch, findAgents } from "./find.js";

const NPM = "C:\\Users\\me\\AppData\\Roaming\\npm";

// As npm 10 writes them on Windows (read on 2026-11-16).
const EXE_SHIM = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n`;
const NODE_SHIM = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`;

function windows(files: FakeToolFiles): Machine {
  return {
    platform: "win32",
    env: { Path: `C:\\Users\\me\\.local\\bin;${NPM};C:\\nodejs` },
    home: "C:\\Users\\me",
    files,
  };
}

describe("findAgents (AGT-1)", () => {
  it("finds a .exe and an npm shim on PATH, and reports the rest as missing", () => {
    const files = new FakeToolFiles()
      .file("C:\\Users\\me\\.local\\bin\\claude.exe")
      .file(`${NPM}\\opencode.cmd`, EXE_SHIM)
      .file(`${NPM}\\opencode`, "#!/bin/sh");
    expect(findAgents(windows(files))).toEqual([
      { id: "claude-code", path: "C:\\Users\\me\\.local\\bin\\claude.exe" },
      { id: "codex" },
      { id: "gemini" },
      { id: "opencode", path: `${NPM}\\opencode.cmd` },
      { id: "omp" },
    ]);
  });

  it("looks in ~/.local/bin on macOS, where Claude Code installs itself", () => {
    const files = new FakeToolFiles().file("/Users/me/.local/bin/claude");
    const found = findAgents({
      platform: "darwin",
      env: { PATH: "/usr/bin" },
      home: "/Users/me",
      files,
    });
    expect(found[0]).toEqual({
      id: "claude-code",
      path: "/Users/me/.local/bin/claude",
    });
  });
});

describe("agentLaunch (D-104)", () => {
  it("starts a .exe as it is", () => {
    const machine = windows(new FakeToolFiles());
    expect(agentLaunch("C:\\a\\claude.exe", ["-p"], machine)).toEqual({
      ok: true,
      spec: { program: "C:\\a\\claude.exe", args: ["-p"] },
    });
  });

  it("starts the .exe an npm shim points to", () => {
    const exe = `${NPM}\\node_modules\\opencode-ai\\bin\\opencode.exe`;
    const files = new FakeToolFiles()
      .file(`${NPM}\\opencode.cmd`, EXE_SHIM)
      .file(exe);
    expect(
      agentLaunch(`${NPM}\\opencode.cmd`, ["acp"], windows(files)),
    ).toEqual({ ok: true, spec: { program: exe, args: ["acp"] } });
  });

  it("starts the .js file an npm shim points to with Node, preferring the one beside it", () => {
    const script = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`;
    const files = new FakeToolFiles()
      .file(`${NPM}\\codex.cmd`, NODE_SHIM)
      .file(script)
      .file("C:\\nodejs\\node.exe");
    expect(agentLaunch(`${NPM}\\codex.cmd`, ["exec"], windows(files))).toEqual({
      ok: true,
      spec: { program: "C:\\nodejs\\node.exe", args: [script, "exec"] },
    });
    files.file(`${NPM}\\node.exe`);
    expect(agentLaunch(`${NPM}\\codex.cmd`, ["exec"], windows(files))).toEqual({
      ok: true,
      spec: { program: `${NPM}\\node.exe`, args: [script, "exec"] },
    });
  });

  it("refuses a shim it cannot read, and any other script", () => {
    const files = new FakeToolFiles().file(
      `${NPM}\\odd.cmd`,
      "@echo off\r\ncall something.bat %*\r\n",
    );
    expect(agentLaunch(`${NPM}\\odd.cmd`, [], windows(files)).ok).toBe(false);
    expect(agentLaunch("C:\\a\\agent.bat", [], windows(files)).ok).toBe(false);
  });

  it("starts the program directly on macOS", () => {
    expect(
      agentLaunch("/opt/homebrew/bin/gemini", ["--acp"], {
        platform: "darwin",
        env: {},
        home: "/Users/me",
        files: new FakeToolFiles(),
      }),
    ).toEqual({
      ok: true,
      spec: { program: "/opt/homebrew/bin/gemini", args: ["--acp"] },
    });
  });
});
