import net from "net";

const DEFAULT_PORT = 3000;

function parsePort(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

export function getInitialPort(): number {
  return parsePort(process.env.PORT) ?? DEFAULT_PORT;
}

export function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

export async function findAvailablePort(
  startPort: number = getInitialPort(),
  maxAttempts: number = 1
): Promise<{ port: number; wasPortInUse: boolean }> {
  const attempts = Math.max(1, Math.floor(maxAttempts));
  for (let i = 0; i < attempts; i++) {
    const candidate = startPort + i;
    if (candidate > 65535) break;
    if (await checkPortAvailable(candidate)) {
      return { port: candidate, wasPortInUse: candidate !== startPort };
    }
  }
  const range = attempts > 1 ? `${startPort}-${startPort + attempts - 1}` : String(startPort);
  throw new Error(
    `[portManager] 端口 ${range} 均被占用，后端无法启动。` +
      `请关闭占用该端口的进程（例如已在运行的 dev 后端），或用 PORT 环境变量指定其它端口。`
  );
}

let resolvedPort: number | null = null;

export function setResolvedPort(port: number): void {
  resolvedPort = port;
}

export function getResolvedPort(): number | null {
  return resolvedPort;
}

export function getServerUrl(host: string = "localhost"): string {
  const port = resolvedPort || getInitialPort();
  return `http://${host}:${port}`;
}
