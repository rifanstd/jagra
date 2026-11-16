import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Document } from "yaml";
import { fail, ok, type Result } from "../errors/index.js";
import { flowsFolder } from "./flows.js";

/**
 * FLOW-4: the file name for a flow name, in lowercase with spaces turned into hyphens
 * (`Login wrong password` gives `login-wrong-password.yaml`). Accents are dropped and anything
 * that is not a letter, a digit or a hyphen is left out, so the name is safe on every system.
 */
export function flowFileName(name: string): string | undefined {
  const stem = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return stem === "" ? undefined : `${stem}.yaml`;
}

/** The FLOW-4 template, with the values written as YAML so any name is safe. */
export function flowTemplate(appId: string, name: string): string {
  const header = new Document({
    appId,
    name,
    properties: { condition: "success" },
  });
  return `${header.toString()}---\n- launchApp:\n    clearState: true\n# Write the steps of this test below.\n`;
}

/**
 * FLOW-4: creates a flow in `.jagra/flows` from the template, never over an existing file.
 * It writes nothing outside `.jagra` (PRJ-11).
 */
export async function createFlow(
  projectFolder: string,
  name: string,
  appId: string,
): Promise<Result<{ file: string }>> {
  const fileName = flowFileName(name);
  if (!fileName) return fail({ code: "FLOW_NAME_INVALID", name });
  const folder = flowsFolder(projectFolder);
  const file = join(folder, fileName);
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(file, flowTemplate(appId, name.trim()), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    return error.code === "EEXIST"
      ? fail({ code: "FLOW_EXISTS", file: fileName })
      : fail({ code: "PROJECT_SETUP_FAILED", folder, detail: error.message });
  }
  return ok({ file });
}
