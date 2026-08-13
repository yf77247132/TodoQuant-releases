import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  getBackendPort: () => Promise<number>;
  getUserDataPath: () => Promise<string>;
  restartBackend: () => Promise<number>;
  openExternal: (url: string) => Promise<void>;
  getAppVersion: () => Promise<string>;
  onBackendLog: (callback: (log: string) => void) => () => void;
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  checkForUpdates: () => Promise<void>;
  restartAndUpdate: () => Promise<void>;
  onUpdateChecking: (callback: () => void) => () => void;
  onUpdateAvailable: (callback: (version: string) => void) => () => void;
  onUpdateNotAvailable: (callback: () => void) => () => void;
  onUpdateDownloadProgress: (callback: (percent: number) => void) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
  onUpdateError: (callback: (message: string) => void) => () => void;
}

function onIpcEvent(channel: string, callback: (...args: any[]) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: any[]) => {
    callback(...args);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const electronAPI: ElectronAPI = {
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),

  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

  restartBackend: () => ipcRenderer.invoke('restart-backend'),

  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  onBackendLog: (callback: (log: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, log: string) => {
      callback(log);
    };

    ipcRenderer.on('backend-log', handler);

    return () => {
      ipcRenderer.removeListener('backend-log', handler);
    };
  },

  platform: process.platform,

  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },

  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  restartAndUpdate: () => ipcRenderer.invoke('restart-and-update'),

  onUpdateChecking: (callback: () => void) =>
    onIpcEvent('update-checking', callback),

  onUpdateAvailable: (callback: (version: string) => void) =>
    onIpcEvent('update-available', callback),

  onUpdateNotAvailable: (callback: () => void) =>
    onIpcEvent('update-not-available', callback),

  onUpdateDownloadProgress: (callback: (percent: number) => void) =>
    onIpcEvent('update-download-progress', callback),

  onUpdateDownloaded: (callback: () => void) =>
    onIpcEvent('update-downloaded', callback),

  onUpdateError: (callback: (message: string) => void) =>
    onIpcEvent('update-error', callback),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
