import React from "react";
import { Bot, GripVertical, Radio, Square } from "lucide-react";
import { defaultLayout } from "./config.js";

export function DanmakuLayer({ items }) {
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

export function DanmakuOverlayView({ items, editing }) {
  return (
    <main className={`danmaku-overlay-shell ${editing ? "editing" : ""}`}>
      <div className="danmaku-region-hint">
        {editing ? "编辑弹幕区域：拖动此处移动，拖窗口边缘调整大小；7 秒后自动穿透" : ""}
      </div>
      <DanmakuLayer items={items} />
    </main>
  );
}

export function FloatingView({ state }) {
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

export function Panel({ id, title, icon, layout, onMove, onResize, children }) {
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

export function LabeledInput({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}
