import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fail, ok, type Result } from "../errors/index.js";
import type { PortChecker } from "../ports/port-checker.js";
import type { ProjectConfig } from "../project/config.js";

export interface ProjectMockoon {
  /** Full path of the Mockoon file. */
  file: string;
  port: number;
}

/**
 * The project's Mockoon file and port, checked before a run (spec section 7, step 1). The port
 * comes from `config.yaml`, or else from the Mockoon file. The file is only read (MCK-1).
 * Undefined when the project does not use Mockoon.
 */
export async function projectMockoon(
  projectFolder: string,
  config: ProjectConfig,
  ports: PortChecker,
): Promise<Result<ProjectMockoon | undefined>> {
  if (config.mockoon === undefined) return ok(undefined);
  const file = resolve(projectFolder, config.mockoon.file);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT"
      ? fail({ code: "FILE_NOT_FOUND", file })
      : fail({ code: "FILE_READ_FAILED", file, detail: (e as Error).message });
  }

  let port = config.mockoon.port;
  if (port === undefined) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return fail({
        code: "MOCKOON_FILE_INVALID",
        file,
        detail: (e as Error).message,
      });
    }
    const filePort = (data as { port?: unknown } | null)?.port;
    if (
      typeof filePort !== "number" ||
      !Number.isInteger(filePort) ||
      filePort < 1 ||
      filePort > 65535
    ) {
      return fail({ code: "MOCKOON_PORT_MISSING", file });
    }
    port = filePort;
  }

  if (!(await ports.isFree(port)))
    return fail({ code: "MOCKOON_PORT_BUSY", port });
  return ok({ file, port });
}
