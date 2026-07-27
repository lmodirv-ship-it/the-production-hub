/**
 * Save files into a folder the user picks once (File System Access API),
 * falling back to a normal browser download when unavailable.
 */

type DirHandle = {
  name: string;
  queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  getFileHandle: (
    n: string,
    o?: { create?: boolean },
  ) => Promise<{
    createWritable: () => Promise<{
      write: (d: Blob | string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

let dirHandle: DirHandle | null = null;
let dirName = "";

const DB = "eco-fs";
const STORE = "handles";

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function persist(handle: DirHandle | null) {
  const db = await idb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, "dir");
  } catch {
    /* ignore */
  }
}

export function supportsFolderSave() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function currentFolderName() {
  return dirName;
}

async function ensurePermission(h: DirHandle) {
  const opts = { mode: "readwrite" };
  const q = (await h.queryPermission?.(opts)) ?? "granted";
  if (q === "granted") return true;
  const r = (await h.requestPermission?.(opts)) ?? "denied";
  return r === "granted";
}

/** Restore a previously chosen folder (no prompt if permission is still granted). */
export async function restoreFolder(): Promise<string> {
  const db = await idb();
  if (!db) return "";
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get("dir");
      req.onsuccess = async () => {
        const h = req.result as DirHandle | undefined;
        if (h && (await ensurePermission(h))) {
          dirHandle = h;
          dirName = h.name;
          resolve(h.name);
        } else resolve("");
      };
      req.onerror = () => resolve("");
    } catch {
      resolve("");
    }
  });
}

export async function pickFolder(): Promise<string> {
  const picker = (
    window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<DirHandle> }
  ).showDirectoryPicker;
  if (!picker) throw new Error("المتصفح لا يدعم اختيار مجلد — استخدم Chrome أو Edge.");
  const h = await picker({ mode: "readwrite", startIn: "documents" });
  if (!(await ensurePermission(h))) throw new Error("لم يُمنح إذن الكتابة في المجلد.");
  dirHandle = h;
  dirName = h.name;
  await persist(h);
  return h.name;
}

export function clearFolder() {
  dirHandle = null;
  dirName = "";
  void persist(null);
}

function browserDownload(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Write into the chosen folder, or download it. Returns "folder" | "download". */
export async function saveFile(
  data: Blob | string,
  filename: string,
): Promise<"folder" | "download"> {
  const blob =
    typeof data === "string" ? new Blob([data], { type: "text/plain;charset=utf-8" }) : data;
  if (dirHandle) {
    try {
      if (await ensurePermission(dirHandle)) {
        const fh = await dirHandle.getFileHandle(filename, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        return "folder";
      }
      // permission lost — clear so future saves fall back to download
      dirHandle = null;
      dirName = "";
      void persist(null);
    } catch (e) {
      console.error("folder write failed", e);
    }
  }
  browserDownload(blob, filename);
  return "download";
}

