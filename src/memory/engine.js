const MEMORY_VERSION = 1;
const MAX_EVENTS = 80;
const MAX_CHARACTERS = 60;
const MAX_QUESTIONS = 50;
const MAX_SHORT_TERM = 16;

export function createMemoryBook(source = {}) {
  const existing = source.memoryBook && typeof source.memoryBook === "object" ? source.memoryBook : {};
  return normalizeMemoryBook({
    version: MEMORY_VERSION,
    shortTerm: existing.shortTerm || [],
    timeline: existing.timeline || legacyLinesToEvents(source.storyMemory, "legacy-story"),
    characters: existing.characters || legacyLinesToCharacters(source.characterNotes),
    openQuestions: existing.openQuestions || [],
    summaries: {
      work: existing.summaries?.work || "",
      currentArc: existing.summaries?.currentArc || ""
    },
    stats: {
      writes: Number(existing.stats?.writes || 0),
      lastUpdatedAt: existing.stats?.lastUpdatedAt || source.updatedAt || null
    }
  });
}

export function normalizeMemoryBook(book = {}) {
  return {
    version: MEMORY_VERSION,
    shortTerm: normalizeList(book.shortTerm).slice(-MAX_SHORT_TERM),
    timeline: normalizeList(book.timeline).slice(-MAX_EVENTS),
    characters: mergeCharacters(normalizeList(book.characters)).slice(-MAX_CHARACTERS),
    openQuestions: normalizeList(book.openQuestions).slice(-MAX_QUESTIONS),
    summaries: {
      work: String(book.summaries?.work || ""),
      currentArc: String(book.summaries?.currentArc || "")
    },
    stats: {
      writes: Number(book.stats?.writes || 0),
      lastUpdatedAt: book.stats?.lastUpdatedAt || null
    }
  };
}

export function applyStructuredMemoryPatch(config, patch) {
  const book = createMemoryBook(config);
  const now = Date.now();
  const normalizedPatch = normalizePatch(patch);

  const timeline = [
    ...book.timeline,
    ...normalizedPatch.storyEvents.map((event) => makeTimelineEvent(event, now))
  ];
  const characters = mergeCharacters([
    ...book.characters,
    ...normalizedPatch.characterUpdates.map((item) => makeCharacterUpdate(item, now))
  ]);
  const openQuestions = mergeQuestions([
    ...book.openQuestions,
    ...normalizedPatch.openQuestions.map((item) => makeOpenQuestion(item, now))
  ]);
  const shortTerm = [
    ...book.shortTerm,
    ...normalizedPatch.shortTerm.map((item) => makeShortTerm(item, now))
  ].slice(-MAX_SHORT_TERM);

  const nextBook = normalizeMemoryBook({
    ...book,
    shortTerm,
    timeline: dedupeByText(timeline, "summary").slice(-MAX_EVENTS),
    characters,
    openQuestions,
    summaries: {
      work: normalizedPatch.workSummary || book.summaries.work,
      currentArc: normalizedPatch.currentArcSummary || book.summaries.currentArc
    },
    stats: {
      writes: book.stats.writes + countPatchWrites(normalizedPatch),
      lastUpdatedAt: now
    }
  });

  return {
    ...config,
    memoryBook: nextBook,
    storyMemory: renderStoryMemory(nextBook),
    characterNotes: renderCharacterNotes(nextBook)
  };
}

export function buildMemoryPayload(config) {
  const book = createMemoryBook(config);
  return {
    workTitle: config.workTitle,
    storyMemory: config.storyMemory,
    characterNotes: config.characterNotes,
    userPrefs: config.userPrefs,
    personaPrompt: config.personaPrompt,
    danmakuPrompt: config.danmakuPrompt,
    memoryBook: buildMemoryContext(book)
  };
}

export function buildMemoryContext(book) {
  const normalized = normalizeMemoryBook(book);
  return {
    summaries: normalized.summaries,
    recent: normalized.shortTerm.slice(-6),
    timeline: normalized.timeline.slice(-10),
    importantEvents: normalized.timeline.filter((event) => event.importance === "high").slice(-8),
    characters: normalized.characters.slice(-10),
    openQuestions: normalized.openQuestions.filter((item) => item.status !== "resolved").slice(-8),
    stats: normalized.stats
  };
}

export function getMemoryStats(config) {
  const book = createMemoryBook(config);
  return {
    events: book.timeline.length,
    characters: book.characters.length,
    questions: book.openQuestions.filter((item) => item.status !== "resolved").length,
    shortTerm: book.shortTerm.length,
    writes: book.stats.writes,
    lastUpdatedAt: book.stats.lastUpdatedAt
  };
}

export function renderStoryMemory(book) {
  const lines = [];
  if (book.summaries.work) lines.push(`作品总览：${book.summaries.work}`);
  if (book.summaries.currentArc) lines.push(`当前阶段：${book.summaries.currentArc}`);
  book.timeline.slice(-18).forEach((event) => {
    lines.push(`- ${event.summary}`);
  });
  book.openQuestions.filter((item) => item.status !== "resolved").slice(-8).forEach((item) => {
    lines.push(`? ${item.question}`);
  });
  return lines.join("\n");
}

export function renderCharacterNotes(book) {
  return book.characters.slice(-18).map((character) => {
    const facts = character.facts.slice(-3).join("；");
    return `- ${character.name}${facts ? `：${facts}` : ""}`;
  }).join("\n");
}

