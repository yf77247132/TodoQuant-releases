import { app, BrowserWindow, powerMonitor, ipcMain, Menu, shell, screen, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import net from 'net';
import fs from 'fs';

let backendProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let backendPort: number = 3000;
let isRestarting = false;
let isUpdating = false;
let updateReady = false;
let isUserInitiatedUpdate = false;
let lastNotification: Notification | null = null;

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

const WINDOW_STATE_FILE = 'window-state.json';
const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 1024;
const MIN_HEIGHT = 768;

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function isValidWindowState(state: unknown): state is WindowState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Record<string, unknown>;
  return (
    typeof s.x === 'number' &&
    typeof s.y === 'number' &&
    typeof s.width === 'number' &&
    typeof s.height === 'number' &&
    typeof s.isMaximized === 'boolean'
  );
}

function isWindowVisibleOnAnyDisplay(bounds: { x: number; y: number; width: number; height: number }): boolean {
  const displays = screen.getAllDisplays();
  const windowCenterX = bounds.x + bounds.width / 2;
  const windowCenterY = bounds.y + bounds.height / 2;
  
  for (const display of displays) {
    const { x, y, width, height } = display.bounds;
    if (
      windowCenterX >= x &&
      windowCenterX <= x + width &&
      windowCenterY >= y &&
      windowCenterY <= y + height
    ) {
      return true;
    }
  }
  return false;
}

function loadWindowState(): WindowState | null {
  try {
    const statePath = getWindowStatePath();
    if (!fs.existsSync(statePath)) {
      return null;
    }
    
    const content = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(content);
    
    if (!isValidWindowState(state)) {
      console.log('[Electron] Invalid window state format, ignoring');
      return null;
    }
    
    if (!isWindowVisibleOnAnyDisplay(state)) {
      console.log('[Electron] Window position outside visible area, resetting');
      return null;
    }
    
    console.log('[Electron] Loaded window state:', state);
    return state;
  } catch (e) {
    console.error('[Electron] Failed to load window state:', e);
    return null;
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const isMaximized = win.isMaximized();
    const bounds = win.getNormalBounds();
    
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized,
    };
    
    const statePath = getWindowStatePath();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    console.log('[Electron] Saved window state:', state);
  } catch (e) {
    console.error('[Electron] Failed to save window state:', e);
  }
}
let isUserQuitting = false;
let backendRestartCount = 0;
const MAX_BACKEND_RESTARTS = 3;
const BACKEND_STABLE_THRESHOLD_MS = 30000;

try { app.setAppUserModelId('com.todoquant.app'); } catch {  }

const PORT_RANGE_START = 3000;
const PORT_RANGE_END = 3010;

