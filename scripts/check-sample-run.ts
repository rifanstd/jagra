// Checks a `jagra run` of the sample app in CI: exit code 1, and exactly one failed flow,
// save-item.yaml, from the planted bug (SMP-4). Exit code 1 alone would also pass a run where
// every flow failed for another reason.
//   node scripts/check-sample-run.ts <run.json> <exit code>
import { readFileSync } from "node:fs";

export interface SampleRun {
  status: string;
  flows: { file: string; status: string; failure?: string; reason?: string }[];
}

export const PLANTED_BUG_FLOW = "save-item.yaml";

/** Problems with the run, or an empty list when it is what the planted bug gives. */
export function sampleRunProblems(run: SampleRun, exitCode: number): string[] {
  const problems: string[] = [];
  if (exitCode !== 1) problems.push(`jagra run exited with ${exitCode}, not 1`);
  if (run.status !== "completed")
    problems.push(`the run ended ${run.status}, not completed`);
  for (const flow of run.flows) {
    const name = flow.file.split(/[\\/]/).at(-1) ?? flow.file;
    const expected = name === PLANTED_BUG_FLOW ? "failed" : "passed";
    if (flow.status !== expected) {
      const why = flow.reason ? ` (${flow.failure ?? ""}: ${flow.reason})` : "";
      problems.push(`${name} ${flow.status}, expected ${expected}${why}`);
    }
  }
  if (!run.flows.some((f) => f.file.endsWith(PLANTED_BUG_FLOW))) {
    problems.push(`${PLANTED_BUG_FLOW} did not run`);
  }
  return problems;
}

if (import.meta.main) {
  const [file, code] = process.argv.slice(2);
  if (file === undefined || code === undefined) {
    console.error(
      "usage: node scripts/check-sample-run.ts <run.json> <exit code>",
    );
    process.exit(2);
  }
  const problems = sampleRunProblems(
    JSON.parse(readFileSync(file, "utf8")) as SampleRun,
    Number(code),
  );
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log("The sample run failed only on the planted bug.");
}
