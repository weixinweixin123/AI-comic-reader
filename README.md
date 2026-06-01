# AI Watchmate

本地漫画弹幕助手。你可以创建作品，把多个 PDF 或图片漫画导入到同一个作品里；AI 可以先通读整部作品建立记忆，再按页生成弹幕。阅读时点击播放，弹幕会按当前页的脚本出现。新生成的弹幕支持空间定位，可以贴近人物脸旁、对白框旁、道具旁或分镜空白处显示。

作品、页面、弹幕生成状态、AI 已读状态、页面摘要和作品记忆会保存在本机 IndexedDB 中，下次打开应用可以继续管理同一个作品。

## 本地桌面应用

```bash
npm start
```

或：

```bash
npm run dev
```

这会同时启动本地代理、Vite 开发服务和 Electron 桌面窗口。平时使用这个入口即可，不需要手动打开浏览器。

## 浏览器调试模式

```bash
npm run web
```

打开 `http://127.0.0.1:5173`。这个模式主要用于前端调试。

## 生产桌面运行

```bash
npm run electron
```

这会先构建前端，再打开 Electron 桌面应用，并在应用内启动本地代理服务。

## Windows 打包

```bash
npm run dist:win
```

打包产物会输出到 `release/`。

## API 配置

可以在应用界面填写，也可以在项目根目录创建 `.env`：

```env
AI_BASE_URL=https://api.example.com/v1
AI_API_KEY=sk-your-key-here
AI_CHAT_MODEL=gpt-5.5
AI_VISION_MODEL=gpt-5.5
```