async function findAvailablePort(startPort: number, endPort: number): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
    const available = await checkPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${startPort}-${endPort}`);
}

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

function getUserDataPath(): string {
  return app.getPath('userData');
}

function startBackend(port: number): ChildProcess {
  const projectRoot = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : path.resolve(__dirname, '..');

  const distServerDir = app.isPackaged
    ? path.join(process.resourcesPath, 'dist-server')
    : path.join(projectRoot, 'dist-server');
  const nodeModulesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'node_modules')
    : path.join(projectRoot, 'node_modules');
  const hasCompiledServer = require('fs').existsSync(path.join(distServerDir, 'server.cjs'));
  const useCompiledServer = hasCompiledServer;

  const integrityFiles = [
    { path: path.join(distServerDir, 'server.cjs'), hash: path.join(distServerDir, '.hash') },
  ];
  if (useCompiledServer) {
    integrityFiles.push(
      { path: path.join(__dirname, 'main.js'), hash: path.join(__dirname, 'main.js.hash') },
    );
  }
  for (const { path: filePath, hash: hashFilePath } of integrityFiles) {
    if (require('fs').existsSync(hashFilePath)) {
      const expected = require('fs').readFileSync(hashFilePath, 'utf-8').trim();
      const actual = crypto.createHash('sha256')
        .update(require('fs').readFileSync(filePath)).digest('hex');
      if (expected !== actual) {
        console.error(`[Security] INTEGRITY CHECK FAILED: ${filePath}`);
        throw new Error(`File integrity check failed: ${filePath}`);
      }
    }
  }

  const env = {
    ...process.env,
    PORT: String(port),
    ELECTRON_USER_DATA_PATH: getUserDataPath(),
    NODE_ENV: useCompiledServer ? 'production' : 'development',
    ELECTRON_MODE: 'true',
  };

  console.log(`[Electron] Starting backend on port ${port}`);
  console.log(`[Electron] User data path: ${getUserDataPath()}`);
  console.log(`[Electron] isPackaged: ${app.isPackaged}`);
  console.log(`[Electron] projectRoot: ${projectRoot}`);
  console.log(`[Electron] distServerDir: ${distServerDir}`);
  console.log(`[Electron] hasCompiledServer: ${hasCompiledServer}`);

  let backend: ChildProcess;
  const backendStartTime = Date.now();

  if (useCompiledServer) {
    const serverPath = path.join(distServerDir, 'server.cjs');
    console.log(`[Electron] Starting compiled server: ${serverPath}`);
    console.log(`[Electron] Using execPath: ${process.execPath}`);
    console.log(`[Electron] NODE_PATH: ${nodeModulesPath}`);

    backend = spawn(
      process.execPath,
      [serverPath],
      {
        cwd: projectRoot,
        env: {
          ...env,
          NODE_PATH: nodeModulesPath,
          ELECTRON_RUN_AS_NODE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        shell: false,
      }
    );
  } else {
    const serverPath = path.join(projectRoot, 'server.ts');
    console.log(`[Electron] Starting dev server with tsx: ${serverPath}`);
    
    backend = spawn(
      'npx',
      ['tsx', serverPath],
      {
        cwd: projectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        shell: true,
      }
    );
  }

  backend.stdout?.on('data', (data) => {
    try {
      const output = data.toString();
      console.log(`[Backend] ${output.trim()}`);
    } catch {
    }
  });

  backend.stderr?.on('data', (data) => {
    try {
      const output = data.toString();
      console.error(`[Backend Error] ${output.trim()}`);
    } catch {
    }
  });

  backend.on('error', (err) => {
    console.error('[Electron] Failed to start backend:', err);
  });

  backend.on('exit', (code, signal) => {
    const uptime = Date.now() - backendStartTime;
    console.log(`[Electron] Backend exited with code ${code}, signal ${signal}, uptime ${uptime}ms`);
    backendProcess = null;

    if (isUserQuitting || isRestarting) {
      console.log('[Electron] User-initiated quit/restart, not restarting backend');
      return;
    }

    if (code === 0 || signal === 'SIGTERM') {
      console.log('[Electron] Backend exited normally, not restarting');
      return;
    }

    if (uptime > BACKEND_STABLE_THRESHOLD_MS) {
      backendRestartCount = 0;
      console.log('[Electron] Backend was stable, reset restart count');
    }

    if (backendRestartCount >= MAX_BACKEND_RESTARTS) {
      console.error(`[Electron] Backend restart limit (${MAX_BACKEND_RESTARTS}) reached, not restarting`);
      mainWindow?.webContents.send('backend-crash', {
        message: '后端服务多次异常退出，请检查日志或重启应用',
        restartCount: backendRestartCount,
      });
      return;
    }

    backendRestartCount++;
    console.log(`[Electron] Attempting backend restart ${backendRestartCount}/${MAX_BACKEND_RESTARTS}...`);

    setTimeout(() => {
      if (isUserQuitting || isRestarting) {
        console.log('[Electron] User quit during restart delay, aborting');
        return;
      }
      backendProcess = startBackend(port);
    }, 2000);
  });

  return backend;
}

function createWindow(port: number): BrowserWindow {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log(`[Electron] Preload path: ${preloadPath}`);
  
  const savedState = loadWindowState();
  
  const win = new BrowserWindow({
    x: savedState?.x,
    y: savedState?.y,
    width: savedState?.width ?? DEFAULT_WIDTH,
    height: savedState?.height ?? DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
    title: 'TodoQuant',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
  });

  if (savedState?.isMaximized) {
    win.maximize();
  }

  const frontendUrl = `http://localhost:${port}`;
  const distPath = path.join(__dirname, '..', 'dist', 'index.html');
  
  console.log(`[Electron] Waiting for backend on ${frontendUrl}...`);

  const loadWithFallback = async (): Promise<void> => {
    for (let i = 0; i < 15; i++) {
      try {
        await win.loadURL(frontendUrl);
        console.log(`[Electron] Frontend loaded from local server`);
        return;
      } catch {
        if (i < 14) {
          console.log(`[Electron] Load attempt ${i + 1}/15 failed, retrying in 1s...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    console.log('[Electron] Local server not available, falling back to static files');
    await win.loadFile(distPath);
  };

  loadWithFallback().catch(err => {
    console.error('[Electron] Failed to load frontend:', err);
  });

  const showTimer = setTimeout(() => {
    if (!win.isVisible()) {
      console.log('[Electron] Force showing window after timeout');
      win.show();
    }
  }, 10000);

  win.once('ready-to-show', () => {
    clearTimeout(showTimer);
    win.show();
  });

  win.on('close', () => {
    saveWindowState(win);
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[Electron] Failed to load: ${errorCode} - ${errorDescription}`);
  });

  win.webContents.on('did-finish-load', () => {
    console.log('[Electron] Page finished loading');
    setTimeout(() => {
      console.log('[Electron] Running startup update check...');
      autoUpdater.checkForUpdates().catch((err: Error) => {
        console.log('[Electron] Startup update check failed:', err.message);
      });
    }, 2000);
  });

  return win;
}

function setupPowerMonitor(): void {
  powerMonitor.on('suspend', () => {
    console.log('[Electron] System suspending');
    if (backendProcess && backendProcess.send) {
      backendProcess.send({ type: 'SYSTEM_SUSPEND' });
    }
  });

  powerMonitor.on('resume', async () => {
    console.log('[Electron] System resuming, notifying backend to reconnect');
    if (backendProcess && backendProcess.send) {
      backendProcess.send({ type: 'SYSTEM_RESUME' });
    }
  });

  if (backendProcess) {
    backendProcess.on('message', (msg: any) => {
      if (msg && msg.type === 'pc-notification') {
        showSystemNotification(msg.title || 'TodoQuant', msg.body || '');
      }
    });
  }

  powerMonitor.on('on-ac', () => {
    console.log('[Electron] System on AC power');
  });

  powerMonitor.on('on-battery', () => {
    console.log('[Electron] System on battery');
  });

  powerMonitor.on('lock-screen', () => {
    console.log('[Electron] Screen locked');
  });

  powerMonitor.on('unlock-screen', () => {
    console.log('[Electron] Screen unlocked');
  });
}

function setupIpcHandlers(): void {
  ipcMain.handle('get-backend-port', () => {
    return backendPort;
  });

  ipcMain.handle('get-user-data-path', () => {
    return getUserDataPath();
  });

  ipcMain.handle('restart-backend', async () => {
    console.log('[Electron] Restarting backend...');
    
    if (backendProcess) {
      backendProcess.kill('SIGTERM');
      backendProcess = null;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    backendPort = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
    backendProcess = startBackend(backendPort);

    return backendPort;
  });

  ipcMain.handle('open-external', (_event, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('check-for-updates', () => {
    if (isUpdating) {
      mainWindow?.webContents.send('update-error', '正在下载更新，请稍候');
      return;
    }
    autoUpdater.checkForUpdates().catch(() => {});
  });

  ipcMain.handle('restart-and-update', () => {
    isUserInitiatedUpdate = true;
    autoUpdater.quitAndInstall(false, true);
  });
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  (autoUpdater as any).disableDifferentialDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
    mainWindow?.webContents.send('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[AutoUpdater] Update available: ${info.version}`);
    isUpdating = true;
    mainWindow?.webContents.send('update-available', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] No update available');
    isUpdating = false;
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] Downloading: ${progress.percent.toFixed(1)}%`);
    mainWindow?.webContents.send('update-download-progress', progress.percent);
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('[AutoUpdater] Update downloaded, ready to install');
    isUpdating = false;
    updateReady = true;
    mainWindow?.webContents.send('update-downloaded');
  });

  autoUpdater.on('error', (err) => {
    console.error(`[AutoUpdater] Error: ${err.message}`);
    isUpdating = false;
    mainWindow?.webContents.send('update-error', err.message);
  });
}

function setupMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'TodoQuant',
      submenu: [
        {
          label: '重启',
          click: async () => {
            console.log('[Electron] Restarting application...');
            isRestarting = true;
            
            if (backendProcess) {
              console.log('[Electron] Killing backend process tree...');
              if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t'], {
                  shell: true,
                  stdio: 'ignore',
                });
              } else {
                backendProcess.kill('SIGTERM');
              }
              backendProcess = null;
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('[Electron] Starting new instance...');
            app.relaunch({ args: process.argv.slice(1) });
            app.exit(0);
          },
        },
        { type: 'separator' },
        {
          label: '检查更新',
          click: () => {
            if (isUpdating) {
              mainWindow?.webContents.send('update-error', '正在下载更新，请稍候');
              return;
            }
            autoUpdater.checkForUpdates().catch(() => {});
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          click: async () => {
            await cleanup();
            app.quit();
          },
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '重置缩放' },
        ...(!app.isPackaged ? [
          { type: 'separator' as const },
          { role: 'toggleDevTools' as const, label: '开发者工具' },
        ] : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showSystemNotification(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) {
      console.warn('[Electron] System notification not supported on this platform');
      return;
    }
    const notification = new Notification({
      title,
      body,
      silent: false,
    } as any);
    (notification as any).tag = `todoquant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    notification.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
    lastNotification = notification;
    notification.show();
    console.log(`[Electron] System notification shown: ${title}`);
  } catch (e) {
    console.error('[Electron] Failed to show notification:', e);
  }
}

async function cleanup(): Promise<void> {
  console.log('[Electron] Cleaning up...');
  isUserQuitting = true;
  lastNotification?.close();

  if (backendProcess && backendProcess.send) {
    backendProcess.send({ type: 'SHUTDOWN_FT' });
    await new Promise(r => setTimeout(r, 2000));
  }

  if (backendProcess) {
    console.log('[Electron] Stopping backend...');
    backendProcess.kill('SIGTERM');
    
    await new Promise<void>((resolve) => {
      if (!backendProcess) {
        resolve();
        return;
      }
      
      const timeout = setTimeout(() => {
        console.log('[Electron] Force killing backend...');
        backendProcess?.kill('SIGKILL');
        resolve();
      }, 5000);

      backendProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    
    backendProcess = null;
  }

  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }
}

async function main(): Promise<void> {
  console.log('[Electron] Starting application...');

  backendPort = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
  console.log(`[Electron] Using port ${backendPort}`);

  backendProcess = startBackend(backendPort);

  console.log('[Electron] Waiting for backend to initialize...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  mainWindow = createWindow(backendPort);

  setupMenu();
  setupPowerMonitor();
  setupIpcHandlers();
  setupAutoUpdater();

  setInterval(() => {
    console.log('[Electron] Periodic update check...');
    autoUpdater.checkForUpdates().catch(() => {});
  }, 2 * 60 * 60 * 1000);

  console.log('[Electron] Application started successfully');
}

app.whenReady().then(main);

app.on('window-all-closed', async () => {
  await cleanup();
  app.quit();
});

app.on('before-quit', async (event) => {
  if (isRestarting) {
    console.log('[Electron] Restarting, allowing quit...');
    return;
  }
  if (updateReady && isUserInitiatedUpdate) {
    console.log('[Electron] User initiated update, launching installer...');
    event.preventDefault();
    autoUpdater.quitAndInstall(false, true);
    return;
  }
  if (backendProcess) {
    event.preventDefault();
    await cleanup();
    app.quit();
  }
});

app.on('will-quit', () => {
  console.log('[Electron] Application will quit');
});

process.on('uncaughtException', (error) => {
  console.error('[Electron] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Electron] Unhandled rejection at:', promise, 'reason:', reason);
});
