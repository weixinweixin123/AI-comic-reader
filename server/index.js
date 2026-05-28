import express from "express";
import "dotenv/config";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

export function createServer() {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "12mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      baseUrl: process.env.AI_BASE_URL || "",
      model: process.env.AI_CHAT_MODEL || "",
      visionModel: process.env.AI_VISION_MODEL || "",
      hasServerApiKey: Boolean(process.env.AI_API_KEY)
    });
  });

  app.use(express.static(path.join(projectRoot, "dist")));

  app.post("/api/chat", async (req, res) => {
    try {
      const {
        baseUrl,
        apiKey,
        model,
        visionModel,
        persona,
        cadence,
        danmakuMode,
        danmakuCount,
        image,
        screenNotes,
        autoMemory,
        memory = {},
        userMessage,
        history = []
      } = req.body || {};

      const resolvedBaseUrl = baseUrl || process.env.AI_BASE_URL;
      const resolvedApiKey = apiKey || process.env.AI_API_KEY;
      const resolvedModel = model || process.env.AI_CHAT_MODEL;
      const resolvedVisionModel = visionModel || process.env.AI_VISION_MODEL;

      if (!resolvedBaseUrl || !resolvedApiKey || !resolvedModel) {
        return res.status(400).json({ error: "请先填写 Base URL、API Key 和模型名，或在本地 .env 中配置。" });
      }

      const endpoint = buildChatEndpoint(resolvedBaseUrl);
      const activeModel = image && resolvedVisionModel ? resolvedVisionModel : resolvedModel;
      const messages = buildMessages({
        persona,
        cadence,
        danmakuMode,
        danmakuCount,
        image,
        screenNotes,
        autoMemory,
        memory,
        userMessage,
        history
      });

      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolvedApiKey}`
        },
        body: JSON.stringify({
          model: activeModel,
          messages,
          temperature: userMessage ? 0.75 : danmakuMode ? 0.82 : 0.65,
          max_tokens: autoMemory
            ? (danmakuMode ? Math.min(1200, Math.max(420, Number(danmakuCount || 8) * 28)) : 460)
            : danmakuMode ? Math.min(900, Math.max(220, Number(danmakuCount || 8) * 24)) : userMessage ? 260 : 120
        })
      });

      const data = await upstream.json().catch(() => ({}));

      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: data?.error?.message || data?.message || "中转站请求失败。",
          detail: data
        });
      }

      const rawText = data?.choices?.[0]?.message?.content?.trim();
      const parsed = parseAssistantOutput(rawText, Boolean(autoMemory));
      res.json(parsed);
    } catch (error) {
      res.status(500).json({ error: error.message || "本地代理异常。" });
    }
  });

  return app;
}

export function startServer(port = Number(process.env.PORT || 8787)) {
  const app = createServer();
  return app.listen(port, "127.0.0.1", () => {
    console.log(`AI Watchmate proxy listening on http://127.0.0.1:${port}`);
  });
}

