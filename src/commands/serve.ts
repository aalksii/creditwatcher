import { startServer } from "../server/index.js";

const DEFAULT_PORT = 9477;

export function parseServeArgs(args: string[]): { port: number } {
  let port = DEFAULT_PORT;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" || arg === "-p") {
      const next = args[i + 1];
      if (!next) {
        throw new Error("Missing value for --port");
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid port: ${next}`);
      }
      port = parsed;
      i++;
    } else if (arg.startsWith("--port=")) {
      const parsed = Number(arg.slice("--port=".length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid port: ${arg}`);
      }
      port = parsed;
    } else if (!arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { port };
}

export async function serveCommand(args: string[]): Promise<void> {
  const { port } = parseServeArgs(args);
  await startServer(port);
}
