import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../server/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const useDevServer = process.argv.includes("--dev-server");
const serverPort = Number(process.env.PORT || 8787);
let server;
let mainWindow;
let floatingWindow;
let danmakuOverlayWindow;
let danmakuEditTimer;

const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  preload: path.join(__dirname, "preload.js")
};

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "AI Watchmate",
    backgroundColor: "#101312",
    autoHideMenuBar: true,
    webPreferences
  });

  if (useDevServer) {
    await mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  }
}

async function createFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.show();
    floatingWindow.focus();
    return;
  }

  floatingWindow = new BrowserWindow({
    width: 360,
    height: 220,
    minWidth: 260,
    minHeight: 150,
    title: "AI Watchmate Float",
    backgroundColor: "#111514",
    autoHideMenuBar: true,
    frame: false,
    transparent: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences
  });

  floatingWindow.setAlwaysOnTop(true, "screen-saver");

  const floatingUrl = useDevServer
    ? "http://127.0.0.1:5173?float=1"
    : `http://127.0.0.1:${serverPort}?float=1`;

  await floatingWindow.loadURL(floatingUrl);

  floatingWindow.on("closed", () => {
    floatingWindow = null;
  });
}

async function toggleDanmakuOverlayWindow() {
  if (danmakuOverlayWindow && !danmakuOverlayWindow.isDestroyed()) {
    clearTimeout(danmakuEditTimer);
    danmakuOverlayWindow.close();
    danmakuOverlayWindow = null;
    return false;
  }

  const display = screen.getPrimaryDisplay();
  const width = Math.round(display.workAreaSize.width * 0.72);
  const height = 280;
  danmakuOverlayWindow = new BrowserWindow({
    x: display.workArea.x + Math.round((display.workAreaSize.width - width) / 2),
    y: display.workArea.y + 80,
    width,
    height,
    minWidth: 420,
    minHeight: 140,
    title: "AI Watchmate 弹幕区域",
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    focusable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences
  });

  danmakuOverlayWindow.setAlwaysOnTop(true, "screen-saver");
  danmakuOverlayWindow.setBackgroundColor("#00000000");

  const overlayUrl = useDevServer
    ? "http://127.0.0.1:5173?overlay=1"
    : `http://127.0.0.1:${serverPort}?overlay=1`;

  await danmakuOverlayWindow.loadURL(overlayUrl);

  danmakuOverlayWindow.on("closed", () => {
    clearTimeout(danmakuEditTimer);
    danmakuOverlayWindow = null;
  });

  setDanmakuOverlayEditMode(true);
  return true;
}

function setDanmakuOverlayEditMode(editing) {
  if (!danmakuOverlayWindow || danmakuOverlayWindow.isDestroyed()) return false;

  clearTimeout(danmakuEditTimer);
  danmakuOverlayWindow.setIgnoreMouseEvents(!editing, { forward: true });
  danmakuOverlayWindow.webContents.send("watchmate:danmaku-edit", editing);

  if (editing) {
    danmakuOverlayWindow.focus();
    danmakuEditTimer = setTimeout(() => {
      setDanmakuOverlayEditMode(false);
    }, 7000);
  }

  return true;
}

function setupIpc() {
  ipcMain.handle("watchmate:open-floating", async () => {
    await createFloatingWindow();
  });

  ipcMain.handle("watchmate:close-floating", () => {
    floatingWindow?.close();
  });

  ipcMain.handle("watchmate:toggle-floating-pin", () => {
    if (!floatingWindow || floatingWindow.isDestroyed()) return false;
    const next = !floatingWindow.isAlwaysOnTop();
    floatingWindow.setAlwaysOnTop(next, "screen-saver");
    return next;
  });

  ipcMain.handle("watchmate:toggle-danmaku-overlay", async () => {
    return toggleDanmakuOverlayWindow();
  });

  ipcMain.handle("watchmate:edit-danmaku-overlay", async () => {
    return setDanmakuOverlayEditMode(true);
  });

  ipcMain.on("watchmate:send-danmaku", (_event, items) => {
    if (danmakuOverlayWindow && !danmakuOverlayWindow.isDestroyed()) {
      danmakuOverlayWindow.webContents.send("watchmate:danmaku", items);
    }
  });
}

function setupScreenShare() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: { width: 640, height: 360 }
      });

      callback({ video: sources[0] });
    },
    { useSystemPicker: true }
  );
}

app.whenReady().then(async () => {
  setupIpc();
  setupScreenShare();
  if (!useDevServer) {
    server = startServer(serverPort);
  }
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  danmakuOverlayWindow?.close();
  server?.close();
});
