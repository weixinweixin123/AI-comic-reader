import express from "express";
import "dotenv/config";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildComicDanmakuMessages, buildComicReadMessages, buildMessages, parseAssistantOutput, parseComicDanmakuOutput, parseComicReadOutput } from "./aiPrompt.js";

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

  app.post("/api/comic/danmaku", async (req, res) => {
    try {
      const {
        baseUrl,
        apiKey,
        model,
        visionModel,
        title,
        pageIndex,
        totalPages,
        image,
        density,
        personaPrompt,
        danmakuPrompt,
        userPrefs,
        previousPages = []
      } = req.body || {};

      const resolvedBaseUrl = baseUrl || process.env.AI_BASE_URL;
      const resolvedApiKey = apiKey || process.env.AI_API_KEY;
      const resolvedModel = visionModel || model || process.env.AI_VISION_MODEL || process.env.AI_CHAT_MODEL;

      if (!resolvedBaseUrl || !resolvedApiKey || !resolvedModel) {
        return res.status(400).json({ error: "请先填写 Base URL、API Key 和视觉模型，或在本地 .env 中配置。" });
      }

      if (!image) {
        return res.status(400).json({ error: "缺少漫画页面图像。" });
      }

      const endpoint = buildChatEndpoint(resolvedBaseUrl);
      const messages = buildComicDanmakuMessages({
        title,
        pageIndex,
        totalPages,
        image,
        density,
        personaPrompt,
        danmakuPrompt,
        userPrefs,
        previousPages
      });

      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolvedApiKey}`
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages,
          temperature: 0.82,
          max_tokens: Math.min(1400, Math.max(420, Number(density || 10) * 46))
        })
      });

      const data = await upstream.json().catch(() => ({}));

      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: data?.error?.message || data?.message || "漫画弹幕生成请求失败。",
          detail: data
        });
      }

      const rawText = data?.choices?.[0]?.message?.content?.trim();
      res.json(parseComicDanmakuOutput(rawText, Number(density || 10)));
    } catch (error) {
      res.status(500).json({ error: error.message || "漫画弹幕生成异常。" });
    }
  });

  app.post("/api/comic/read", async (req, res) => {
    try {
      const {
        baseUrl,
        apiKey,
        model,
        visionModel,
        title,
        pageIndex,
        totalPages,
        image,
        previousPages = [],
        workMemory = "",
        userPrefs = ""
      } = req.body || {};

      const resolvedBaseUrl = baseUrl || process.env.AI_BASE_URL;
      const resolvedApiKey = apiKey || process.env.AI_API_KEY;
      const resolvedModel = visionModel || model || process.env.AI_VISION_MODEL || process.env.AI_CHAT_MODEL;

      if (!resolvedBaseUrl || !resolvedApiKey || !resolvedModel) {
        return res.status(400).json({ error: "请先填写 Base URL、API Key 和视觉模型，或在本地 .env 中配置。" });
      }

      if (!image) {
        return res.status(400).json({ error: "缺少漫画页面图像。" });
      }

      const endpoint = buildChatEndpoint(resolvedBaseUrl);
      const messages = buildComicReadMessages({
        title,
        pageIndex,
        totalPages,
        image,
        previousPages,
        workMemory,
        userPrefs
      });

      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolvedApiKey}`
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages,
          temperature: 0.35,
          max_tokens: 720
        })
      });

      const data = await upstream.json().catch(() => ({}));

      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: data?.error?.message || data?.message || "漫画阅读请求失败。",
          detail: data
        });
      }

      const rawText = data?.choices?.[0]?.message?.content?.trim();
      res.json(parseComicReadOutput(rawText));
    } catch (error) {
      res.status(500).json({ error: error.message || "漫画阅读异常。" });
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
