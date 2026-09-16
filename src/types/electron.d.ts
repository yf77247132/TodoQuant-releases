interface ElectronAPI {
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
  onUpdateAvailable: (callback: (version: string) => void) => () => void;
  onUpdateNotAvailable: (callback: () => void) => () => void;
  onUpdateDownloadProgress: (callback: (percent: number) => void) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
  onUpdateError: (callback: (message: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
