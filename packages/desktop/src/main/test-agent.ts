import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  fail,
  ok,
  type AgentClient,
  type AgentReply,
  type AgentRequest,
  type Result,
} from "@jagra/core";

/**
 * The agent in test mode (D-81), so the AI screens can be tested without a real agent. It takes
 * `JAGRA_TEST_AGENT_MS` (300 by default), writes the flow the instructions ask for, or
 * `ai-flow.yaml`, and reports it. `JAGRA_TEST_AGENT_OUTSIDE` names a file outside
 * `.jagra/flows` it also changes, `JAGRA_TEST_AGENT_OTHER` another flow it changes, and
 * `JAGRA_TEST_AGENT_ERROR=failed` makes it fail. It stops at once when cancelled.
 */
export class TestAgentClient implements AgentClient {
  constructor(private readonly env: NodeJS.ProcessEnv) {}

  start(request: AgentRequest): Promise<Result<AgentReply>> {
    return this.work(request, "test-session");
  }

  continue(
    sessionId: string,
    request: AgentRequest,
  ): Promise<Result<AgentReply>> {
    return this.work(request, sessionId);
  }

  private async work(
    request: AgentRequest,
    sessionId: string,
  ): Promise<Result<AgentReply>> {
    try {
      await sleep(Number(this.env.JAGRA_TEST_AGENT_MS ?? "300"), undefined, {
        signal: request.signal,
      });
    } catch {
      return fail({ code: "AGENT_CANCELLED", agent: "Test agent" });
    }
    if (this.env.JAGRA_TEST_AGENT_ERROR === "failed") {
      return fail({
        code: "AGENT_FAILED",
        agent: "Test agent",
        detail: "test failure",
      });
    }
    const instructions = await readFile(request.instructionsFile, "utf8");
    const file =
      /Write the flow to `\.jagra\/flows\/([^`]+)`/.exec(instructions)?.[1] ??
      /Fix the flow \.jagra\/flows\/(\S+\.ya?ml)/.exec(instructions)?.[1] ??
      "ai-flow.yaml";
    const appId =
      /The app's `appId` is `([^`]*)`/.exec(instructions)?.[1] ??
      "dev.jagra.sample";
    await write(
      join(request.folder, ".jagra", "flows", file),
      `appId: ${appId}\nname: Written by the test agent\nproperties:\n  condition: success\n---\n- launchApp:\n    clearState: true\n- tapOn: "Username"\n- assertVisible: "Stock"\n`,
    );
    if (this.env.JAGRA_TEST_AGENT_OUTSIDE) {
      await write(
        join(request.folder, ...this.env.JAGRA_TEST_AGENT_OUTSIDE.split("/")),
        "changed by the test agent\n",
      );
    }
    if (this.env.JAGRA_TEST_AGENT_OTHER) {
      await write(
        join(
          request.folder,
          ".jagra",
          "flows",
          this.env.JAGRA_TEST_AGENT_OTHER,
        ),
        `appId: ${appId}\n---\n- launchApp\n`,
      );
    }
    return ok({
      sessionId,
      finalMessage: `I wrote the flow.\n${JSON.stringify({
        flow: `.jagra/flows/${file}`,
        checks: "The item list shows after logging in.",
        possibleBug: null,
        suggestedTests: ["Log in with an empty password"],
      })}`,
    });
  }
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
