import { parseArgs } from "node:util";
import { EXIT, runCommand, type RunDeps } from "./run.js";
import { USAGE } from "./text.js";

/** Parses the command line and runs the command. Returns the exit code (CLI-4). */
export async function main(
  argv: readonly string[],
  deps: RunDeps,
  version: string,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        device: { type: "string" },
        apk: { type: "string" },
        output: { type: "string" },
        help: { type: "boolean" },
        version: { type: "boolean" },
      },
    });
  } catch (e) {
    deps.out(`${(e as Error).message}\n\n${USAGE}`);
    return EXIT.notRun;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    deps.out(version);
    return EXIT.passed;
  }
  const [command, folder, ...extra] = positionals;
  if (values.help || command === undefined) {
    deps.out(USAGE);
    return values.help ? EXIT.passed : EXIT.notRun;
  }
  if (command !== "run" || extra.length > 0) {
    deps.out(`Unknown command: ${[command, ...extra].join(" ")}\n\n${USAGE}`);
    return EXIT.notRun;
  }
  return runCommand(
    { folder, device: values.device, apk: values.apk, output: values.output },
    deps,
  );
}
