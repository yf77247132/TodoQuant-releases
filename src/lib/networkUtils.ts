
export function isLoopbackAddress(addr: string | undefined | null): boolean {
  if (!addr) return false;
  if (addr === '::1') return true;
  if (addr.startsWith('127.')) return true;
  if (addr.startsWith('::ffff:')) return isLoopbackAddress(addr.slice(7));
  return false;
}

export function isLoopbackRequest(req: { socket?: { remoteAddress?: string } } | undefined | null): boolean {
  return isLoopbackAddress(req?.socket?.remoteAddress);
}

function envFlag(name: string): boolean {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

export function allowRemoteAccess(): boolean {
  return envFlag('OKTS_ALLOW_REMOTE');
}

export function allowRemoteFtWebhook(): boolean {
  return envFlag('OKTS_WEBHOOK_ALLOW_REMOTE');
}
