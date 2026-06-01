export function buildMessages({ persona, cadence, danmakuMode, danmakuCount, image, screenNotes, autoMemory, memory, userMessage, history }) {
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
        "如果只是桌面、菜单、重复画面、无剧情变化，memoryPatch 内的数组都留空，不要硬写记忆。",
        "请只输出 JSON，不要 Markdown，不要代码块。格式如下：",
        "{\"text\":\"给用户看的陪看反应或弹幕，多条弹幕用换行分隔\",\"memoryPatch\":{\"storyEvents\":[{\"summary\":\"新增剧情进展，20-60字\",\"importance\":\"low|medium|high\",\"confidence\":\"certain|inferred|uncertain\",\"tags\":[\"可选标签\"]}],\"characterUpdates\":[{\"name\":\"角色名\",\"fact\":\"新增角色事实或关系，20-60字\",\"confidence\":\"certain|inferred|uncertain\",\"relationships\":[{\"target\":\"相关角色\",\"type\":\"关系类型\",\"note\":\"关系说明\"}]}],\"openQuestions\":[{\"question\":\"未解决伏笔或疑点\",\"relatedCharacters\":[\"角色名\"],\"evidence\":\"来自当前画面的证据\"}],\"shortTerm\":[{\"summary\":\"刚刚发生的短期上下文\"}],\"workSummary\":\"可选：作品总览更新\",\"currentArcSummary\":\"可选：当前阶段摘要\"}}"
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

export function parseAssistantOutput(rawText, expectMemory) {
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
    characterNotesAppend: String(patch.characterNotesAppend || "").trim().slice(0, 160),
    storyEvents: sanitizeList(patch.storyEvents, (item) => ({
      summary: String(item.summary || item.text || "").trim().slice(0, 160),
      importance: normalizeEnum(item.importance, ["low", "medium", "high"], "medium"),
      confidence: normalizeEnum(item.confidence, ["certain", "inferred", "uncertain"], "certain"),
      tags: sanitizeStringList(item.tags, 6)
    })).filter((item) => item.summary),
    characterUpdates: sanitizeList(patch.characterUpdates, (item) => ({
      name: String(item.name || item.character || "").trim().slice(0, 40),
      fact: String(item.fact || item.summary || item.description || "").trim().slice(0, 160),
      confidence: normalizeEnum(item.confidence, ["certain", "inferred", "uncertain"], "certain"),
      relationships: sanitizeList(item.relationships, (rel) => ({
        target: String(rel.target || rel.name || "").trim().slice(0, 40),
        type: String(rel.type || rel.relation || "").trim().slice(0, 32),
        note: String(rel.note || rel.summary || "").trim().slice(0, 120)
      })).filter((rel) => rel.target || rel.type || rel.note).slice(0, 4)
    })).filter((item) => item.name || item.fact),
    openQuestions: sanitizeList(patch.openQuestions, (item) => ({
      question: String(item.question || item.text || "").trim().slice(0, 160),
      relatedCharacters: sanitizeStringList(item.relatedCharacters, 6),
      evidence: String(item.evidence || "").trim().slice(0, 160)
    })).filter((item) => item.question),
    shortTerm: sanitizeList(patch.shortTerm, (item) => ({
      summary: String(item.summary || item.text || item || "").trim().slice(0, 140)
    })).filter((item) => item.summary),
    workSummary: String(patch.workSummary || "").trim().slice(0, 240),
    currentArcSummary: String(patch.currentArcSummary || "").trim().slice(0, 240)
  };
}

function sanitizeList(value, mapper) {
  return Array.isArray(value) ? value.slice(0, 12).map((item) => mapper(item || {})) : [];
}

function sanitizeStringList(value, max) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim().slice(0, 40)).filter(Boolean).slice(0, max)
    : [];
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function stripJsonNoise(text) {
  return String(text || "")
    .replace(/```json|```/g, "")
    .trim() || "我看到了，但这次有点不知道该怎么吐槽。";
}

