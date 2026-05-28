# AI Watchmate

一个本地 AI 陪看原型：共享屏幕画面，接入 OpenAI-compatible 中转站 API，让 AI 生成短句陪看反应。

## 开发网页模式

```bash
npm run dev
```

打开 `http://127.0.0.1:5173`。

## 桌面应用模式

```bash
npm run electron
```

这会先构建前端，然后打开 Electron 桌面窗口，并在应用内启动本地代理服务 `http://127.0.0.1:8787`。

## 桌面开发模式

```bash
npm run desktop
```

这会同时启动 Vite、Node 代理和 Electron，适合调试 UI。

## 打包 Windows 安装包

```bash
npm run dist:win
```

打包产物会输出到 `release/`。

## 本地 API 配置

可以直接在应用界面填写，也可以在项目根目录创建 `.env`：

```env
AI_BASE_URL=https://api.asxs.top/v1
AI_API_KEY=sk-your-key-here
AI_CHAT_MODEL=gpt-5.5
AI_VISION_MODEL=gpt-5.5
```
