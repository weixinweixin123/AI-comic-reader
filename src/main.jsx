import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  GripVertical,
  MessageCircle,
  MonitorUp,
  Radio,
  RefreshCcw,
  Sparkles
} from "lucide-react";
import { DanmakuOverlayView, FloatingView } from "./components.jsx";
import { defaultConfig, defaultLayout, panelMin } from "./config.js";
import { clamp, parseDanmakuLines } from "./danmaku.js";
import { applyStructuredMemoryPatch, buildMemoryPayload, compactMemoryConfig } from "./memory/engine.js";
import { ApiPanel, CompanionPanel, MemoryPanel, NotesPanel, PersonaPanel, PreviewPanel, SettingsPanel } from "./panels.jsx";
import { loadConfig, loadFloatingState, loadLayout, loadWorkProfiles, makeDefaultWorkProfile, pickMemoryFields } from "./storage.js";
import "./styles.css";

const apiBase = window.location.protocol === "file:" ? "http://127.0.0.1:8787" : "";
const isFloatingView = new URLSearchParams(window.location.search).get("float") === "1";
const isOverlayView = new URLSearchParams(window.location.search).get("overlay") === "1";

if (isOverlayView) {
  document.documentElement.classList.add("overlay-window");
  document.body?.classList.add("overlay-window");
}

