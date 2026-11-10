/** Looks at and stops processes Jagra did not start in this session (REL-2). */
export interface ProcessControl {
  isAlive(pid: number): boolean;
  /** The processes listening on a local TCP port. Empty when it cannot tell. */
  listeningPids(port: number): Promise<number[]>;
  /** Stops a process and the processes it started. */
  kill(pid: number): Promise<void>;
}
