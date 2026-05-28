export const defaultConfig = {
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

export const defaultLayout = {
  preview: { x: 24, y: 18, w: 760, h: 500, z: 1 },
  companion: { x: 808, y: 18, w: 420, h: 500, z: 2 },
  api: { x: 24, y: 538, w: 380, h: 248, z: 1 },
  settings: { x: 424, y: 538, w: 380, h: 248, z: 1 },
  notes: { x: 824, y: 538, w: 404, h: 248, z: 1 },
  memory: { x: 1040, y: 18, w: 420, h: 360, z: 1 },
  persona: { x: 1040, y: 400, w: 420, h: 386, z: 1 }
};

export const panelMin = {
  preview: { w: 420, h: 300 },
  companion: { w: 320, h: 320 },
  api: { w: 320, h: 220 },
  settings: { w: 320, h: 220 },
  notes: { w: 320, h: 220 },
  memory: { w: 340, h: 260 },
  persona: { w: 340, h: 280 }
};