function normalizePatch(patch = {}) {
  const storyEvents = normalizeList(patch.storyEvents);
  if (patch.storyMemoryAppend) {
    storyEvents.push({ summary: patch.storyMemoryAppend, importance: "medium", confidence: "certain" });
  }

  const characterUpdates = normalizeList(patch.characterUpdates);
  if (patch.characterNotesAppend) {
    characterUpdates.push({ name: "未指定角色", fact: patch.characterNotesAppend, confidence: "certain" });
  }

  return {
    storyEvents,
    characterUpdates,
    openQuestions: normalizeList(patch.openQuestions),
    shortTerm: normalizeList(patch.shortTerm),
    workSummary: cleanText(patch.workSummary),
    currentArcSummary: cleanText(patch.currentArcSummary)
  };
}

function makeTimelineEvent(event, now) {
  return {
    id: event.id || `evt-${now}-${Math.random().toString(16).slice(2)}`,
    summary: cleanText(event.summary || event.text),
    importance: normalizeImportance(event.importance),
    confidence: normalizeConfidence(event.confidence),
    source: event.source || "auto",
    tags: normalizeList(event.tags).map(cleanText).filter(Boolean).slice(0, 6),
    createdAt: event.createdAt || now
  };
}

function makeCharacterUpdate(item, now) {
  const name = cleanText(item.name || item.character || "未指定角色");
  const fact = cleanText(item.fact || item.summary || item.description);
  return {
    id: item.id || slugId("char", name),
    name,
    aliases: normalizeList(item.aliases).map(cleanText).filter(Boolean),
    description: cleanText(item.description),
    status: cleanText(item.status),
    facts: fact ? [fact] : [],
    relationships: normalizeList(item.relationships).map((rel) => ({
      target: cleanText(rel.target || rel.name),
      type: cleanText(rel.type || rel.relation),
      note: cleanText(rel.note || rel.summary)
    })).filter((rel) => rel.target || rel.type || rel.note),
    confidence: normalizeConfidence(item.confidence),
    updatedAt: item.updatedAt || now
  };
}

function makeOpenQuestion(item, now) {
  return {
    id: item.id || `q-${now}-${Math.random().toString(16).slice(2)}`,
    question: cleanText(item.question || item.text),
    relatedCharacters: normalizeList(item.relatedCharacters).map(cleanText).filter(Boolean),
    status: item.status === "resolved" ? "resolved" : "open",
    evidence: cleanText(item.evidence),
    createdAt: item.createdAt || now,
    resolvedAt: item.resolvedAt || null
  };
}

function makeShortTerm(item, now) {
  return {
    id: item.id || `stm-${now}-${Math.random().toString(16).slice(2)}`,
    summary: cleanText(item.summary || item.text || item),
    createdAt: item.createdAt || now
  };
}

function legacyLinesToEvents(text, source) {
  return String(text || "").split("\n")
    .map((line) => cleanText(line.replace(/^[-?]\s*/, "").replace(/^\[[^\]]+\]\s*/, "").replace(/^剧情：/, "")))
    .filter(Boolean)
    .map((summary, index) => ({
      id: `${source}-${index}`,
      summary,
      importance: "medium",
      confidence: "certain",
      source: "legacy",
      tags: [],
      createdAt: Date.now()
    }));
}

function legacyLinesToCharacters(text) {
  return String(text || "").split("\n")
    .map((line) => cleanText(line.replace(/^-\s*/, "")))
    .filter(Boolean)
    .map((line, index) => {
      const [name, ...rest] = line.split(/[:：]/);
      const fact = rest.join("：").trim() || line;
      return {
        id: slugId("char", name || `legacy-${index}`),
        name: cleanText(name || "未指定角色"),
        aliases: [],
        description: "",
        status: "",
        facts: [fact],
        relationships: [],
        confidence: "certain",
        updatedAt: Date.now()
      };
    });
}

function mergeCharacters(characters) {
  const map = new Map();
  characters.forEach((character) => {
    if (!character || !character.name) return;
    const key = character.name.toLowerCase();
    const current = map.get(key);
    if (!current) {
      map.set(key, {
        ...character,
        facts: dedupeStrings(character.facts || []).slice(-8),
        relationships: normalizeList(character.relationships).slice(-8)
      });
      return;
    }
    map.set(key, {
      ...current,
      aliases: dedupeStrings([...(current.aliases || []), ...(character.aliases || [])]).slice(-8),
      description: character.description || current.description,
      status: character.status || current.status,
      facts: dedupeStrings([...(current.facts || []), ...(character.facts || [])]).slice(-8),
      relationships: dedupeRelations([...(current.relationships || []), ...(character.relationships || [])]).slice(-8),
      confidence: character.confidence || current.confidence,
      updatedAt: Math.max(Number(current.updatedAt || 0), Number(character.updatedAt || 0))
    });
  });
  return Array.from(map.values());
}

function mergeQuestions(questions) {
  return dedupeByText(questions.filter((item) => item.question), "question").slice(-MAX_QUESTIONS);
}

function dedupeByText(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const text = normalizeForCompare(item?.[key]);
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

function dedupeStrings(items) {
  return Array.from(new Set(normalizeList(items).map(cleanText).filter(Boolean)));
}

function dedupeRelations(items) {
  const seen = new Set();
  return normalizeList(items).filter((item) => {
    const key = normalizeForCompare(`${item.target}|${item.type}|${item.note}`);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countPatchWrites(patch) {
  return patch.storyEvents.length + patch.characterUpdates.length + patch.openQuestions.length + patch.shortTerm.length;
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function normalizeImportance(value) {
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function normalizeConfidence(value) {
  return ["certain", "inferred", "uncertain", "userProvided"].includes(value) ? value : "certain";
}

function normalizeForCompare(value) {
  return cleanText(value).toLowerCase().replace(/[，。！？!?、\s]/g, "");
}

function slugId(prefix, text) {
  const base = normalizeForCompare(text).slice(0, 24) || Math.random().toString(16).slice(2);
  return `${prefix}-${base}`;
}
