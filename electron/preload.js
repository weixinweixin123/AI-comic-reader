import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("watchmate", {
  openFloatingWindow: () => ipcRenderer.invoke("watchmate:open-floating"),
  closeFloatingWindow: () => ipcRenderer.invoke("watchmate:close-floating"),
  toggleFloatingPin: () => ipcRenderer.invoke("watchmate:toggle-floating-pin"),
  toggleDanmakuOverlay: () => ipcRenderer.invoke("watchmate:toggle-danmaku-overlay"),
  editDanmakuOverlay: () => ipcRenderer.invoke("watchmate:edit-danmaku-overlay"),
  sendDanmaku: (items) => ipcRenderer.send("watchmate:send-danmaku", items),
  onDanmaku: (callback) => {
    const listener = (_event, items) => callback(items);
    ipcRenderer.on("watchmate:danmaku", listener);
    return () => ipcRenderer.removeListener("watchmate:danmaku", listener);
  },
  onDanmakuEdit: (callback) => {
    const listener = (_event, editing) => callback(editing);
    ipcRenderer.on("watchmate:danmaku-edit", listener);
    return () => ipcRenderer.removeListener("watchmate:danmaku-edit", listener);
  }
});
