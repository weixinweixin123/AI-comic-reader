import React from "react";
import {
  Bot,
  Camera,
  CheckCircle2,
  Eye,
  KeyRound,
  MessageCircle,
  Pause,
  Play,
  Send,
  Settings,
  Sparkles,
  Square
} from "lucide-react";
import { DanmakuLayer, IconButton, LabeledInput, Panel } from "./components.jsx";

export function PreviewPanel({ layout, onMove, onResize, isSharing, config, danmakuItems, videoRef, canvasRef, onStartShare, onStopShare }) {
  return (
    <Panel id="preview" title="屏幕预览" icon={<Eye size={17} />} layout={layout} onMove={onMove} onResize={onResize}>
      <div className="preview-toolbar">
        <div>
          <p>{isSharing ? "已连接共享源" : "等待浏览器授权"}</p>
          <span>{isSharing ? "正在从你选择的窗口读取画面" : "点击相机按钮选择窗口、标签页或屏幕"}</span>
        </div>
        <div className="toolbar-actions">
          <IconButton label="共享屏幕" onClick={onStartShare} disabled={isSharing}>
            <Camera size={17} />
          </IconButton>
          <IconButton label="停止共享" onClick={onStopShare} disabled={!isSharing}>
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
  );
}

export function CompanionPanel({ layout, onMove, onResize, messages, isLoading, canCall, input, onInputChange, onSendMessage, messageListRef }) {
  return (
    <Panel id="companion" title="陪看反应" icon={<Bot size={17} />} layout={layout} onMove={onMove} onResize={onResize}>
      <div className="message-list" ref={messageListRef}>
        {messages.map((message, index) => (
          <div className={`bubble ${message.role}`} key={`${message.role}-${index}`}>
            {message.content}
          </div>
        ))}
        {isLoading && <div className="bubble assistant soft">我在看这一帧...</div>}
      </div>
      <form className="chat-input" onSubmit={onSendMessage}>
        <input
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="问它：刚才发生了什么？该选哪个？"
        />
        <button aria-label="发送" disabled={isLoading || !canCall}>
          <Send size={18} />
        </button>
      </form>
    </Panel>
  );
}

export function ApiPanel({ layout, onMove, onResize, config, setConfig, maskedKey }) {
  return (
    <Panel id="api" title="中转站 API" icon={<KeyRound size={17} />} layout={layout} onMove={onMove} onResize={onResize}>
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
  );
}

export function SettingsPanel({ layout, onMove, onResize, config, setConfig }) {
  return (
    <Panel id="settings" title="陪伴设置" icon={<Settings size={17} />} layout={layout} onMove={onMove} onResize={onResize}>
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
  );
}

export function NotesPanel({
  layout,
  onMove,
  onResize,
  config,
  setConfig,
  screenNotes,
  setScreenNotes,
  workProfiles,
  activeWorkId,
  onSelectProfile,
  onCreateProfile,
  onSaveProfile,
  onDeleteProfile,
  isWatching,
  isSharing,
  isLoading,
  canCall,
  onStartWatching,
  onStopWatching,
  onObserveOnce
}) {
  return (
    <Panel id="notes" title="当前画面补充" icon={<Sparkles size={17} />} layout={layout} onMove={onMove} onResize={onResize}>
      <label className="field">
        <span>作品档案</span>
        <select value={activeWorkId} onChange={(event) => onSelectProfile(event.target.value)}>
          {workProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.workTitle || "未命名作品"}</option>
          ))}
        </select>
      </label>
      <div className="mini-actions">
        <button className="secondary" onClick={onCreateProfile}>新建</button>
        <button className="secondary" onClick={onSaveProfile}>保存</button>
        <button className="secondary danger" onClick={onDeleteProfile}>删除</button>
      </div>
      <label className="field">
        <span>作品名</span>
        <input value={config.workTitle} placeholder="例如：某部动画 / 漫画 / galgame" onChange={(event) => setConfig({ ...config, workTitle: event.target.value })} />
      </label>
      <textarea value={screenNotes} onChange={(event) => setScreenNotes(event.target.value)} placeholder="可选：补充 OCR 文字、角色名、当前作品，或写“不要剧透”。" />
      <div className="watch-actions">
        <button className="primary" onClick={isWatching ? onStopWatching : onStartWatching} disabled={!isSharing || !canCall}>
          {isWatching ? <Pause size={18} /> : <Play size={18} />}
          <span>{isWatching ? "暂停陪看" : "开始陪看"}</span>
        </button>
        <button className="secondary" onClick={onObserveOnce} disabled={!isSharing || !canCall || isLoading}>
          <MessageCircle size={18} />
          <span>观察一次</span>
        </button>
      </div>
    </Panel>
  );
}

export function MemoryPanel({ layout, onMove, onResize, config, setConfig }) {
  return (
    <Panel id="memory" title="剧情记忆" icon={<Bot size={17} />} layout={layout} onMove={onMove} onResize={onResize}>
      <div className="memory-status">
        <CheckCircle2 size={14} />
        <span>{config.autoMemory ? "自动记忆已开启：AI 会在不打断你的情况下追加关键剧情。" : "自动记忆已关闭：只使用你手动写入的内容。"}</span>
      </div>
      <textarea className="memory-textarea" value={config.storyMemory} onChange={(event) => setConfig({ ...config, storyMemory: event.target.value })} placeholder="记录目前剧情进度：已经发生的事件、伏笔、当前冲突。生成陪看/弹幕时会带给 AI。" />
      <textarea className="memory-textarea compact" value={config.characterNotes} onChange={(event) => setConfig({ ...config, characterNotes: event.target.value })} placeholder="角色关系/人设笔记：谁是谁、关系、动机、你的猜测。" />
    </Panel>
  );
}

export function PersonaPanel({ layout, onMove, onResize, config, setConfig }) {
  return (
    <Panel id="persona" title="人设系统" icon={<Sparkles size={17} />} layout={layout} onMove={onMove} onResize={onResize}>
      <textarea className="memory-textarea compact" value={config.personaPrompt} onChange={(event) => setConfig({ ...config, personaPrompt: event.target.value })} placeholder="AI 同伴的人设提示词。" />
      <textarea className="memory-textarea compact" value={config.danmakuPrompt} onChange={(event) => setConfig({ ...config, danmakuPrompt: event.target.value })} placeholder="弹幕风格提示词。" />
      <textarea className="memory-textarea compact" value={config.userPrefs} onChange={(event) => setConfig({ ...config, userPrefs: event.target.value })} placeholder="用户偏好：不要剧透、少分析、多吐槽等。" />
    </Panel>
  );
}