function buildMemoryBlock(memory = {}) {
  const book = memory.memoryBook || {};
  const lines = [
    memory.workTitle ? `当前作品：${memory.workTitle}` : "",
    memory.storyMemory ? `剧情记忆：${memory.storyMemory}` : "",
    memory.characterNotes ? `角色关系/人设笔记：${memory.characterNotes}` : "",
    book.summaries?.work ? `作品总览：${book.summaries.work}` : "",
    book.summaries?.currentArc ? `当前阶段：${book.summaries.currentArc}` : "",
    formatMemoryItems("最近剧情事件", book.timeline, "summary"),
    formatMemoryItems("重要事件", book.importantEvents, "summary"),
    formatCharacters(book.characters),
    formatMemoryItems("未解伏笔", book.openQuestions, "question"),
    formatMemoryItems("短期上下文", book.recent, "summary")
  ].filter(Boolean);

  return lines.length ? `本地记忆：\n${lines.join("\n")}` : "";
}

function formatMemoryItems(label, items, key) {
  if (!Array.isArray(items) || !items.length) return "";
  return `${label}：\n${items.slice(0, 8).map((item) => `- ${item[key]}`).join("\n")}`;
}

function formatCharacters(characters) {
  if (!Array.isArray(characters) || !characters.length) return "";
  return `角色记忆：\n${characters.slice(0, 8).map((item) => {
    const facts = Array.isArray(item.facts) ? item.facts.slice(-3).join("；") : "";
    return `- ${item.name}${facts ? `：${facts}` : ""}`;
  }).join("\n")}`;
}
export function buildComicDanmakuMessages({
  title,
  pageIndex,
  totalPages,
  image,
  density,
  personaPrompt,
  danmakuPrompt,
  userPrefs,
  previousPages
}) {
  const history = Array.isArray(previousPages) && previousPages.length
    ? previousPages.map((page) => `第 ${Number(page.index) + 1} 页：${page.summary}`).join("\n")
    : "暂无前文摘要。";
  const count = Math.max(4, Math.min(36, Number(density || 10)));
  const system = [
    "你是一个漫画陪看弹幕编剧，目标是提前读懂单页漫画，并生成像观众同步观看时发出的自然弹幕。",
    "你可以吐槽、猜测、共情、提醒用户注意细节，但不要编造后续剧情，不要剧透，不要说自己是 AI。",
    "弹幕必须短，像真实观众写的即时反应；避免解释腔，避免把画面内容机械复述成说明书。",
    "如果画面信息不足，就保持不确定表达。",
    personaPrompt ? `陪伴人格：${personaPrompt}` : "",
    userPrefs ? `用户偏好：${userPrefs}` : "",
    danmakuPrompt ? `弹幕风格：${danmakuPrompt}` : ""
  ].filter(Boolean).join("\n");

  const prompt = [
    `作品：${title || "未命名漫画"}`,
    `当前页：第 ${Number(pageIndex) + 1} / ${Number(totalPages || 1)} 页`,
    `前文摘要：\n${history}`,
    "",
    `请为当前页生成 ${count} 条弹幕，并给出本页摘要。`,
    "返回严格 JSON，不要 Markdown，不要代码块。格式如下：",
    "位置要求：每条弹幕都可以返回 mode。mode 为 positioned 时，必须带 x/y 百分比坐标和 anchor，用来贴近人物脸旁、对白框旁、道具旁或分镜空白处；mode 为 scroll 时按普通横向弹幕播放。x/y 范围 0-100，不要遮住关键脸部和对白。",
    JSON.stringify({
      pageSummary: "用 1-2 句话概括本页发生了什么，以及值得后续记住的信息。",
      danmaku: [
        {
          text: "短弹幕，6-18 个字为佳",
          startTime: 0.8,
          mode: "positioned|scroll",
          x: 64,
          y: 28,
          anchor: "人物脸旁|对白框旁|道具旁|分镜空白处|全局反应",
          lane: 0,
          speed: 9,
          emotion: "surprise|funny|tension|soft|detail",
          style: "standard|soft|bold"
        }
      ]
    })
  ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: image } }
      ]
    }
  ];
}

