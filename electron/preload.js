"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
function onIpcEvent(channel, callback) {
    const handler = (_event, ...args) => {
        callback(...args);
    };
    electron_1.ipcRenderer.on(channel, handler);
    return () => {
        electron_1.ipcRenderer.removeListener(channel, handler);
    };
}
const electronAPI = {
    getBackendPort: () => electron_1.ipcRenderer.invoke('get-backend-port'),
    getUserDataPath: () => electron_1.ipcRenderer.invoke('get-user-data-path'),
    restartBackend: () => electron_1.ipcRenderer.invoke('restart-backend'),
    getAppVersion: () => electron_1.ipcRenderer.invoke('get-app-version'),
    openExternal: (url) => electron_1.ipcRenderer.invoke('open-external', url),
    onBackendLog: (callback) => {
        const handler = (_event, log) => {
            callback(log);
        };
        electron_1.ipcRenderer.on('backend-log', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('backend-log', handler);
        };
    },
    platform: process.platform,
    versions: {
        node: process.versions.node,
        chrome: process.versions.chrome,
        electron: process.versions.electron,
    },
    checkForUpdates: () => electron_1.ipcRenderer.invoke('check-for-updates'),
    restartAndUpdate: () => electron_1.ipcRenderer.invoke('restart-and-update'),
    onUpdateChecking: (callback) => onIpcEvent('update-checking', callback),
    onUpdateAvailable: (callback) => onIpcEvent('update-available', callback),
    onUpdateNotAvailable: (callback) => onIpcEvent('update-not-available', callback),
    onUpdateDownloadProgress: (callback) => onIpcEvent('update-download-progress', callback),
    onUpdateDownloaded: (callback) => onIpcEvent('update-downloaded', callback),
    onUpdateError: (callback) => onIpcEvent('update-error', callback),
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