function buildMessages({ persona, cadence, danmakuMode, danmakuCount, image, screenNotes, autoMemory, memory, userMessage, history }) {
  const memoryBlock = buildMemoryBlock(memory);
  const system = [
    "你是一个陪用户看动漫、galgame、漫画和视觉小说的 AI 同伴。",
    "你的目标是像坐在旁边的朋友一样陪看：有自己的反应，会吐槽、猜测、共情，但不剧透。",
    "除非用户明确要求，否则不要搜索或编造原作后续剧情。",
    "你要优先参考剧情记忆、角色关系和用户偏好；如果当前画面与记忆冲突，以当前画面为准并保持不确定表达。",
    "回复保持短、自然、有临场感。普通陪看评论控制在 1 句，用户主动提问时控制在 1-3 句。",
    `人格选项：${persona || "温柔但会吐槽的宅友"}`,
    `发言节奏：${cadence || "适中，看到关键画面才说"}`,
    memory?.personaPrompt ? `自定义同伴人设：${memory.personaPrompt}` : "",
    memory?.userPrefs ? `用户偏好和禁忌：${memory.userPrefs}` : "",
    memoryBlock
  ].filter(Boolean).join("\n");

  const compactHistory = history.slice(-8).map((item) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: String(item.content || "").slice(0, 1000)
  }));

  const basePrompt = danmakuMode && !userMessage
    ? [
        `请观察当前画面，模拟 ${danmakuCount || 8} 条 B 站风格弹幕。`,
        "要求：像不同观众发的短弹幕，每条 6-18 个字，轻松、有临场感、不剧透。",
        "每一条必须表达不同角度，不要重复同一句，不要描述“我能看到你的桌面/屏幕”。",
        memory?.danmakuPrompt ? `自定义弹幕风格：${memory.danmakuPrompt}` : "",
        "只输出弹幕文本，每行一条，不要编号。",
        `当前画面补充：${screenNotes || "没有额外文字。"}`
      ].filter(Boolean).join("\n")
    : userMessage
    ? `用户正在和你聊天。用户说：${userMessage}\n\n当前画面补充：${screenNotes || "没有额外文字。"}`
    : `请观察当前画面，生成一句陪看反应。可以吐槽、猜测人物动机、指出台词情绪或提醒用户留意细节。当前画面补充：${screenNotes || "没有额外文字。"}`;

  const prompt = autoMemory && !userMessage
    ? [
        basePrompt,
        "",
        "同时判断当前画面是否出现值得长期记住的新信息。",
        "只记已经在画面中明确出现或高度暗示的信息，不要剧透、不要编原作后续。",
        "如果只是桌面、菜单、重复画面、无剧情变化，memoryPatch 字段留空字符串。",
        "请只输出 JSON，不要 Markdown，不要代码块。格式如下：",
        "{\"text\":\"给用户看的陪看反应或弹幕，多条弹幕用换行分隔\",\"memoryPatch\":{\"storyMemoryAppend\":\"新增剧情进展，20-60字，没有则空\",\"characterNotesAppend\":\"新增角色关系/人设，20-60字，没有则空\"}}"
      ].join("\n")
    : basePrompt;

  const content = image
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: image } }
      ]
    : prompt;

  return [
    { role: "system", content: system },
    ...compactHistory,
    { role: "user", content }
  ];
}

function parseAssistantOutput(rawText, expectMemory) {
  const fallbackText = rawText || "我看到了，但这次有点不知道该怎么吐槽。";
  if (!expectMemory) return { text: fallbackText };

  const parsed = parseJsonObject(fallbackText);
  if (!parsed) return { text: stripJsonNoise(fallbackText), memoryPatch: null };

  return {
    text: String(parsed.text || "").trim() || "我看到了，但这次有点不知道该怎么吐槽。",
    memoryPatch: sanitizeMemoryPatch(parsed.memoryPatch)
  };
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sanitizeMemoryPatch(patch = {}) {
  return {
    storyMemoryAppend: String(patch.storyMemoryAppend || "").trim().slice(0, 160),
    characterNotesAppend: String(patch.characterNotesAppend || "").trim().slice(0, 160)
  };
}

function stripJsonNoise(text) {
  return String(text || "")
    .replace(/```json|```/g, "")
    .trim() || "我看到了，但这次有点不知道该怎么吐槽。";
}

function buildMemoryBlock(memory = {}) {
  const lines = [
    memory.workTitle ? `当前作品：${memory.workTitle}` : "",
    memory.storyMemory ? `剧情记忆：${memory.storyMemory}` : "",
    memory.characterNotes ? `角色关系/人设笔记：${memory.characterNotes}` : ""
  ].filter(Boolean);

  return lines.length ? `本地记忆：\n${lines.join("\n")}` : "";
}

function buildChatEndpoint(baseUrl) {
  const normalized = String(baseUrl).replace(/\/+$/, "");
  return normalized.endsWith("/v1")
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entryUrl) {
  startServer();
}
