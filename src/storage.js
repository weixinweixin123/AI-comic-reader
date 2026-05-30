import { defaultConfig, defaultLayout } from "./config.js";
import { createMemoryBook } from "./memory/engine.js";

export function loadConfig() {
  try {
    return { ...defaultConfig, ...JSON.parse(localStorage.getItem("watchmate-config") || "{}") };
  } catch {
    return defaultConfig;
  }
}

export function loadLayout() {
  try {
    return { ...defaultLayout, ...JSON.parse(localStorage.getItem("watchmate-layout") || "{}") };
  } catch {
    return defaultLayout;
  }
}

export function loadFloatingState() {
  try {
    return JSON.parse(localStorage.getItem("watchmate-floating-state") || "{}");
  } catch {
    return {};
  }
}

export function loadWorkProfiles(config) {
  try {
    const stored = JSON.parse(localStorage.getItem("watchmate-work-profiles") || "[]");
    if (Array.isArray(stored) && stored.length) return stored;
  } catch {
    // Fall through to default profile.
  }
  return [makeDefaultWorkProfile(config)];
}

export function makeDefaultWorkProfile(config) {
  return {
    id: "default",
    ...pickMemoryFields(config),
    workTitle: config.workTitle || "默认作品",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function pickMemoryFields(source) {
  return {
    workTitle: source.workTitle || "",
    storyMemory: source.storyMemory || "",
    characterNotes: source.characterNotes || "",
    userPrefs: source.userPrefs || "",
    personaPrompt: source.personaPrompt || "",
    danmakuPrompt: source.danmakuPrompt || "",
    memoryBook: createMemoryBook(source)
  };
}

export function appendMemoryLine(existing, text, label) {
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
