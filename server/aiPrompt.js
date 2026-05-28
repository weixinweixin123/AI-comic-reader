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
