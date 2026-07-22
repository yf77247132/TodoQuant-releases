const DEFAULT_PORT = 3000;

export function getInitialPort(): number {
  return DEFAULT_PORT;
}

export function checkPortAvailable(port: number): Promise<boolean> {
  return Promise.resolve(port === DEFAULT_PORT);
}

export async function findAvailablePort(
  _startPort: number = getInitialPort(),
  _maxAttempts: number = 1
): Promise<{ port: number; wasPortInUse: boolean }> {
  return {
    port: DEFAULT_PORT,
    wasPortInUse: false,
  };
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
