import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  Camera,
  CheckCircle2,
  Eye,
  GripVertical,
  KeyRound,
  MessageCircle,
  MonitorUp,
  Pause,
  Play,
  Radio,
  RefreshCcw,
  Send,
  Settings,
  Sparkles,
  Square
} from "lucide-react";
import "./styles.css";

const defaultConfig = {
  baseUrl: "",
  apiKey: "",
  model: "gpt-5.5",
  visionModel: "gpt-5.5",
  persona: "温柔但会吐槽的宅友",
  cadence: "适中，看到关键画面才说",
  interval: 8,
  sendImage: true,
  skipUnchanged: true,
  changeThreshold: 7,
  danmakuMode: false,
  danmakuCount: 8,
  danmakuSpeed: 9,
  danmakuFontSize: 22,
  danmakuOpacity: 92,
  danmakuLaneSpread: 82,
  danmakuStyle: "standard",
  smoothDanmaku: true,
  danmakuDripInterval: 900,
  autoMemory: true,
  workTitle: "",
  storyMemory: "",
  characterNotes: "",
  userPrefs: "不要剧透；少重复；弹幕要像不同观众。",
  personaPrompt: "你像一个坐在旁边一起看的二次元朋友，温柔、会吐槽、有好奇心，不抢戏。",
  danmakuPrompt: "弹幕像 B 站观众实时发言：短、自然、有梗但不吵；多人视角要明显不同。"
};

const defaultLayout = {
  preview: { x: 24, y: 18, w: 760, h: 500, z: 1 },
  companion: { x: 808, y: 18, w: 420, h: 500, z: 2 },
  api: { x: 24, y: 538, w: 380, h: 248, z: 1 },
  settings: { x: 424, y: 538, w: 380, h: 248, z: 1 },
  notes: { x: 824, y: 538, w: 404, h: 248, z: 1 },
  memory: { x: 1040, y: 18, w: 420, h: 360, z: 1 },
  persona: { x: 1040, y: 400, w: 420, h: 386, z: 1 }
};

