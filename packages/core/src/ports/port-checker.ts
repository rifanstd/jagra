/** Tells whether a local port is free (MCK-3). */
export interface PortChecker {
  isFree(port: number): Promise<boolean>;
  /** Whether something on this computer accepts connections on the port. */
  accepts(port: number): Promise<boolean>;
}