function apiUrl(path) {
  return `${apiBase}${path}`;
}

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const danmakuDripTimerRef = useRef(null);
  const danmakuQueueRef = useRef([]);
  const messageListRef = useRef(null);
  const boardRef = useRef(null);
  const dragRef = useRef(null);
  const loadingRef = useRef(false);
  const watchingRef = useRef(false);
  const lastFrameSignatureRef = useRef(null);

  const [layout, setLayout] = useState(() => loadLayout());
  const [config, setConfig] = useState(() => loadConfig());
  const [workProfiles, setWorkProfiles] = useState(() => loadWorkProfiles(loadConfig()));
  const [activeWorkId, setActiveWorkId] = useState(() => localStorage.getItem("watchmate-active-work") || "default");
  const [serverConfig, setServerConfig] = useState({ hasServerApiKey: false });
  const [isSharing, setSharing] = useState(false);
  const [isWatching, setWatching] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [status, setStatus] = useState("等待开始");
  const [screenNotes, setScreenNotes] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "我在。把要看的窗口共享给我，然后点“观察一次”或“开始陪看”。"
    }
  ]);
  const [floatingState, setFloatingState] = useState(() => loadFloatingState());
  const [danmakuItems, setDanmakuItems] = useState([]);
  const [overlayItems, setOverlayItems] = useState([]);
  const [isDanmakuOverlayOpen, setDanmakuOverlayOpen] = useState(false);
  const [overlayEditing, setOverlayEditing] = useState(isOverlayView);

  useEffect(() => {
    document.documentElement.classList.toggle("overlay-window", isOverlayView);
    document.body.classList.toggle("overlay-window", isOverlayView);
    return () => {
      document.documentElement.classList.remove("overlay-window");
      document.body.classList.remove("overlay-window");
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("watchmate-config", JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem("watchmate-work-profiles", JSON.stringify(workProfiles));
  }, [workProfiles]);

  useEffect(() => {
    localStorage.setItem("watchmate-active-work", activeWorkId);
  }, [activeWorkId]);

  useEffect(() => {
    setWorkProfiles((current) => current.map((profile) => (
      profile.id === activeWorkId ? { ...profile, ...pickMemoryFields(config), updatedAt: Date.now() } : profile
    )));
  }, [config.workTitle, config.storyMemory, config.characterNotes, config.userPrefs, config.personaPrompt, config.danmakuPrompt, config.memoryBook]);

  useEffect(() => {
    localStorage.setItem("watchmate-layout", JSON.stringify(layout));
  }, [layout]);

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
    return () => stopShare();
  }, []);

  useEffect(() => {
    return () => {
      if (danmakuDripTimerRef.current) window.clearInterval(danmakuDripTimerRef.current);
    };
  }, []);

  useEffect(() => {
    loadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    watchingRef.current = isWatching;
  }, [isWatching]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, isLoading]);

  useEffect(() => {
    const onOverlayState = (event) => setDanmakuOverlayOpen(Boolean(event.detail));
    window.addEventListener("watchmate-overlay-state", onOverlayState);
    return () => window.removeEventListener("watchmate-overlay-state", onOverlayState);
  }, []);

  useEffect(() => {
    const onResetLayout = (event) => setLayout(event.detail || defaultLayout);
    window.addEventListener("watchmate-reset-layout", onResetLayout);
    return () => window.removeEventListener("watchmate-reset-layout", onResetLayout);
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel("watchmate-floating");
    if (isFloatingView) {
      channel.onmessage = (event) => {
        if (event.data?.type === "watchmate-state") {
          setFloatingState(event.data.payload);
        }
      };
      return () => channel.close();
    }

    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    const payload = {
      status,
      isWatching,
      isLoading,
      latest: latestAssistant?.content || "",
      updatedAt: Date.now()
    };
    localStorage.setItem("watchmate-floating-state", JSON.stringify(payload));
    channel.postMessage({ type: "watchmate-state", payload });
    return () => channel.close();
  }, [messages, status, isWatching, isLoading]);

  useEffect(() => {
    if (!isOverlayView) return undefined;
    const channel = new BroadcastChannel("watchmate-danmaku");
    const removeIpcListener = window.watchmate?.onDanmaku?.((items) => {
      addOverlayDanmaku(items || []);
    });
    const removeEditListener = window.watchmate?.onDanmakuEdit?.((editing) => {
      setOverlayEditing(Boolean(editing));
    });
    channel.onmessage = (event) => {
      if (event.data?.type === "danmaku") {
        addOverlayDanmaku(event.data.items || []);
      }
    };
    return () => {
      channel.close();
      removeIpcListener?.();
      removeEditListener?.();
    };
  }, []);

  function addOverlayDanmaku(items) {
    setOverlayItems((current) => [...current.slice(-40), ...items]);
    window.setTimeout(() => {
      setOverlayItems((current) => current.filter((item) => !items.some((next) => next.id === item.id)));
    }, 15000);
  }

  useEffect(() => {
    function onPointerMove(event) {
      const active = dragRef.current;
      if (!active || !boardRef.current) return;

      const board = boardRef.current.getBoundingClientRect();
      const min = panelMin[active.id];
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;

      setLayout((current) => {
        const next = { ...current };
        const original = active.original;
        if (active.type === "move") {
          next[active.id] = {
            ...original,
            x: clamp(original.x + dx, 0, Math.max(0, board.width - min.w)),
            y: clamp(original.y + dy, 0, Math.max(0, board.height - min.h))
          };
        } else {
          const width = clamp(original.w + dx, min.w, Math.max(min.w, board.width - original.x));
          const height = clamp(original.h + dy, min.h, Math.max(min.h, board.height - original.y));
          next[active.id] = { ...original, w: width, h: height };
        }
        return next;
      });
    }

    function onPointerUp() {
      dragRef.current = null;
      document.body.classList.remove("is-dragging-panel");
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const canCall = config.baseUrl && (config.apiKey || serverConfig.hasServerApiKey) && config.model;

  async function startShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      setSharing(true);
      setStatus("正在预览屏幕");
      stream.getVideoTracks()[0].addEventListener("ended", stopShare);
    } catch (error) {
      setStatus(error.message || "屏幕共享被取消");
    }
  }

  function stopShare() {
    stopWatching();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSharing(false);
    setStatus("已停止共享");
  }

  function startWatching() {
    if (!isSharing || !canCall) {
      setStatus("请先共享屏幕并填写 API 配置");
      return;
    }
    setWatching(true);
    watchingRef.current = true;
    lastFrameSignatureRef.current = null;
    setStatus("陪看中");
    captureAndAsk();
    timerRef.current = window.setInterval(captureAndAsk, Number(config.interval) * 1000);
  }

  function stopWatching() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setWatching(false);
    watchingRef.current = false;
  }

  async function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return "";

    const maxWidth = 900;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.68);
  }

  function getFrameSignature() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;

    const sampleCanvas = document.createElement("canvas");
    const width = 24;
    const height = 14;
    sampleCanvas.width = width;
    sampleCanvas.height = height;
    const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    const points = [];

    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3 / 16);
      points.push(gray);
    }

    return points;
  }

  function getFrameDiff(previous, current) {
    if (!previous || !current || previous.length !== current.length) return Infinity;
    let total = 0;
    for (let index = 0; index < current.length; index += 1) {
      total += Math.abs(current[index] - previous[index]);
    }
    return total / current.length;
  }

  async function callCompanion({ userMessage = "", force = false } = {}) {
    if (!canCall) {
      setStatus("API 配置不完整");
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setStatus(userMessage ? "正在回复你" : "正在观察画面");
    try {
      let image = "";
      if (config.sendImage) {
        const signature = getFrameSignature();
        const diff = getFrameDiff(lastFrameSignatureRef.current, signature);
        lastFrameSignatureRef.current = signature;

        if (!force && !userMessage && config.skipUnchanged && diff < Number(config.changeThreshold)) {
          setStatus("画面未变化，保持安静");
          return;
        }

        image = await captureFrame();
      }
      const body = {
        ...config,
        image,
        screenNotes,
        autoMemory: config.autoMemory && !userMessage,
        memory: buildMemoryPayload(config),
        userMessage,
        history: messages.slice(-8)
      };
      const response = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "请求失败");
      setMessages((prev) => [...prev, { role: "assistant", content: data.text }]);
      applyMemoryPatch(data.memoryPatch);
      if (config.danmakuMode) {
        pushDanmaku(data.text, Number(config.danmakuCount) || 8);
      }
      setStatus(watchingRef.current ? "陪看中" : "待命");
    } catch (error) {
      setMessages((prev) => [...prev, { role: "assistant", content: `连接出了点问题：${error.message}` }]);
      setStatus("请求失败");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  function applyMemoryPatch(patch) {
    if (!config.autoMemory || !patch || typeof patch !== "object") return;
    const hasLegacy = Boolean(patch.storyMemoryAppend?.trim()) || Boolean(patch.characterNotesAppend?.trim());
    const hasStructured = ["storyEvents", "characterUpdates", "openQuestions", "shortTerm"].some((key) => Array.isArray(patch[key]) && patch[key].length);
    const hasSummary = Boolean(patch.workSummary?.trim()) || Boolean(patch.currentArcSummary?.trim());
    if (!hasLegacy && !hasStructured && !hasSummary) return;

    setConfig((current) => {
      return applyStructuredMemoryPatch(current, patch);
    });
    setStatus("已自动更新剧情记忆");
  }

  async function captureAndAsk() {
    if (loadingRef.current) return;
    await callCompanion();
  }

  async function sendMessage(event) {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: value }]);
    await callCompanion({ userMessage: value, force: true });
  }

  function pushDanmaku(text, count) {
    const lines = parseDanmakuLines(text, count);
    const now = Date.now();
    const items = lines.map((line, index) => ({
      id: `${now}-${index}-${Math.random().toString(16).slice(2)}`,
      text: line,
      top: 8 + ((index * 11) % Number(config.danmakuLaneSpread || 82)),
      duration: Math.max(4, Number(config.danmakuSpeed || 9) + (index % 4) - 1),
      delay: index * 0.18,
      fontSize: Number(config.danmakuFontSize || 22),
      opacity: Number(config.danmakuOpacity || 92) / 100,
      style: config.danmakuStyle || "standard"
    }));

    if (config.smoothDanmaku) {
      danmakuQueueRef.current = [...danmakuQueueRef.current, ...items].slice(-120);
      startDanmakuDrip();
      return;
    }

    emitDanmakuItems(items);
  }

  function startDanmakuDrip() {
    if (danmakuDripTimerRef.current) return;

    danmakuDripTimerRef.current = window.setInterval(() => {
      const queue = danmakuQueueRef.current;
      if (!queue.length) {
        window.clearInterval(danmakuDripTimerRef.current);
        danmakuDripTimerRef.current = null;
        return;
      }

      const batchSize = queue.length > 36 ? 3 : queue.length > 14 ? 2 : 1;
      const batch = queue.splice(0, batchSize).map((item, index) => ({
        ...item,
        id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
        delay: index * 0.22
      }));
      danmakuQueueRef.current = queue;
      emitDanmakuItems(batch);
    }, Number(config.danmakuDripInterval || 900));
  }

  function emitDanmakuItems(items) {
    setDanmakuItems((current) => [...current.slice(-30), ...items]);
    new BroadcastChannel("watchmate-danmaku").postMessage({ type: "danmaku", items });
    window.watchmate?.sendDanmaku?.(items);
    window.setTimeout(() => {
      setDanmakuItems((current) => current.filter((item) => !items.some((next) => next.id === item.id)));
    }, 14000);
  }

  function bringToFront(id) {
    setLayout((current) => {
      const maxZ = Math.max(...Object.values(current).map((item) => item.z || 1));
      return { ...current, [id]: { ...current[id], z: maxZ + 1 } };
    });
  }

  function startPanelMove(event, id) {
    if (event.button !== 0) return;
    bringToFront(id);
    dragRef.current = {
      type: "move",
      id,
      startX: event.clientX,
      startY: event.clientY,
      original: layout[id]
    };
    document.body.classList.add("is-dragging-panel");
  }

  function startPanelResize(event, id) {
    event.preventDefault();
    event.stopPropagation();
    bringToFront(id);
    dragRef.current = {
      type: "resize",
      id,
      startX: event.clientX,
      startY: event.clientY,
      original: layout[id]
    };
    document.body.classList.add("is-dragging-panel");
  }

  function selectWorkProfile(id) {
    const profile = workProfiles.find((item) => item.id === id);
    if (!profile) return;
    setActiveWorkId(id);
    setConfig((current) => ({ ...current, ...pickMemoryFields(profile) }));
  }

  function createWorkProfile() {
    const name = window.prompt("新作品名称", config.workTitle || "新的作品");
    if (!name) return;
    const id = `work-${Date.now()}`;
    const profile = {
      id,
      ...pickMemoryFields({ ...config, workTitle: name }),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    setWorkProfiles((current) => [...current, profile]);
    setActiveWorkId(id);
    setConfig((current) => ({ ...current, ...pickMemoryFields(profile) }));
  }

  function saveCurrentWorkProfile() {
    setWorkProfiles((current) => current.map((profile) => (
      profile.id === activeWorkId ? { ...profile, ...pickMemoryFields(config), updatedAt: Date.now() } : profile
    )));
    setStatus("作品记忆已保存");
  }

  function compactCurrentMemory() {
    setConfig((current) => compactMemoryConfig(current, { keepRecent: 28 }));
    setStatus("已压缩当前作品记忆");
  }

  function deleteCurrentWorkProfile() {
    if (activeWorkId === "default") {
      setStatus("默认作品不能删除");
      return;
    }
    const nextProfiles = workProfiles.filter((profile) => profile.id !== activeWorkId);
    const next = nextProfiles[0] || makeDefaultWorkProfile(config);
    setWorkProfiles(nextProfiles.length ? nextProfiles : [next]);
    setActiveWorkId(next.id);
    setConfig((current) => ({ ...current, ...pickMemoryFields(next) }));
  }

  const maskedKey = useMemo(() => {
    if (!config.apiKey && serverConfig.hasServerApiKey) return "使用后端 .env";
    if (!config.apiKey) return "未填写";
    return `${config.apiKey.slice(0, 5)}...${config.apiKey.slice(-4)}`;
  }, [config.apiKey, serverConfig.hasServerApiKey]);

  if (isFloatingView) {
    return <FloatingView state={floatingState} />;
  }

  if (isOverlayView) {
    return <DanmakuOverlayView items={overlayItems} editing={overlayEditing} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI Watchmate</p>
          <h1>陪看工作台</h1>
        </div>
        <div className="topbar-actions">
          <div className="status-pill">
            <Radio size={15} />
            <span>{status}</span>
          </div>
          <button className="ghost-button" onClick={resetLayout} title="恢复默认布局">
            <RefreshCcw size={16} />
            <span>重置布局</span>
          </button>
          <button className="ghost-button" onClick={openFloatingWindow} title="打开悬浮窗">
            <MonitorUp size={16} />
            <span>悬浮窗</span>
          </button>
          <button className={`ghost-button ${isDanmakuOverlayOpen ? "active" : ""}`} onClick={toggleDanmakuOverlay} title="打开或关闭屏幕弹幕区域">
            <Sparkles size={16} />
            <span>{isDanmakuOverlayOpen ? "弹幕区域已开" : "屏幕弹幕"}</span>
          </button>
          {isDanmakuOverlayOpen && (
            <button className="ghost-button active soft-active" onClick={editDanmakuOverlay} title="显示边框并临时允许拖动缩放">
              <GripVertical size={16} />
              <span>调整区域</span>
            </button>
          )}
          <button className="ghost-button" onClick={() => pushDanmaku("测试弹幕来啦|这条应该飘在屏幕上|如果你看到了说明覆盖层正常", 6)} title="发送测试弹幕">
            <MessageCircle size={16} />
            <span>测试弹幕</span>
          </button>
        </div>
      </header>

      <section className="panel-board" ref={boardRef}>
        <PreviewPanel
          layout={layout}
          onMove={startPanelMove}
          onResize={startPanelResize}
          isSharing={isSharing}
          config={config}
          danmakuItems={danmakuItems}
          videoRef={videoRef}
          canvasRef={canvasRef}
          onStartShare={startShare}
          onStopShare={stopShare}
        />
        <CompanionPanel
          layout={layout}
          onMove={startPanelMove}
          onResize={startPanelResize}
          messages={messages}
          isLoading={isLoading}
          canCall={canCall}
          input={input}
          onInputChange={setInput}
          onSendMessage={sendMessage}
          messageListRef={messageListRef}
        />
        <ApiPanel layout={layout} onMove={startPanelMove} onResize={startPanelResize} config={config} setConfig={setConfig} maskedKey={maskedKey} />
        <SettingsPanel layout={layout} onMove={startPanelMove} onResize={startPanelResize} config={config} setConfig={setConfig} />
        <NotesPanel
          layout={layout}
          onMove={startPanelMove}
          onResize={startPanelResize}
          config={config}
          setConfig={setConfig}
          screenNotes={screenNotes}
          setScreenNotes={setScreenNotes}
          workProfiles={workProfiles}
          activeWorkId={activeWorkId}
          onSelectProfile={selectWorkProfile}
          onCreateProfile={createWorkProfile}
          onSaveProfile={saveCurrentWorkProfile}
          onDeleteProfile={deleteCurrentWorkProfile}
          onCompactMemory={compactCurrentMemory}
          isWatching={isWatching}
          isSharing={isSharing}
          isLoading={isLoading}
          canCall={canCall}
          onStartWatching={startWatching}
          onStopWatching={stopWatching}
          onObserveOnce={() => callCompanion({ force: true })}
        />
        <MemoryPanel layout={layout} onMove={startPanelMove} onResize={startPanelResize} config={config} setConfig={setConfig} />
        <PersonaPanel layout={layout} onMove={startPanelMove} onResize={startPanelResize} config={config} setConfig={setConfig} />
      </section>
    </main>
  );
}

