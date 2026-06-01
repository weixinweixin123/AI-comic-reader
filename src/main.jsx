import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Bot,
  Brain,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileUp,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Wand2,
  MousePointerClick,
  CheckSquare,
  Maximize2,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { defaultConfig } from "./config.js";
import { parseDanmakuLines } from "./danmaku.js";
import { loadConfig } from "./storage.js";
import "./styles.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const apiBase = window.location.protocol === "file:" ? "http://127.0.0.1:8787" : "";
const activeWorkKey = "watchmate-active-comic-work";
const dbName = "watchmate-comic-library";
const dbVersion = 1;
const worksStore = "works";
const baseReaderWidth = 920;
const minZoom = 0.55;
const maxZoom = 2.4;

function apiUrl(path) {
  return `${apiBase}${path}`;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openLibraryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(worksStore)) {
        db.createObjectStore(worksStore, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbRequest(mode, action) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(worksStore, mode);
    const store = tx.objectStore(worksStore);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function loadWorks() {
  return dbRequest("readonly", (store) => store.getAll());
}

function saveWork(work) {
  return dbRequest("readwrite", (store) => store.put({ ...work, updatedAt: Date.now() }));
}

function deleteWorkFromDb(id) {
  return dbRequest("readwrite", (store) => store.delete(id));
}

function makeEmptyWork(title = "未命名作品") {
  const now = Date.now();
  return {
    id: makeId("work"),
    title,
    volumes: [],
    pages: [],
      memory: {
        storyMemory: "",
        characterNotes: "",
        foreshadowing: "",
        callbacks: "",
        notes: "",
        updatedAt: null
      },
    createdAt: now,
    updatedAt: now
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function safePdfTitle(fileName) {
  return fileName.replace(/\.[^.]+$/i, "");
}

function App() {
  const fileInputRef = useRef(null);
  const generationStoppedRef = useRef(false);
  const playTimersRef = useRef([]);
  const activeWorkRef = useRef(null);
  const lastWheelPageAtRef = useRef(0);
  const chromeHideTimerRef = useRef(null);
  const readerStageRef = useRef(null);
  const pageImageRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressActiveRef = useRef(false);
  const longPressPointRef = useRef({ x: 50, y: 50 });
  const longPressZoomRef = useRef(1);
  const suppressPageClickRef = useRef(false);

  const [config, setConfig] = useState(() => loadConfig());
  const [serverConfig, setServerConfig] = useState({ hasServerApiKey: false });
  const [works, setWorks] = useState([]);
  const [activeWorkId, setActiveWorkId] = useState(() => localStorage.getItem(activeWorkKey) || "");
  const [pageIndex, setPageIndex] = useState(0);
  const [status, setStatus] = useState("新建作品或选择作品后导入 PDF");
  const [isImporting, setImporting] = useState(false);
  const [isGenerating, setGenerating] = useState(false);
  const [isReading, setReading] = useState(false);
  const [isPlaying, setPlaying] = useState(false);
  const [isFocusMode, setFocusMode] = useState(false);
  const [isDanmakuEnabled, setDanmakuEnabled] = useState(true);
  const [isReaderChromeVisible, setReaderChromeVisible] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [wheelMode, setWheelMode] = useState("scroll");
  const [isPressZooming, setPressZooming] = useState(false);
  const [activeDanmaku, setActiveDanmaku] = useState([]);
  const [manualInput, setManualInput] = useState("");
  const [newWorkTitle, setNewWorkTitle] = useState("");
  const [workTitleDraft, setWorkTitleDraft] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [selectedPages, setSelectedPages] = useState(() => new Set());

  const activeWork = works.find((work) => work.id === activeWorkId) || null;
  activeWorkRef.current = activeWork;
  const currentPage = activeWork?.pages?.[pageIndex] || null;
  const generatedCount = useMemo(
    () => activeWork?.pages.filter((page) => page.danmaku?.length).length || 0,
    [activeWork]
  );
  const readCount = useMemo(
    () => activeWork?.pages.filter((page) => page.readStatus === "read" || page.summary).length || 0,
    [activeWork]
  );
  const canCall = config.baseUrl && (config.apiKey || serverConfig.hasServerApiKey) && (config.visionModel || config.model);

  useEffect(() => {
    refreshWorks();
  }, []);

  useEffect(() => {
    localStorage.setItem("watchmate-config", JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    if (activeWorkId) localStorage.setItem(activeWorkKey, activeWorkId);
  }, [activeWorkId]);

  useEffect(() => {
    setMemoryDraft(activeWork?.memory?.notes || "");
    setWorkTitleDraft(activeWork?.title || "");
    setSelectedPages(new Set());
    setPageIndex((current) => Math.min(current, Math.max(0, (activeWork?.pages.length || 1) - 1)));
  }, [activeWorkId, activeWork?.id]);

  useEffect(() => {
    fetch(apiUrl("/api/config"))
      .then((response) => response.json())
      .then((data) => {
        setServerConfig(data);
        setConfig((current) => ({
          ...current,
          baseUrl: current.baseUrl || data.baseUrl || "",
          model: current.model || data.model || defaultConfig.model,
          visionModel: current.visionModel || data.visionModel || defaultConfig.visionModel
        }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (!isFocusMode) return;
      showReaderChrome();
      if (event.key === "Escape") {
        setFocusMode(false);
      } else if (event.key === "ArrowLeft") {
        goPage(pageIndex - 1);
      } else if (event.key === "ArrowRight") {
        goPage(pageIndex + 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFocusMode, pageIndex, activeWork?.id, activeWork?.pages.length]);

  useEffect(() => {
    if (isFocusMode) {
      showReaderChrome();
      fitPageToScreen();
      return;
    }
    setReaderChromeVisible(true);
    if (chromeHideTimerRef.current) window.clearTimeout(chromeHideTimerRef.current);
  }, [isFocusMode, pageIndex]);

  useEffect(() => {
    if (!isFocusMode) return;
    fitPageToScreen();
  }, [isFocusMode, pageIndex, currentPage?.width, currentPage?.height]);

  useEffect(() => {
    if (!isFocusMode) return;
    function onResize() {
      fitPageToScreen();
    }

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isFocusMode, pageIndex, currentPage?.width, currentPage?.height]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
      if (chromeHideTimerRef.current) window.clearTimeout(chromeHideTimerRef.current);
    };
  }, []);

  async function refreshWorks(preferredId = activeWorkId) {
    const loaded = (await loadWorks()).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    setWorks(loaded);
    const nextId = preferredId && loaded.some((work) => work.id === preferredId) ? preferredId : loaded[0]?.id || "";
    setActiveWorkId(nextId);
  }

  async function persistWork(nextWork) {
    await saveWork(nextWork);
    activeWorkRef.current = nextWork;
    setWorks((current) => {
      const exists = current.some((work) => work.id === nextWork.id);
      const next = exists ? current.map((work) => (work.id === nextWork.id ? { ...nextWork, updatedAt: Date.now() } : work)) : [{ ...nextWork, updatedAt: Date.now() }, ...current];
      return next.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    });
    setActiveWorkId(nextWork.id);
  }

  async function createWork() {
    const title = newWorkTitle.trim() || "未命名作品";
    const work = makeEmptyWork(title);
    await persistWork(work);
    setNewWorkTitle("");
    setPageIndex(0);
    setStatus(`已创建作品：${title}`);
  }

  async function removeActiveWork() {
    if (!activeWork) return;
    const ok = window.confirm(`确定删除作品「${activeWork.title}」及其全部页面和弹幕吗？`);
    if (!ok) return;
    await deleteWorkFromDb(activeWork.id);
    setStatus("作品已删除");
    await refreshWorks("");
  }

  async function renameActiveWork() {
    const title = workTitleDraft.trim();
    if (!activeWork || !title || title === activeWork.title) return;
    await updateActiveWork((work) => ({ ...work, title }));
    setStatus(`作品已重命名为：${title}`);
  }

  async function openImportDialog() {
    if (window.watchmate?.openComicFile) {
      const files = await window.watchmate.openComicFile();
      if (files?.length) {
        await importElectronFiles(files);
      }
      return;
    }
    fileInputRef.current?.click();
  }

  async function importElectronFiles(files) {
    const browserFiles = await Promise.all(files.map(async (file) => {
      const blob = await fetch(file.dataUrl).then((response) => response.blob());
      return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
    }));
    await importFiles(browserFiles);
  }

  async function importFiles(files) {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    setImporting(true);
    clearPlayback();
    setStatus("正在解析文件...");

    try {
      const targetWork = activeWork || makeEmptyWork(safePdfTitle(selected[0].name));
      const existingPageCount = targetWork.pages.length;
      const rendered = [];

      for (const file of selected) {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const renderedPageCount = rendered.reduce((sum, item) => sum + item.pages.length, 0);
        const volume = {
          id: makeId("volume"),
          title: safePdfTitle(file.name),
          type: isPdf ? "pdf" : "image",
          pageStart: existingPageCount + renderedPageCount,
          pageCount: 0,
          importedAt: Date.now()
        };
        const pages = isPdf ? await renderPdf(file, volume) : await renderImageFile(file, volume);
        volume.pageCount = pages.length;
        rendered.push({ volume, pages });
      }

      const volumes = [...targetWork.volumes, ...rendered.map((item) => item.volume)];
      const pages = [
        ...targetWork.pages,
        ...rendered.flatMap((item) => item.pages).map((page, offset) => ({
          ...page,
          index: targetWork.pages.length + offset
        }))
      ];
      const nextWork = {
        ...targetWork,
        title: targetWork.title || safePdfTitle(selected[0].name),
        volumes,
        pages
      };
      await persistWork(nextWork);
      setPageIndex(existingPageCount);
      setStatus(`已导入 ${rendered.length} 个文件，共新增 ${pages.length - existingPageCount} 页`);
    } catch (error) {
      setStatus(error.message || "导入失败");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function renderPdf(file, volume) {
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setStatus(`正在渲染「${volume.title}」第 ${pageNumber} / ${pdf.numPages} 页...`);
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.8, 1320 / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      pages.push(makePage({
        image: canvas.toDataURL("image/jpeg", 0.82),
        width: canvas.width,
        height: canvas.height,
        volume,
        sourcePage: pageNumber - 1
      }));
    }

    return pages;
  }

  async function renderImageFile(file, volume) {
    return [makePage({
      image: await fileToDataUrl(file),
      width: 0,
      height: 0,
      volume,
      sourcePage: 0
    })];
  }

  function makePage({ image, width, height, volume, sourcePage }) {
    return {
      index: 0,
      volumeId: volume.id,
      volumeTitle: volume.title,
      sourcePage,
      image,
      width,
      height,
      summary: "",
      danmaku: [],
      readStatus: "pending",
      readImportant: false,
      status: "pending"
    };
  }

  async function updateActiveWork(updater) {
    const currentWork = activeWorkRef.current || activeWork;
    if (!currentWork) return null;
    const nextWork = typeof updater === "function" ? updater(currentWork) : updater;
    await persistWork(nextWork);
    return nextWork;
  }

  async function updatePage(targetIndex, patch) {
    return updateActiveWork((work) => ({
      ...work,
      pages: work.pages.map((page) => (page.index === targetIndex ? { ...page, ...patch } : page))
    }));
  }

  function buildWorkMemoryText(work = activeWork) {
    if (!work?.memory) return "";
    return [
      work.memory.storyMemory ? `剧情记忆：\n${work.memory.storyMemory}` : "",
      work.memory.characterNotes ? `人物记忆：\n${work.memory.characterNotes}` : "",
      work.memory.foreshadowing ? `伏笔与疑点：\n${work.memory.foreshadowing}` : "",
      work.memory.callbacks ? `前后关联：\n${work.memory.callbacks}` : "",
      work.memory.notes ? `用户补充：\n${work.memory.notes}` : ""
    ].filter(Boolean).join("\n\n");
  }

  function appendMemoryLines(existing, lines, prefix) {
    const current = String(existing || "").split("\n").map((line) => line.trim()).filter(Boolean);
    const seen = new Set(current.map((line) => line.replace(/^-\s*/, "")));
    const additions = lines
      .map((line) => String(line || "").replace(/\s+/g, " ").trim())
      .filter((line) => line && !seen.has(line))
      .map((line) => `- ${prefix}${line}`);
    return [...current, ...additions].slice(-80).join("\n");
  }

  function mergeReadMemory(work, pageNumber, readData) {
    const memory = work.memory || {};
    return {
      ...memory,
      storyMemory: appendMemoryLines(memory.storyMemory, readData.memoryPatch?.story || [], `第${pageNumber}页：`),
      characterNotes: appendMemoryLines(memory.characterNotes, readData.memoryPatch?.characters || [], `第${pageNumber}页：`),
      foreshadowing: appendMemoryLines(memory.foreshadowing, readData.memoryPatch?.foreshadowing || [], `第${pageNumber}页：`),
      callbacks: appendMemoryLines(memory.callbacks, readData.memoryPatch?.callbacks || [], `第${pageNumber}页：`),
      updatedAt: Date.now()
    };
  }

  async function readPage(targetIndex) {
    if (!activeWork || !canCall) {
      setStatus("请先选择作品并填写 API 配置");
      return null;
    }

    const work = activeWorkRef.current || activeWork;
    const page = work.pages[targetIndex];
    if (!page) return null;
    await updatePage(targetIndex, { readStatus: "reading" });
    setStatus(`AI 正在阅读第 ${targetIndex + 1} 页...`);

    const response = await fetch(apiUrl("/api/comic/read"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        visionModel: config.visionModel,
        title: work.title,
        pageIndex: targetIndex,
        totalPages: work.pages.length,
        image: page.image,
        workMemory: buildWorkMemoryText(work),
        userPrefs: [config.userPrefs, work.memory?.notes].filter(Boolean).join("\n"),
        previousPages: work.pages
          .slice(Math.max(0, targetIndex - 12), targetIndex)
          .map((item) => ({ index: item.index, summary: item.summary }))
          .filter((item) => item.summary)
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "阅读失败");

    await updateActiveWork((work) => {
      const pageNumber = targetIndex + 1;
      return {
        ...work,
        memory: mergeReadMemory(work, pageNumber, data),
        pages: work.pages.map((item) => item.index === targetIndex
          ? {
              ...item,
              summary: data.pageSummary || item.summary,
              readStatus: "read",
              readImportant: Boolean(data.important)
            }
          : item)
      };
    });
    setStatus(`第 ${targetIndex + 1} 页已读入作品记忆`);
    return data;
  }

  async function readWholeWork() {
    if (!activeWork || !canCall) {
      setStatus("请先选择作品并填写 API 配置");
      return;
    }
    setReading(true);
    generationStoppedRef.current = false;
    try {
      for (let index = 0; index < activeWork.pages.length; index += 1) {
        if (generationStoppedRef.current) break;
        const latestWork = activeWorkRef.current || activeWork;
        if (latestWork.pages[index]?.readStatus === "read" && latestWork.pages[index]?.summary) continue;
        await readPage(index);
      }
      setStatus(generationStoppedRef.current ? "已停止通读" : "整部作品已读入记忆");
    } catch (error) {
      setStatus(error.message || "通读中断");
    } finally {
      setReading(false);
    }
  }

  async function generatePage(targetIndex = pageIndex) {
    if (!activeWork || !canCall) {
      setStatus("请先选择作品并填写 API 配置");
      return null;
    }

    const work = activeWorkRef.current || activeWork;
    const page = work.pages[targetIndex];
    if (!page) return null;
    await updatePage(targetIndex, { status: "generating" });
    setStatus(`正在生成第 ${targetIndex + 1} 页弹幕...`);

    const response = await fetch(apiUrl("/api/comic/danmaku"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        visionModel: config.visionModel,
        title: work.title,
        pageIndex: targetIndex,
        totalPages: work.pages.length,
        image: page.image,
        density: Number(config.danmakuCount || 10),
        personaPrompt: config.personaPrompt,
        danmakuPrompt: config.danmakuPrompt,
        userPrefs: [config.userPrefs, buildWorkMemoryText(work)].filter(Boolean).join("\n"),
        previousPages: work.pages
          .slice(0, targetIndex)
          .filter((item) => item.summary)
          .slice(-18)
          .map((item) => ({ index: item.index, summary: item.summary }))
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "生成失败");

    const danmaku = normalizeDanmaku(
      data.danmaku?.length ? data.danmaku : parseDanmakuLines(data.text, config.danmakuCount),
      targetIndex
    );
    const patch = {
      summary: data.pageSummary || data.summary || "",
      danmaku,
      status: "ready"
    };
    await updatePage(targetIndex, patch);
    setStatus(`第 ${targetIndex + 1} 页已生成 ${danmaku.length} 条弹幕`);
    return patch;
  }

  async function generateCurrentPage() {
    try {
      setGenerating(true);
      generationStoppedRef.current = false;
      await generatePage(pageIndex);
    } catch (error) {
      await updatePage(pageIndex, { status: "error" });
      setStatus(error.message || "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function generateAllPages() {
    if (!activeWork || !canCall) {
      setStatus("请先选择作品并填写 API 配置");
      return;
    }
    setGenerating(true);
    generationStoppedRef.current = false;
    try {
      for (let index = 0; index < activeWork.pages.length; index += 1) {
        if (generationStoppedRef.current) break;
        const latestWork = activeWorkRef.current || activeWork;
        if (latestWork.pages[index]?.danmaku?.length) continue;
        await generatePage(index);
      }
      setStatus(generationStoppedRef.current ? "已停止批量生成" : "整部作品弹幕生成完成");
    } catch (error) {
      setStatus(error.message || "批量生成中断");
    } finally {
      setGenerating(false);
    }
  }

  async function generateSelectedPages() {
    if (!activeWork || !selectedPages.size || !canCall) {
      setStatus("请先选择页面并填写 API 配置");
      return;
    }
    const targets = Array.from(selectedPages)
      .filter((index) => index >= 0 && index < activeWork.pages.length)
      .sort((a, b) => a - b);
    setGenerating(true);
    generationStoppedRef.current = false;
    try {
      for (const index of targets) {
        if (generationStoppedRef.current) break;
        await generatePage(index);
      }
      setStatus(generationStoppedRef.current ? "已停止生成选中页" : `已生成 ${targets.length} 个选中页`);
    } catch (error) {
      setStatus(error.message || "选中页生成中断");
    } finally {
      setGenerating(false);
    }
  }

  function stopGenerating() {
    generationStoppedRef.current = true;
    setStatus("正在停止批量生成...");
  }

  function stopLongTask() {
    generationStoppedRef.current = true;
    setStatus(isReading ? "正在停止通读..." : "正在停止批量生成...");
  }

  function normalizeDanmaku(items, targetIndex) {
    const source = items.map((item) => (typeof item === "string" ? { text: item } : item)).filter((item) => item.text);
    return source.slice(0, Math.max(1, Number(config.danmakuCount || 10))).map((item, index) => ({
      id: `${targetIndex}-${Date.now()}-${index}`,
      text: String(item.text).slice(0, 34),
      startTime: Number(item.startTime ?? index * 1.35),
      mode: item.mode === "positioned" && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y)) ? "positioned" : "scroll",
      x: Number.isFinite(Number(item.x)) ? Math.min(100, Math.max(0, Number(item.x))) : null,
      y: Number.isFinite(Number(item.y)) ? Math.min(100, Math.max(0, Number(item.y))) : null,
      anchor: String(item.anchor || "").slice(0, 40),
      lane: Number(item.lane ?? index % 8),
      speed: Number(item.speed ?? config.danmakuSpeed ?? 9),
      emotion: item.emotion || "watching",
      style: item.style || config.danmakuStyle || "standard"
    }));
  }

  function clearPlayback() {
    playTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    playTimersRef.current = [];
    setPlaying(false);
    setActiveDanmaku([]);
  }

  function playDanmaku(force = false) {
    if (!force && !isDanmakuEnabled) {
      setStatus("弹幕已关闭");
      return;
    }
    if (!currentPage?.danmaku?.length) {
      setStatus("当前页还没有弹幕，先生成这一页");
      return;
    }
    clearPlayback();
    setPlaying(true);
    currentPage.danmaku.forEach((item, index) => {
      const timer = window.setTimeout(() => {
        setActiveDanmaku((current) => [...current.slice(-36), { ...item, runId: `${Date.now()}-${index}` }]);
      }, Math.max(0, Number(item.startTime || 0) * 1000));
      playTimersRef.current.push(timer);
    });
    const totalMs = Math.max(...currentPage.danmaku.map((item) => Number(item.startTime || 0))) * 1000 + 12000;
    playTimersRef.current.push(window.setTimeout(clearPlayback, totalMs));
  }

  function toggleDanmakuEnabled() {
    if (isDanmakuEnabled) {
      setDanmakuEnabled(false);
      clearPlayback();
      return;
    }
    setDanmakuEnabled(true);
    window.setTimeout(() => {
      if (currentPage?.danmaku?.length) playDanmaku(true);
    }, 0);
  }

  function goPage(nextIndex) {
    if (!activeWork) return;
    setPageIndex(Math.min(Math.max(0, nextIndex), activeWork.pages.length - 1));
    clearPlayback();
  }

  function changeZoom(delta) {
    setZoom((current) => Math.min(maxZoom, Math.max(minZoom, Number((current + delta).toFixed(2)))));
  }

  function resetZoom() {
    setZoom(1);
  }

  function fitPageToScreen(forceFocus = false) {
    if (!currentPage) return;
    window.requestAnimationFrame(() => {
      const image = pageImageRef.current;
      const pageWidth = Number(currentPage.width || image?.naturalWidth || baseReaderWidth);
      const pageHeight = Number(currentPage.height || image?.naturalHeight || baseReaderWidth * 1.45);
      const ratio = pageWidth > 0 ? pageHeight / pageWidth : 1.45;
      const useFocusPadding = forceFocus || isFocusMode;
      const horizontalPadding = useFocusPadding ? 136 : 48;
      const verticalPadding = useFocusPadding ? 48 : 180;
      const availableWidth = Math.max(320, window.innerWidth - horizontalPadding);
      const availableHeight = Math.max(320, window.innerHeight - verticalPadding);
      const fitWidthZoom = availableWidth / baseReaderWidth;
      const fitHeightZoom = availableHeight / (baseReaderWidth * ratio);
      const nextZoom = Math.min(maxZoom, Math.max(minZoom, Math.min(fitWidthZoom, fitHeightZoom)));
      setZoom(Number(nextZoom.toFixed(2)));
    });
  }

  function enterFocusMode() {
    if (!currentPage) return;
    setFocusMode(true);
    setReaderChromeVisible(true);
    fitPageToScreen(true);
  }

  function handleReaderWheel(event) {
    showReaderChrome();
    if (!currentPage || wheelMode !== "page") return;
    if (Math.abs(event.deltaY) < 24) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastWheelPageAtRef.current < 420) return;
    lastWheelPageAtRef.current = now;
    goPage(pageIndex + (event.deltaY > 0 ? 1 : -1));
  }

  function showReaderChrome() {
    setReaderChromeVisible(true);
    if (chromeHideTimerRef.current) window.clearTimeout(chromeHideTimerRef.current);
    if (!isFocusMode) return;
    chromeHideTimerRef.current = window.setTimeout(() => {
      setReaderChromeVisible(false);
    }, 2100);
  }

  function getFramePoint(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100))
    };
  }

  function centerPagePoint(point) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const stage = readerStageRef.current;
        const frame = pageImageRef.current?.closest(".page-frame");
        if (!stage || !frame) return;
        const targetX = frame.offsetLeft + frame.offsetWidth * (point.x / 100);
        const targetY = frame.offsetTop + frame.offsetHeight * (point.y / 100);
        stage.scrollTo({
          left: Math.max(0, targetX - stage.clientWidth / 2),
          top: Math.max(0, targetY - stage.clientHeight / 2),
          behavior: "auto"
        });
      });
    });
  }

  function startPagePress(event) {
    if (!currentPage || !isFocusMode || event.button > 0) return;
    showReaderChrome();
    const point = getFramePoint(event);
    longPressPointRef.current = point;
    longPressActiveRef.current = false;
    longPressZoomRef.current = zoom;
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressActiveRef.current = true;
      suppressPageClickRef.current = true;
      setPressZooming(true);
      setZoom((current) => Math.min(maxZoom, Math.max(current + 0.55, current * 1.75)));
      centerPagePoint(longPressPointRef.current);
    }, 380);
  }

  function movePagePress(event) {
    if (!currentPage) return;
    const point = getFramePoint(event);
    longPressPointRef.current = point;
    if (longPressActiveRef.current) {
      centerPagePoint(point);
    }
  }

  function endPagePress() {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    const wasPressZooming = longPressActiveRef.current;
    longPressActiveRef.current = false;
    if (wasPressZooming) {
      setPressZooming(false);
      setZoom(longPressZoomRef.current);
      centerPagePoint(longPressPointRef.current);
    }
    window.setTimeout(() => {
      suppressPageClickRef.current = false;
    }, 90);
  }

  function handlePageTurnClick(event, nextIndex) {
    if (suppressPageClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    goPage(nextIndex);
  }

  function togglePageSelected(index) {
    setSelectedPages((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectAllPages() {
    if (!activeWork) return;
    setSelectedPages(new Set(activeWork.pages.map((page) => page.index)));
  }

  function selectUngeneratedPages() {
    if (!activeWork) return;
    setSelectedPages(new Set(activeWork.pages.filter((page) => !page.danmaku?.length).map((page) => page.index)));
  }

  function selectCurrentVolumePages() {
    if (!activeWork || !currentPage) return;
    setSelectedPages(new Set(activeWork.pages.filter((page) => page.volumeId === currentPage.volumeId).map((page) => page.index)));
  }

  function clearPageSelection() {
    setSelectedPages(new Set());
  }

  async function sendManualDanmaku(event) {
    event.preventDefault();
    const value = manualInput.trim();
    if (!value || !currentPage) return;
    setManualInput("");
    const manual = normalizeDanmaku(value.split(/\n|[|]/).map((text) => ({ text })), pageIndex);
    await updatePage(pageIndex, { danmaku: [...(currentPage.danmaku || []), ...manual], status: "ready" });
  }

  async function saveMemory() {
    if (!activeWork) return;
    await updateActiveWork((work) => ({
      ...work,
      memory: {
        ...(work.memory || {}),
        notes: memoryDraft,
        updatedAt: Date.now()
      }
    }));
    setStatus("作品记忆已保存");
  }

  const pageStatusItems = activeWork?.pages || [];

  return (
    <main className={`comic-app ${isFocusMode ? "focus-mode" : ""} ${isFocusMode && !isReaderChromeVisible ? "chrome-hidden" : ""}`}>
      <aside className="library-pane">
        <div className="brand">
          <span>AI Watchmate</span>
          <strong>作品弹幕库</strong>
        </div>

        <section className="create-work">
          <input value={newWorkTitle} onChange={(event) => setNewWorkTitle(event.target.value)} placeholder="新作品名称" />
          <button className="primary" onClick={createWork}>
            <Plus size={17} />
            <span>新建</span>
          </button>
        </section>

        <section className="work-list">
          {works.length ? works.map((work) => {
            const done = work.pages.filter((page) => page.danmaku?.length).length;
            return (
              <button
                className={`work-item ${work.id === activeWorkId ? "active" : ""}`}
                key={work.id}
                onClick={() => {
                  setActiveWorkId(work.id);
                  setPageIndex(0);
                  clearPlayback();
                }}
              >
                <BookOpen size={16} />
                <span>
                  <strong>{work.title}</strong>
                  <small>{work.volumes.length} 个文件 · {done}/{work.pages.length} 页</small>
                </span>
              </button>
            );
          }) : <p className="muted">还没有作品。先新建一个作品，或直接导入 PDF 自动创建。</p>}
        </section>

        <button className="primary wide" onClick={openImportDialog} disabled={isImporting || isGenerating}>
          {isImporting ? <Loader2 className="spin" size={18} /> : <FileUp size={18} />}
          <span>导入到当前作品</span>
        </button>
        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept="application/pdf,image/*"
          multiple
          onChange={(event) => importFiles(event.target.files)}
        />

        <section className="book-meta">
          <p>当前作品</p>
          <h1>{activeWork?.title || "尚未选择"}</h1>
          <div className="meta-grid">
            <span>{activeWork ? `${activeWork.pages.length} 页` : "0 页"}</span>
            <span>{generatedCount} 页已生成</span>
            <span>{selectedPages.size} 页已选</span>
          </div>
          {activeWork && (
            <div className="work-manage">
              <input value={workTitleDraft} onChange={(event) => setWorkTitleDraft(event.target.value)} onBlur={renameActiveWork} placeholder="作品名称" />
              <button className="secondary" onClick={renameActiveWork} disabled={!workTitleDraft.trim() || workTitleDraft === activeWork.title}>重命名</button>
              <button className="danger-button" onClick={removeActiveWork} disabled={isGenerating || isImporting}>
                <Trash2 size={15} />
                <span>删除作品</span>
              </button>
            </div>
          )}
        </section>

        <section className="settings-block">
          <div className="section-title">
            <Settings size={15} />
            <span>生成设置</span>
          </div>
          <label>
            Base URL
            <input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} placeholder="https://api.example.com" />
          </label>
          <label>
            API Key
            <input type="password" value={config.apiKey} onChange={(event) => setConfig({ ...config, apiKey: event.target.value })} placeholder={serverConfig.hasServerApiKey ? "使用后端 .env" : "sk-..."} />
          </label>
          <label>
            视觉模型
            <input value={config.visionModel} onChange={(event) => setConfig({ ...config, visionModel: event.target.value })} placeholder="gpt-5.5" />
          </label>
          <label>
            弹幕密度：{config.danmakuCount}
            <input type="range" min="4" max="36" value={config.danmakuCount} onChange={(event) => setConfig({ ...config, danmakuCount: event.target.value })} />
          </label>
        </section>
      </aside>

      <section className="reader-pane">
        <header className="reader-toolbar">
          <div className="status-line">
            <MessageCircle size={16} />
            <span>{status}</span>
          </div>
          <div className="toolbar-actions">
            <button title={isReading ? "停止通读" : "通读整部"} onClick={isReading ? stopLongTask : readWholeWork} disabled={!activeWork?.pages.length || (!isReading && (!canCall || isGenerating))}>
              {isReading ? <Pause size={17} /> : <Brain size={17} />}
              <span>{isReading ? "停止通读" : "通读整部"}</span>
            </button>
            <button title="生成当前页" onClick={generateCurrentPage} disabled={!activeWork?.pages.length || isGenerating || isReading || !canCall}>
              <Wand2 size={17} />
              <span>生成当前页</span>
            </button>
            <button title={isGenerating ? "停止生成" : "生成整部"} onClick={isGenerating ? stopLongTask : generateAllPages} disabled={!activeWork?.pages.length || isReading || (!isGenerating && !canCall)}>
              {isGenerating ? <Pause size={17} /> : <RefreshCcw size={17} />}
              <span>{isGenerating ? "停止" : "生成整部"}</span>
            </button>
            <button title="生成选中页" onClick={generateSelectedPages} disabled={!selectedPages.size || isGenerating || isReading || !canCall}>
              <CheckSquare size={17} />
              <span>生成选中</span>
            </button>
            <button title="播放弹幕" className="accent" onClick={playDanmaku} disabled={!currentPage?.danmaku?.length || isPlaying}>
              <Play size={17} />
              <span>播放弹幕</span>
            </button>
            <button onClick={() => changeZoom(-0.1)} disabled={!currentPage || zoom <= 0.55} title="缩小">
              <ZoomOut size={17} />
            </button>
            <button onClick={fitPageToScreen} disabled={!currentPage} className="zoom-value" title="适应屏幕">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={() => changeZoom(0.1)} disabled={!currentPage || zoom >= 2.4} title="放大">
              <ZoomIn size={17} />
            </button>
            <button title={wheelMode === "page" ? "滚轮翻页" : "滚轮滚动"} onClick={() => setWheelMode((mode) => (mode === "page" ? "scroll" : "page"))} disabled={!currentPage} className={wheelMode === "page" ? "active-tool" : ""}>
              <MousePointerClick size={17} />
              <span>{wheelMode === "page" ? "滚轮翻页" : "滚轮滚动"}</span>
            </button>
            <button title={isDanmakuEnabled ? "弹幕开" : "弹幕关"} onClick={toggleDanmakuEnabled} disabled={!currentPage}>
              {isDanmakuEnabled ? <Eye size={17} /> : <EyeOff size={17} />}
              <span>{isDanmakuEnabled ? "弹幕开" : "弹幕关"}</span>
            </button>
            <button title={isFocusMode ? "管理模式" : "纯净阅读"} onClick={isFocusMode ? () => setFocusMode(false) : enterFocusMode} disabled={!currentPage}>
              <BookOpen size={17} />
              <span>{isFocusMode ? "管理模式" : "纯净阅读"}</span>
            </button>
          </div>
        </header>

        <div
          ref={readerStageRef}
          className={`reader-stage ${wheelMode === "page" ? "page-wheel-mode" : ""}`}
          onWheel={handleReaderWheel}
          onMouseMove={showReaderChrome}
          onPointerDown={showReaderChrome}
          onTouchStart={showReaderChrome}
        >
          {currentPage ? (
            <div
              className={`page-frame ${isPressZooming ? "is-press-zooming" : ""}`}
              style={{
                width: `${Math.round(baseReaderWidth * zoom)}px`,
                maxWidth: zoom <= 1 ? "100%" : "none"
              }}
              onPointerDown={startPagePress}
              onPointerMove={movePagePress}
              onPointerUp={endPagePress}
              onPointerLeave={endPagePress}
              onPointerCancel={endPagePress}
            >
              <button className="page-turn-zone left" onClick={(event) => handlePageTurnClick(event, pageIndex - 1)} disabled={pageIndex === 0} aria-label="上一页" />
              <button className="page-turn-zone right" onClick={(event) => handlePageTurnClick(event, pageIndex + 1)} disabled={!activeWork || pageIndex >= activeWork.pages.length - 1} aria-label="下一页" />
              <img ref={pageImageRef} src={currentPage.image} alt={`第 ${pageIndex + 1} 页`} onLoad={() => { if (isFocusMode) fitPageToScreen(); }} />
              <div className={`danmaku-layer live ${isDanmakuEnabled ? "" : "hidden"}`}>
                {activeDanmaku.map((item) => (
                  <span
                    className={`danmaku-item ${item.mode === "positioned" ? "danmaku-positioned" : ""} danmaku-${item.style || "standard"}`}
                    key={item.runId}
                    style={{
                      left: item.mode === "positioned" ? `${item.x}%` : undefined,
                      top: item.mode === "positioned" ? `${item.y}%` : `${8 + (item.lane % 9) * 9}%`,
                      animationDuration: item.mode === "positioned" ? "5200ms" : `${Math.max(5, Number(item.speed || 9))}s`
                    }}
                  >
                    {item.text}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-reader">
              <Bot size={48} />
              <h2>一个作品可以保存很多 PDF</h2>
              <p>导入后页面、弹幕、摘要和作品记忆都会按作品保存。下次打开应用，可以继续从这个作品接着生成。</p>
            </div>
          )}
          {currentPage && isFocusMode && (
            <div className="focus-controls">
              <button onClick={() => setFocusMode(false)} aria-label="返回管理模式">
                <BookOpen size={18} />
                <span>管理</span>
              </button>
              <button onClick={() => goPage(pageIndex - 1)} disabled={pageIndex === 0} aria-label="上一页">
                <ChevronLeft size={22} />
              </button>
              <button onClick={() => changeZoom(-0.1)} disabled={zoom <= 0.55} aria-label="缩小">
                <ZoomOut size={18} />
              </button>
              <button onClick={fitPageToScreen} className="zoom-chip" title="适应屏幕">
                <Maximize2 size={16} />
                <span>{Math.round(zoom * 100)}%</span>
              </button>
              <button onClick={() => changeZoom(0.1)} disabled={zoom >= 2.4} aria-label="放大">
                <ZoomIn size={18} />
              </button>
              <button className={wheelMode === "page" ? "active" : ""} onClick={() => setWheelMode((mode) => (mode === "page" ? "scroll" : "page"))}>
                <MousePointerClick size={18} />
                <span>{wheelMode === "page" ? "滚轮翻页" : "滚轮滚动"}</span>
              </button>
              <button className={isDanmakuEnabled ? "active" : ""} onClick={toggleDanmakuEnabled}>
                {isDanmakuEnabled ? <Eye size={18} /> : <EyeOff size={18} />}
                <span>{isDanmakuEnabled ? "弹幕开" : "弹幕关"}</span>
              </button>
              <button onClick={() => goPage(pageIndex + 1)} disabled={!activeWork || pageIndex >= activeWork.pages.length - 1} aria-label="下一页">
                <ChevronRight size={22} />
              </button>
            </div>
          )}
        </div>

        <footer className="page-controls">
          <button onClick={() => goPage(pageIndex - 1)} disabled={!activeWork || pageIndex === 0}>
            <ChevronLeft size={18} />
          </button>
          <input
            type="range"
            min="0"
            max={Math.max(0, (activeWork?.pages.length || 1) - 1)}
            value={pageIndex}
            disabled={!activeWork?.pages.length}
            onChange={(event) => goPage(Number(event.target.value))}
          />
          <button onClick={() => goPage(pageIndex + 1)} disabled={!activeWork || pageIndex >= activeWork.pages.length - 1}>
            <ChevronRight size={18} />
          </button>
          <span>{activeWork ? `${pageIndex + 1} / ${activeWork.pages.length}` : "0 / 0"}</span>
        </footer>
      </section>

      <aside className="inspector-pane">
        <section>
          <div className="section-title">
            <BookOpen size={15} />
            <span>页面生成状态</span>
          </div>
          <div className="selection-actions">
            <button onClick={selectAllPages} disabled={!activeWork?.pages.length}>全选</button>
            <button onClick={selectUngeneratedPages} disabled={!activeWork?.pages.length}>未生成</button>
            <button onClick={selectCurrentVolumePages} disabled={!currentPage}>当前文件</button>
            <button onClick={clearPageSelection} disabled={!selectedPages.size}>清空</button>
          </div>
          <button className="primary wide" onClick={generateSelectedPages} disabled={!selectedPages.size || isGenerating || isReading || !canCall}>
            <CheckSquare size={16} />
            <span>生成选中 {selectedPages.size ? `(${selectedPages.size})` : ""}</span>
          </button>
          <div className="page-map">
            {pageStatusItems.length ? pageStatusItems.map((page) => (
              <div
                className={`page-tile ${selectedPages.has(page.index) ? "selected" : ""}`}
                key={page.index}
                title={`${page.volumeTitle} · 第 ${page.sourcePage + 1} 页`}
              >
                <label>
                  <input type="checkbox" checked={selectedPages.has(page.index)} onChange={() => togglePageSelected(page.index)} />
                  <span
                    className={`page-dot ${page.index === pageIndex ? "active" : ""} ${page.danmaku?.length ? "ready" : page.readStatus === "read" ? "read" : page.readStatus === "reading" ? "reading" : page.status || "pending"}`}
                    onClick={() => goPage(page.index)}
                  >
                    {page.index + 1}
                  </span>
                </label>
              </div>
            )) : <p className="muted">导入 PDF 后这里会显示每页是否已生成弹幕。</p>}
          </div>
        </section>

        <section>
          <div className="section-title">
            <MessageCircle size={15} />
            <span>当前页弹幕</span>
          </div>
          <div className="danmaku-list">
            {currentPage?.danmaku?.length ? currentPage.danmaku.map((item) => (
              <div className="danmaku-row" key={item.id}>
                <span>{Number(item.startTime || 0).toFixed(1)}s</span>
                <p>
                  {item.text}
                  {item.mode === "positioned" && <small>{`定位 ${Math.round(item.x)}%, ${Math.round(item.y)}%${item.anchor ? ` · ${item.anchor}` : ""}`}</small>}
                </p>
              </div>
            )) : <p className="muted">当前页还没有弹幕。</p>}
          </div>
        </section>

        <section>
          <div className="section-title">
            <Bot size={15} />
            <span>页面摘要</span>
          </div>
          <p className="summary-text">{currentPage?.summary || "生成弹幕后，这里会保存 AI 对本页的理解。"}</p>
        </section>

        <section>
          <div className="section-title">
            <Sparkles size={15} />
            <span>作品记忆</span>
          </div>
          <textarea value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="记录人物关系、世界观、你的偏好、不要剧透等。生成后续页面时会带上这份作品记忆。" />
          <button className="secondary" onClick={saveMemory} disabled={!activeWork}>
            保存记忆
          </button>
        </section>

        <form className="manual-form" onSubmit={sendManualDanmaku}>
          <textarea value={manualInput} onChange={(event) => setManualInput(event.target.value)} placeholder="手动追加弹幕，一行一条。" />
          <button className="secondary" disabled={!currentPage || !manualInput.trim()}>
            <Send size={16} />
            <span>追加</span>
          </button>
        </form>
      </aside>
    </main>
  );
}

const rootElement = document.getElementById("root");
window.__watchmateRoot ||= createRoot(rootElement);
window.__watchmateRoot.render(<App />);