const panelMin = {
  preview: { w: 420, h: 300 },
  companion: { w: 320, h: 320 },
  api: { w: 320, h: 220 },
  settings: { w: 320, h: 220 },
  notes: { w: 320, h: 220 },
  memory: { w: 340, h: 260 },
  persona: { w: 340, h: 280 }
};

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
  }, [config.workTitle, config.storyMemory, config.characterNotes, config.userPrefs, config.personaPrompt, config.danmakuPrompt]);

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
        memory: {
          workTitle: config.workTitle,
          storyMemory: config.storyMemory,
          characterNotes: config.characterNotes,
          userPrefs: config.userPrefs,
          personaPrompt: config.personaPrompt,
          danmakuPrompt: config.danmakuPrompt
        },
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
    const hasStory = Boolean(patch.storyMemoryAppend?.trim());
    const hasCharacters = Boolean(patch.characterNotesAppend?.trim());
    if (!hasStory && !hasCharacters) return;

    setConfig((current) => {
      const storyMemory = hasStory
        ? appendMemoryLine(current.storyMemory, patch.storyMemoryAppend, "剧情")
        : current.storyMemory;
      const characterNotes = hasCharacters
        ? appendMemoryLine(current.characterNotes, patch.characterNotesAppend, "角色")
        : current.characterNotes;
      return { ...current, storyMemory, characterNotes };
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
          <button className="ghost-button" onClick={() => setLayout(defaultLayout)} title="恢复默认布局">
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
        <Panel id="preview" title="屏幕预览" icon={<Eye size={17} />} layout={layout} onMove={startPanelMove} onResize={startPanelResize}>
          <div className="preview-toolbar">
            <div>
              <p>{isSharing ? "已连接共享源" : "等待浏览器授权"}</p>
              <span>{isSharing ? "正在从你选择的窗口读取画面" : "点击相机按钮选择窗口、标签页或屏幕"}</span>
            </div>
            <div className="toolbar-actions">
              <IconButton label="共享屏幕" onClick={startShare} disabled={isSharing}>
                <Camera size={17} />
              </IconButton>
              <IconButton label="停止共享" onClick={stopShare} disabled={!isSharing}>
                <Square size={17} />
              </IconButton>
            </div>
          </div>
          <div className="screen-frame">
            <video ref={videoRef} autoPlay playsInline muted />
            {config.danmakuMode && <DanmakuLayer items={danmakuItems} />}
            {!isSharing && (
              <div className="empty-state">
                <Eye size={32} />
                <p>选择番剧、漫画、游戏窗口后，我会从这里观察当前画面。</p>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} hidden />
        </Panel>

        <Panel id="companion" title="陪看反应" icon={<Bot size={17} />} layout={layout} onMove={startPanelMove} onResize={startPanelResize}>
          <div className="message-list" ref={messageListRef}>
            {messages.map((message, index) => (
              <div className={`bubble ${message.role}`} key={`${message.role}-${index}`}>
                {message.content}
              </div>
            ))}
            {isLoading && <div className="bubble assistant soft">我在看这一帧...</div>}
          </div>
          <form className="chat-input" onSubmit={sendMessage}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="问它：刚才发生了什么？该选哪个？"
            />
            <button aria-label="发送" disabled={isLoading || !canCall}>
              <Send size={18} />
            </button>
          </form>
        </Panel>

        <Panel id="api" title="中转站 API" icon={<KeyRound size={17} />} layout={layout} onMove={startPanelMove} onResize={startPanelResize}>
          <div className="field-grid">
            <LabeledInput label="Base URL" value={config.baseUrl} placeholder="https://your-proxy.example.com" onChange={(baseUrl) => setConfig({ ...config, baseUrl })} />
            <LabeledInput label="API Key" type="password" value={config.apiKey} placeholder="sk-..." onChange={(apiKey) => setConfig({ ...config, apiKey })} />
            <LabeledInput label="聊天模型" value={config.model} placeholder="gpt-5.5" onChange={(model) => setConfig({ ...config, model })} />
            <LabeledInput label="视觉模型" value={config.visionModel} placeholder="gpt-5.5" onChange={(visionModel) => setConfig({ ...config, visionModel })} />
          </div>
          <div className="key-state">
            <CheckCircle2 size={15} />
            <span>{maskedKey}</span>
          </div>
          <p className="persist-note">API 配置会自动保存在本机，下次打开不用重新输入。</p>
        </Panel>

        <Panel id="settings" title="陪伴设置" icon={<Settings size={17} />} layout={layout} onMove={startPanelMove} onResize={startPanelResize}>
          <label className="field">
            <span>人格</span>
            <select value={config.persona} onChange={(event) => setConfig({ ...config, persona: event.target.value })}>
              <option>温柔但会吐槽的宅友</option>
              <option>冷静推理型剧情分析员</option>
              <option>情绪价值拉满的同伴</option>
              <option>毒舌但不冒犯的损友</option>
            </select>
          </label>
          <label className="field">
            <span>节奏</span>
            <select value={config.cadence} onChange={(event) => setConfig({ ...config, cadence: event.target.value })}>
              <option>适中，看到关键画面才说</option>
              <option>安静，只在我问时多说</option>
              <option>活跃，像一起追番的朋友</option>
            </select>
          </label>
          <label className="field">
            <span>观察间隔：{config.interval} 秒</span>
            <input type="range" min="3" max="20" value={config.interval} onChange={(event) => setConfig({ ...config, interval: event.target.value })} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={config.sendImage} onChange={(event) => setConfig({ ...config, sendImage: event.target.checked })} />
            <span>发送截图给视觉模型</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={config.skipUnchanged} onChange={(event) => setConfig({ ...config, skipUnchanged: event.target.checked })} />
            <span>画面不变时保持安静</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={config.autoMemory} onChange={(event) => setConfig({ ...config, autoMemory: event.target.checked })} />
            <span>自动更新剧情记忆</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={config.danmakuMode} onChange={(event) => setConfig({ ...config, danmakuMode: event.target.checked })} />
            <span>弹幕模式</span>
          </label>
          <label className="field">
            <span>弹幕数量：{config.danmakuCount}</span>
            <input type="range" min="4" max="60" value={config.danmakuCount} onChange={(event) => setConfig({ ...config, danmakuCount: event.target.value })} />
          </label>
          <label className="field">
            <span>弹幕速度：{config.danmakuSpeed} 秒</span>
            <input type="range" min="4" max="16" value={config.danmakuSpeed} onChange={(event) => setConfig({ ...config, danmakuSpeed: event.target.value })} />
          </label>
          <label className="field">
            <span>弹幕字号：{config.danmakuFontSize}px</span>
            <input type="range" min="14" max="34" value={config.danmakuFontSize} onChange={(event) => setConfig({ ...config, danmakuFontSize: event.target.value })} />
          </label>
          <label className="field">
            <span>弹幕透明度：{config.danmakuOpacity}%</span>
            <input type="range" min="35" max="100" value={config.danmakuOpacity} onChange={(event) => setConfig({ ...config, danmakuOpacity: event.target.value })} />
          </label>
          <label className="field">
            <span>轨道范围：{config.danmakuLaneSpread}%</span>
            <input type="range" min="30" max="92" value={config.danmakuLaneSpread} onChange={(event) => setConfig({ ...config, danmakuLaneSpread: event.target.value })} />
          </label>
          <label className="field">
            <span>弹幕样式</span>
            <select value={config.danmakuStyle} onChange={(event) => setConfig({ ...config, danmakuStyle: event.target.value })}>
              <option value="standard">标准</option>
              <option value="soft">柔和</option>
              <option value="bold">醒目</option>
            </select>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={config.smoothDanmaku} onChange={(event) => setConfig({ ...config, smoothDanmaku: event.target.checked })} />
            <span>流畅弹幕蓄水池</span>
          </label>
          <label className="field">
            <span>出弹间隔：{config.danmakuDripInterval}ms</span>
            <input type="range" min="250" max="1800" step="50" value={config.danmakuDripInterval} onChange={(event) => setConfig({ ...config, danmakuDripInterval: event.target.value })} />
          </label>
        </Panel>

        <Panel id="notes" title="当前画面补充" icon={<Sparkles size={17} />} layout={layout} onMove={startPanelMove} onResize={startPanelResize}>
          <label className="field">
            <span>作品档案</span>
            <select value={activeWorkId} onChange={(event) => selectWorkProfile(event.target.value)}>
              {workProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.workTitle || "未命名作品"}</option>
              ))}
            </select>
          </label>
          <div className="mini-actions">
            <button className="secondary" onClick={createWorkProfile}>新建</button>
            <button className="secondary" onClick={saveCurrentWorkProfile}>保存</button>
            <button className="secondary danger" onClick={deleteCurrentWorkProfile}>删除</button>
          </div>
          <label className="field">
            <span>作品名</span>
            <input value={config.workTitle} placeholder="例如：某部动画 / 漫画 / galgame" onChange={(event) => setConfig({ ...config, workTitle: event.target.value })} />
          </label>
          <textarea value={screenNotes} onChange={(event) => setScreenNotes(event.target.value)} placeholder="可选：补充 OCR 文字、角色名、当前作品，或写“不要剧透”。" />
          <div className="watch-actions">
            <button className="primary" onClick={isWatching ? stopWatching : startWatching} disabled={!isSharing || !canCall}>
              {isWatching ? <Pause size={18} /> : <Play size={18} />}
              <span>{isWatching ? "暂停陪看" : "开始陪看"}</span>
            </button>
            <button className="secondary" onClick={() => callCompanion({ force: true })} disabled={!isSharing || !canCall || isLoading}>
              <MessageCircle size={18} />
              <span>观察一次</span>
            </button>
          </div>
        </Panel>

        <Panel id="memory" title="剧情记忆" icon={<Bot size={17} />} layout={layout} onMove={startPanelMove} onResize={startPanelResize}>
          <div className="memory-status">
            <CheckCircle2 size={14} />
            <span>{config.autoMemory ? "自动记忆已开启：AI 会在不打断你的情况下追加关键剧情。" : "自动记忆已关闭：只使用你手动写入的内容。"}</span>
          </div>
          <textarea className="memory-textarea" value={config.storyMemory} onChange={(event) => setConfig({ ...config, storyMemory: event.target.value })} placeholder="记录目前剧情进度：已经发生的事件、伏笔、当前冲突。生成陪看/弹幕时会带给 AI。" />
          <textarea className="memory-textarea compact" value={config.characterNotes} onChange={(event) => setConfig({ ...config, characterNotes: event.target.value })} placeholder="角色关系/人设笔记：谁是谁、关系、动机、你的猜测。" />
        </Panel>

        <Panel id="persona" title="人设系统" icon={<Sparkles size={17} />} layout={layout} onMove={startPanelMove} onResize={startPanelResize}>
          <textarea className="memory-textarea compact" value={config.personaPrompt} onChange={(event) => setConfig({ ...config, personaPrompt: event.target.value })} placeholder="AI 同伴的人设提示词。" />
          <textarea className="memory-textarea compact" value={config.danmakuPrompt} onChange={(event) => setConfig({ ...config, danmakuPrompt: event.target.value })} placeholder="弹幕风格提示词。" />
          <textarea className="memory-textarea compact" value={config.userPrefs} onChange={(event) => setConfig({ ...config, userPrefs: event.target.value })} placeholder="用户偏好：不要剧透、少分析、多吐槽等。" />
        </Panel>
      </section>
    </main>
  );
}

