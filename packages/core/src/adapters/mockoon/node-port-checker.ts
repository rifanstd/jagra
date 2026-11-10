import { connect, createServer } from "node:net";
import type { PortChecker } from "../../ports/port-checker.js";

/** How long a connection attempt to this computer may take. */
const CONNECT_MS = 1000;

/**
 * On Windows a port taken on 0.0.0.0 still lets a program listen on 127.0.0.1, and the other way
 * round (to-verify.md). So a port counts as free only when nothing accepts a connection on it
 * and Jagra can listen on it at both addresses (D-62).
 */
export class NodePortChecker implements PortChecker {
  async isFree(port: number): Promise<boolean> {
    if (await this.accepts(port)) return false;
    return (
      (await canListen("127.0.0.1", port)) && (await canListen("0.0.0.0", port))
    );
  }

  accepts(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = connect({ host: "127.0.0.1", port });
      const done = (accepted: boolean) => {
        socket.destroy();
        resolve(accepted);
      };
      socket.setTimeout(CONNECT_MS, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  }
}

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}