function resetLayout() {
  const boardWidth = document.querySelector(".panel-board")?.clientWidth || 1480;
  if (boardWidth >= 1680) {
    const gap = 18;
    const x = 24;
    const usable = boardWidth - x * 2;
    const previewW = Math.floor(usable * 0.42);
    const midW = Math.floor(usable * 0.25);
    const rightW = usable - previewW - midW - gap * 2;
    const wide = {
      preview: { x, y: 18, w: previewW, h: 430, z: 1 },
      companion: { x: x + previewW + gap, y: 18, w: midW, h: 430, z: 2 },
      memory: { x: x + previewW + midW + gap * 2, y: 18, w: rightW, h: 430, z: 1 },
      api: { x, y: 468, w: Math.floor(previewW * 0.52), h: 238, z: 1 },
      settings: { x: x + Math.floor(previewW * 0.52) + gap, y: 468, w: previewW - Math.floor(previewW * 0.52) - gap, h: 238, z: 1 },
      notes: { x: x + previewW + gap, y: 468, w: midW, h: 300, z: 1 },
      persona: { x: x + previewW + midW + gap * 2, y: 468, w: rightW, h: 300, z: 1 }
    };
    window.dispatchEvent(new CustomEvent("watchmate-reset-layout", { detail: wide }));
    return;
  }

  const gap = 16;
  const x = 24;
  const usable = Math.max(900, boardWidth - x * 2);
  const leftW = Math.max(520, Math.floor(usable * 0.58));
  const rightW = Math.max(340, usable - leftW - gap);
  const bottomW = Math.floor((usable - gap) / 2);
  const compact = {
    preview: { x, y: 18, w: leftW, h: 420, z: 1 },
    companion: { x: x + leftW + gap, y: 18, w: rightW, h: 420, z: 2 },
    api: { x, y: 458, w: bottomW, h: 230, z: 1 },
    settings: { x: x + bottomW + gap, y: 458, w: bottomW, h: 230, z: 1 },
    notes: { x, y: 708, w: bottomW, h: 260, z: 1 },
    memory: { x: x + bottomW + gap, y: 708, w: bottomW, h: 360, z: 1 },
    persona: { x, y: 988, w: usable, h: 240, z: 1 }
  };
  window.dispatchEvent(new CustomEvent("watchmate-reset-layout", { detail: compact }));
}

function openFloatingWindow() {
  if (window.watchmate?.openFloatingWindow) {
    window.watchmate.openFloatingWindow();
    return;
  }
  window.open(`${window.location.origin}${window.location.pathname}?float=1`, "watchmate-floating", "width=360,height=220");
}

async function toggleDanmakuOverlay() {
  if (window.watchmate?.toggleDanmakuOverlay) {
    const opened = await window.watchmate.toggleDanmakuOverlay();
    const event = new CustomEvent("watchmate-overlay-state", { detail: opened });
    window.dispatchEvent(event);
  }
}

async function editDanmakuOverlay() {
  await window.watchmate?.editDanmakuOverlay?.();
}

const rootElement = document.getElementById("root");
window.__watchmateRoot ||= createRoot(rootElement);
window.__watchmateRoot.render(<App />);
