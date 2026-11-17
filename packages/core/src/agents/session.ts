import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { projectDataFolder } from "../results/run-store.js";

/**
 * One flow request and the fixes that follow it (AGT-17). It ends when the user saves or
 * discards the flow (AGT-18). Local data, kept with the instructions Jagra wrote for it.
 */
export interface AgentSession {
  /** Jagra's own id, also the folder name. */
  id: string;
  /** The agent in use when the session started: a known agent's id or a custom one. */
  agent: string;
  /** The agent's own session id, to continue it. Missing when the agent cannot continue. */
  agentSession?: string;
  scenario: string;
  /** The flow the session is about, inside `.jagra/flows` with `/`, once it is known. */
  flow?: string;
  startedAt: string;
}

const sessionSchema = z.object({
  id: z.string().min(1),
  agent: z.string().min(1),
  agentSession: z.string().min(1).optional(),
  scenario: z.string(),
  flow: z.string().min(1).optional(),
  startedAt: z.string(),
});

const SESSION_ID = /^[A-Za-z0-9-]{1,100}$/;

export function sessionsFolder(appData: string, projectId: string): string {
  return join(projectDataFolder(appData, projectId), "sessions");
}

/** The session's own folder: its record, the instructions and the agent's files (D-113). */
export function sessionFolder(
  appData: string,
  projectId: string,
  id: string,
): string {
  if (!SESSION_ID.test(id)) throw new Error(`not a session id: ${id}`);
  return join(sessionsFolder(appData, projectId), id);
}

/** The safety net's record and copies for a session (architecture.md section 4). */
export function backupFolder(appData: string, id: string): string {
  if (!SESSION_ID.test(id)) throw new Error(`not a session id: ${id}`);
  return join(appData, "backups", id);
}

export async function saveSession(
  appData: string,
  projectId: string,
  session: AgentSession,
): Promise<void> {
  const folder = sessionFolder(appData, projectId, session.id);
  await mkdir(folder, { recursive: true });
  const file = join(folder, "session.json");
  await writeFile(`${file}.tmp`, `${JSON.stringify(session, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

/** Undefined when the session ended or its record cannot be read. */
export async function loadSession(
  appData: string,
  projectId: string,
  id: string,
): Promise<AgentSession | undefined> {
  if (!SESSION_ID.test(id)) return undefined;
  try {
    const parsed = sessionSchema.safeParse(
      JSON.parse(
        await readFile(
          join(sessionFolder(appData, projectId, id), "session.json"),
          "utf8",
        ),
      ),
    );
    if (!parsed.success) return undefined;
    const { agentSession, flow, ...rest } = parsed.data;
    return {
      ...rest,
      ...(agentSession ? { agentSession } : {}),
      ...(flow ? { flow } : {}),
    };
  } catch {
    return undefined;
  }
}

/** The session ends when the user saves or discards the flow (AGT-18), and its backups go too. */
export async function endSession(
  appData: string,
  projectId: string,
  id: string,
): Promise<void> {
  if (!SESSION_ID.test(id)) return;
  await rm(sessionFolder(appData, projectId, id), {
    recursive: true,
    force: true,
  });
  await rm(backupFolder(appData, id), { recursive: true, force: true });
}
