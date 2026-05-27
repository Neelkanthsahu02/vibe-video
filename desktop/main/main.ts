import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { registerIpcHandlers } from "./ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the renderer entry — vite emits dist-desktop/renderer/index.html
const RENDERER_INDEX = path.resolve(
  __dirname,
  "..",
  "renderer",
  "index.html",
);
const PRELOAD = path.resolve(__dirname, "preload.cjs");
const DEV_URL = process.env.VIBE_DEV_URL ?? "";

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    title: "vibe-video",
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // necessary to load file:// images and clips
    },
  });

  if (DEV_URL) {
    await mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(RENDERER_INDEX);
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers(ipcMain, () => mainWindow);

  // File picker — convenience IPC bridge to Electron's dialog API
  ipcMain.handle(
    "vibe:pick-file",
    async (
      _event,
      title: string,
      filters?: { name: string; extensions: string[] }[],
    ) => {
      const res = await dialog.showOpenDialog(mainWindow!, {
        title,
        properties: ["openFile"],
        filters,
      });
      return {
        cancelled: res.canceled,
        path: res.filePaths[0] ?? null,
      };
    },
  );

  ipcMain.handle("vibe:open-path", async (_event, p: string) => {
    await shell.openPath(p);
  });

  ipcMain.handle("vibe:reveal", async (_event, p: string) => {
    shell.showItemInFolder(p);
  });

  ipcMain.handle("vibe:to-file-url", (_event, p: string) =>
    pathToFileURL(p).toString(),
  );

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
