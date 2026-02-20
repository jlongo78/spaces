import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { startTerminalWsServer } from './terminal-server';
import { initMainTelemetry, identifyInstall, trackMain, shutdownMainTelemetry } from './telemetry';

const NEXT_PORT = 3457;
const WS_PORT = 3458;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Spaces',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Handle pop-out windows (window.open for terminal popouts)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow internal URLs to open in new Electron windows
    if (url.startsWith(`http://127.0.0.1:${NEXT_PORT}`)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 800,
          height: 600,
          backgroundColor: '#09090b',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    // External URLs open in the system browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function waitForServer(url: string, maxWaitMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${url} did not start within ${maxWaitMs}ms`);
}

async function startNextServer(): Promise<void> {
  // In production (packaged), start the standalone Next.js server
  // In dev, we expect `next dev` to be running externally
  if (!app.isPackaged) {
    console.log('[Electron] Dev mode — expecting external Next.js dev server');
    return;
  }

  const standaloneDir = path.join(process.resourcesPath, 'standalone');

  // Next.js standalone output nests files under the project's path relative
  // to the detected workspace root. Find server.js wherever it landed.
  const fs = require('fs');
  function findServerJs(dir: string): string | null {
    const candidate = path.join(dir, 'server.js');
    if (fs.existsSync(candidate)) return candidate;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.next') {
        const found = findServerJs(path.join(dir, entry.name));
        if (found) return found;
      }
    }
    return null;
  }

  const serverPath = findServerJs(standaloneDir);
  if (!serverPath) {
    throw new Error(`Could not find server.js in ${standaloneDir}`);
  }
  const serverDir = path.dirname(serverPath);

  // Set env vars for standalone server
  process.env.PORT = String(NEXT_PORT);
  process.env.HOSTNAME = '127.0.0.1';

  // The standalone server needs to find its .next directory (sibling to server.js)
  process.env.NEXT_DIST_DIR = path.join(serverDir, '.next');

  console.log(`[Electron] Starting Next.js standalone server from ${serverPath}`);
  require(serverPath);
}

app.whenReady().then(async () => {
  const startTime = Date.now();

  // Initialize telemetry early
  initMainTelemetry();
  identifyInstall();

  // Start terminal WebSocket server
  startTerminalWsServer(WS_PORT);

  // Start Next.js server (or wait for external dev server)
  await startNextServer();

  // Create the window
  createWindow();

  // Wait for server to be ready, then show
  try {
    await waitForServer(`http://127.0.0.1:${NEXT_PORT}/`);
    mainWindow?.loadURL(`http://127.0.0.1:${NEXT_PORT}/`);
    mainWindow?.show();
    trackMain('app_opened', { startupMs: Date.now() - startTime });
  } catch (err) {
    trackMain('app_startup_failed', { error: String(err) });
    console.error('[Electron] Failed to start:', err);
    app.quit();
  }
});

app.on('before-quit', async () => {
  trackMain('app_closed');
  await shutdownMainTelemetry();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    mainWindow?.loadURL(`http://127.0.0.1:${NEXT_PORT}/`);
    mainWindow?.show();
  }
});
