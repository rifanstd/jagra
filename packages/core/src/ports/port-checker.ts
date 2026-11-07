/** Tells whether a local port is free (MCK-3). */
export interface PortChecker {
  isFree(port: number): Promise<boolean>;
}
