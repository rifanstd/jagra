// Commands arrive in M5 (CLI-1). Until then nothing can run, which CLI-4 reports as exit code 2.
export function main(writeError: (line: string) => void): number {
  writeError("jagra is not ready yet: no commands are available.");
  return 2;
}
