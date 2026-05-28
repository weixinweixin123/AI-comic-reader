export function parseDanmakuLines(text, count) {
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
  const pool = uniqueSource.length ? uniqueSource : fallback;
  const names = ["前排", "懂了", "路人A", "小声", "盲猜", "别急", "细节党", "弹幕君"];

  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const base = pool[index % pool.length] || fallback[index % fallback.length];
    if (uniqueSource.length >= count) return base;
    const prefix = names[index % names.length];
    const suffix = index % 3 === 0 ? "" : index % 3 === 1 ? "啊" : "！";
    return `${prefix}：${base}${suffix}`.slice(0, 34);
  });
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