function DanmakuLayer({ items }) {
  return (
    <div className="danmaku-layer" aria-hidden="true">
      {items.map((item) => (
        <span
          className={`danmaku-item danmaku-${item.style || "standard"}`}
          key={item.id}
          style={{
            top: `${item.top}%`,
            animationDuration: `${item.duration}s`,
            animationDelay: `${item.delay}s`,
            fontSize: item.fontSize ? `${item.fontSize}px` : undefined,
            opacity: item.opacity ?? undefined
          }}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

function DanmakuOverlayView({ items, editing }) {
  return (
    <main className={`danmaku-overlay-shell ${editing ? "editing" : ""}`}>
      <div className="danmaku-region-hint">
        {editing ? "编辑弹幕区域：拖动此处移动，拖窗口边缘调整大小；7 秒后自动穿透" : ""}
      </div>
      <DanmakuLayer items={items} />
    </main>
  );
}

function FloatingView({ state }) {
  const latest = state?.latest || "我在这里。主窗口开始陪看后，新的反应会同步到这里。";
  const status = state?.isLoading ? "观察中" : state?.status || "待命";

  return (
    <main className="float-shell">
      <header className="float-titlebar">
        <div>
          <p>AI Watchmate</p>
          <span>{status}</span>
        </div>
        <div className="float-actions">
          <button title="切换置顶" onClick={() => window.watchmate?.toggleFloatingPin?.()}>
            <Radio size={14} />
          </button>
          <button title="关闭悬浮窗" onClick={() => window.watchmate?.closeFloatingWindow?.()}>
            <Square size={14} />
          </button>
        </div>
      </header>
      <section className="float-message">
        <Bot size={18} />
        <p>{latest}</p>
      </section>
    </main>
  );
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

function Panel({ id, title, icon, layout, onMove, onResize, children }) {
  const position = layout[id] || defaultLayout[id];
  return (
    <section
      className={`desk-panel panel-${id}`}
      style={{
        left: position.x,
        top: position.y,
        width: position.w,
        height: position.h,
        zIndex: position.z
      }}
    >
      <div className="panel-heading" onPointerDown={(event) => onMove(event, id)}>
        <div className="panel-title">
          {icon}
          <span>{title}</span>
        </div>
        <GripVertical size={17} className="drag-mark" />
      </div>
      <div className="panel-body">{children}</div>
      <button className="resize-handle" aria-label={`调整${title}大小`} onPointerDown={(event) => onResize(event, id)} />
    </section>
  );
}

function LabeledInput({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}

function loadConfig() {
  try {
    return { ...defaultConfig, ...JSON.parse(localStorage.getItem("watchmate-config") || "{}") };
  } catch {
    return defaultConfig;
  }
}

function loadLayout() {
  try {
    return { ...defaultLayout, ...JSON.parse(localStorage.getItem("watchmate-layout") || "{}") };
  } catch {
    return defaultLayout;
  }
}

function loadFloatingState() {
  try {
    return JSON.parse(localStorage.getItem("watchmate-floating-state") || "{}");
  } catch {
    return {};
  }
}

function loadWorkProfiles(config) {
  try {
    const stored = JSON.parse(localStorage.getItem("watchmate-work-profiles") || "[]");
    if (Array.isArray(stored) && stored.length) return stored;
  } catch {
    // Fall through to default profile.
  }
  return [makeDefaultWorkProfile(config)];
}

function makeDefaultWorkProfile(config) {
  return {
    id: "default",
    ...pickMemoryFields(config),
    workTitle: config.workTitle || "默认作品",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function pickMemoryFields(source) {
  return {
    workTitle: source.workTitle || "",
    storyMemory: source.storyMemory || "",
    characterNotes: source.characterNotes || "",
    userPrefs: source.userPrefs || "",
    personaPrompt: source.personaPrompt || "",
    danmakuPrompt: source.danmakuPrompt || ""
  };
}

function appendMemoryLine(existing, text, label) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  if (!line) return existing || "";

  const normalized = String(existing || "");
  if (normalized.includes(line)) return normalized;

  const stamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const next = `${normalized.trim() ? `${normalized.trim()}\n` : ""}- [${stamp}] ${label}：${line}`;
  return trimMemoryText(next, 2600);
}

function trimMemoryText(text, maxLength) {
  if (String(text || "").length <= maxLength) return text;
  const lines = String(text).split("\n");
  while (lines.join("\n").length > maxLength && lines.length > 4) {
    lines.shift();
  }
  return lines.join("\n");
}

function parseDanmakuLines(text, count) {
  const cleaned = String(text || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*[-*\d.、]+/gm, "")
    .trim();
  const parts = cleaned
    .split(/\n|[|｜]/)
    .map((part) => part.replace(/^["'“”「」\s]+|["'“”「」\s]+$/g, "").trim())
    .filter(Boolean);

  const source = parts.length > 1
    ? parts
    : cleaned.split(/[。！？!?]/).map((part) => part.trim()).filter(Boolean);

  const fallback = [
    "这画面有点意思",
    "先别急，像是在铺垫",
    "这个表情很微妙",
    "我感觉这里有伏笔",
    "这句台词可以留意",
    "气氛开始不对了",
    "这个选择有点危险",
    "好像要进入关键段落了"
  ];

  const uniqueSource = Array.from(new Set(source.map((line) => line.slice(0, 26))));
  const merged = uniqueSource.length ? uniqueSource : fallback;
  const prefix = ["前排：", "路人A：", "小声：", "盲猜：", "懂了：", ""];
  const suffix = ["", "哈哈", "这味对了", "有点妙", "先记一下", "别急"];

  return Array.from({ length: count }, (_, index) => {
    const line = merged[index % merged.length];
    if (merged.length === 1) {
      return `${prefix[index % prefix.length]}${line}${suffix[index % suffix.length]}`.slice(0, 34);
    }
    return `${prefix[index % prefix.length]}${line}`.slice(0, 34);
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const rootElement = document.getElementById("root");
window.__watchmateRoot ||= createRoot(rootElement);
window.__watchmateRoot.render(<App />);
