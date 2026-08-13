
const isElectron = process.env.ELECTRON_MODE === 'true';

type ElectronMessage =
  | { type: 'SYSTEM_SUSPEND' }
  | { type: 'SYSTEM_RESUME' }
  | { type: 'SHUTDOWN_FT' }
  | { type: 'pc-notification'; title: string; body: string };

export function sendPcNotification(title: string, body: string): boolean {
  if (!isElectron) {
    return false;
  }

  try {
    if (typeof process.send !== 'function') {
      return false;
    }
    process.send({
      type: 'pc-notification',
      title,
      body,
    } as ElectronMessage);
    return true;
  } catch (e) {
    return false;
  }
}

export function isElectronMode(): boolean {
  return isElectron && typeof process.send === 'function';
}