export function parseComicDanmakuOutput(rawText, fallbackCount = 10) {
  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    return {
      pageSummary: "",
      danmaku: String(rawText || "")
        .split(/\n|[|]/)
        .map((text, index) => ({
          text: text.trim().slice(0, 34),
          startTime: index * 1.3,
          mode: "scroll",
          x: null,
          y: null,
          anchor: "",
          lane: index % 8,
          speed: 9,
          emotion: "watching",
          style: "standard"
        }))
        .filter((item) => item.text)
        .slice(0, fallbackCount)
    };
  }

  const source = Array.isArray(parsed.danmaku) ? parsed.danmaku : [];
  const danmaku = source.map((item, index) => ({
    text: String(item?.text || item?.content || "").trim().slice(0, 34),
    startTime: Number.isFinite(Number(item?.startTime)) ? Number(item.startTime) : index * 1.3,
    mode: item?.mode === "positioned" ? "positioned" : "scroll",
    x: clampPercent(item?.x),
    y: clampPercent(item?.y),
    anchor: String(item?.anchor || "").trim().slice(0, 40),
    lane: Number.isFinite(Number(item?.lane)) ? Number(item.lane) : index % 8,
    speed: Number.isFinite(Number(item?.speed)) ? Number(item.speed) : 9,
    emotion: ["surprise", "funny", "tension", "soft", "detail", "watching"].includes(item?.emotion) ? item.emotion : "watching",
    style: ["standard", "soft", "bold"].includes(item?.style) ? item.style : "standard"
  })).filter((item) => item.text).slice(0, Math.max(1, fallbackCount));

  return {
    pageSummary: String(parsed.pageSummary || parsed.summary || "").trim().slice(0, 260),
    danmaku
  };
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
}

export function buildComicReadMessages({
  title,
  pageIndex,
  totalPages,
  image,
  previousPages,
  workMemory,
  userPrefs
}) {
  const history = Array.isArray(previousPages) && previousPages.length
    ? previousPages.map((page) => `第 ${Number(page.index) + 1} 页：${page.summary}`).join("\n")
    : "暂无已读页面。";
  const system = [
    "你是漫画作品记忆整理助手。你的任务是通读漫画页面，建立作品级记忆，而不是生成弹幕。",
    "只记录当前页明确出现或强烈暗示的信息。不要编造后续剧情，不要剧透，不要搜索原作。",
    "关注剧情进展、人物关系、情绪变化、反复出现的道具/地点/伏笔，以及未来生成弹幕时可能需要引用的上下文。",
    userPrefs ? `用户偏好：${userPrefs}` : ""
  ].filter(Boolean).join("\n");

  const prompt = [
    `作品：${title || "未命名漫画"}`,
    `当前页：第 ${Number(pageIndex) + 1} / ${Number(totalPages || 1)} 页`,
    `已有作品记忆：\n${workMemory || "暂无。"}`,
    `已读前文摘要：\n${history}`,
    "",
    "请阅读当前页并返回严格 JSON，不要 Markdown，不要代码块。",
    JSON.stringify({
      pageSummary: "本页发生了什么，1-2 句话。",
      memoryPatch: {
        story: ["新增剧情事实，短句"],
        characters: ["人物关系、状态或动机变化，短句"],
        foreshadowing: ["疑点、伏笔、反复出现的道具或台词"],
        callbacks: ["与前文有关联的地方；不确定就写可能关联"]
      },
      important: false
    })
  ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: image } }
      ]
    }
  ];
}

export function parseComicReadOutput(rawText) {
  const parsed = parseJsonObject(rawText) || {};
  const patch = parsed.memoryPatch && typeof parsed.memoryPatch === "object" ? parsed.memoryPatch : {};
  return {
    pageSummary: String(parsed.pageSummary || parsed.summary || "").trim().slice(0, 300),
    memoryPatch: {
      story: readStringList(patch.story),
      characters: readStringList(patch.characters),
      foreshadowing: readStringList(patch.foreshadowing),
      callbacks: readStringList(patch.callbacks)
    },
    important: Boolean(parsed.important)
  };
}

function readStringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").replace(/\s+/g, " ").trim().slice(0, 160)).filter(Boolean).slice(0, 8)
    : [];
}
