# Twitch English Copilot (Twitch 英文直播翻译与回复助手)

一款专为 iPad Safari 及触控设备优化的 Twitch 英文直播即时翻译与弹幕交流辅助工具。无需服务端、无打包编译步骤（No Build Step），纯静态 HTML/CSS/JavaScript 架构，打开即用。

---

## 🌟 核心特性

1. **匿名直连 Twitch 官方聊天服务器**
   - 通过原生 WebSocket (`wss://irc-ws.chat.twitch.tv:443`) 匿名直连 Twitch IRC。
   - 采用 `justinfan<5位随机数>` 匿名握手协议，无需登录 Twitch 账号即可实时接收弹幕。
   - 自动响应 IRC `PING/PONG` 心跳保活，具备指数退避自动重连机制。
   - 默认频道为 `wow_wyc`，支持通过 URL 参数 `?channel=频道名`（如 `?channel=shroud`）或顶部输入框自由切换。

2. **iPad 视网膜大字号与暗色模式体验**
   - 专为 iPad/平板设计的大字号高对比度排版，满足靠在支架或握持阅读的需求。
   - 适配 iOS/iPadOS Safari 触控体验，符合 44×44px 最小触控区域标准，针对 Safe Area（刘海与底部指示条）全面适配。
   - 弹幕列表上限保持 300 条并自动淘汰旧消息，内存占用极低。
   - 智能滚动机制：用户向上翻阅历史消息时停止自动滚动，右下角展示“↓ 回到底部”与未读新消息计数角标。

3. **Gemini 2.5 Flash 智能批量翻译与魔兽世界(WoW)及 Twitch 俚语解析**
   - 弹幕消息下方实时展示自然流畅的中文翻译。
   - 专门提示词微调，自动识别并标注 Twitch 俚语、魔兽世界及游戏术语（如 `pog`, `kek`, `LFG`, `tank`, `wipe`, `aggro`, `oom`, `bis`, `monkaS`, `copium`, `diff`, `W`, `L` 等）。
   - **智能批量聚合（Batching）**：约每 2.5 秒将收集到的弹幕合并为一个单次 Gemini 请求，使用 `responseMimeType: "application/json"`。不仅大幅节省 API 额度，还通过指数退避机制自动应对 429 频控限制。

4. **一键生成 3 种地道英文回复建议（Reply Suggestions）**
   - 点击任意一条弹幕，底部即刻弹出英文回复建议面板：
     - **Simple (简洁明快)**：简短直率的反应，适合快速跟评。
     - **Natural (地道弹幕)**：原生英语玩家常用的语调与句式。
     - **Playful (趣味调侃)**：幽默造梗、活跃气氛的友善吐槽。
   - 每个建议附带中文语境说明，并配备一键复制按钮（优先使用 `navigator.clipboard`，并在非安全域或旧版系统上平滑回退至文本域模拟复制）。
   - **安全机制**：本工具绝不会向 Twitch 发送任何消息，仅供复制使用。

5. **隐私与安全第一**
   - Gemini API Key 仅保存在浏览器本地的 `localStorage` 中，绝不会上传至任何第三方服务器。
   - 代码库中不包含任何硬编码 Key。
   - 若未配置 API Key，顶部展示明确横幅 `key-banner`（“请先在设置中输入 Gemini API Key（Enter Gemini API key）”），聊天室仍可正常稳定接收弹幕流。

---

## 🚀 快速上手与本地预览

本项目为纯静态前端，无需安装 Node.js 运行时即可直接在浏览器中打开：

### 方式 1：直接打开
双击 `index.html` 或通过浏览器打开该文件即可使用。

### 方式 2：使用任意本地静态服务器
```bash
# 使用 Python 快速启动静态服务器
python3 -m http.server 8080

# 或使用 npx serve
npx serve .
```
在浏览器或 iPad Safari 中访问：`http://localhost:8080` 或 `http://localhost:8080?channel=wow_wyc`。

---

## 🔑 如何获取 Google Gemini API Key

1. 访问 [Google AI Studio](https://aistudio.google.com/)。
2. 使用 Google 账号登录。
3. 点击左上角的 **"Get API key"**（获取 API 密钥）。
4. 点击 **"Create API key"**（新建 API 密钥），选择或创建一个 Google Cloud 项目。
5. 复制生成的 API Key（格式通常为 `AIzaSy...`）。
6. 返回本应用：
   - 点击顶部黄色横幅中的 **“立即配置”** 或右上角的 **设置图标 (⚙️)**。
   - 在弹窗中粘贴你的 API Key。
   - 默认模型为 `gemini-3.1-flash-lite`（推荐，速率快、免费额度充沛）。
   - 可点击 **“测试 API 连接”** 确认连通性，然后点击 **“保存设置”**。

---

## 🌐 静态部署指南

由于本项目无编译步骤、无服务端，可一键免费托管至任何静态平台：

### 1. 部署到 GitHub Pages
1. 在 GitHub 上新建一个公开或私有仓库（例如 `twitch-copilot`）。
2. 将当前目录的所有文件提交到 Git 仓库的主分支（如 `main`）。
3. 进入该 GitHub 仓库的 **Settings** -> **Pages**。
4. 在 **Build and deployment** 下的 **Source** 选择 **Deploy from a branch**。
5. Branch 选择 `main` 分支，路径选择 `/ (root)`，点击 **Save**。
6. 等待 1~2 分钟，GitHub Pages 将提供形如 `https://<your-username>.github.io/twitch-copilot/` 的在线访问链接。

### 2. 部署到 Cloudflare Pages
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) 并进入 **Workers & Pages**。
2. 选择 **Pages** -> **Connect to Git**（关联 GitHub 仓库），或者直接选择 **Direct Upload**（拖拽上传当前目录）。
3. 若关联 Git：
   - Framework preset 选择 **None**。
   - Build command 留空。
   - Build output directory 填 `/` 或 `.`。
4. 点击 **Save and Deploy**，即可获得全球 CDN 加速的 `*.pages.dev` 访问地址。

---

## 🧪 运行纯函数单元测试

本项目将所有 IRC 解析、PRIVMSG 拆解、频道参数归一化、批量聚合逻辑及回复解析抽离在 `lib.js` 中，遵循 UMD 模式，兼顾浏览器端与 Node.js 测试环境。

在项目根目录下执行原生单元测试（无需安装任何 npm 依赖）：

```bash
node --test tests/lib.test.js
```

测试覆盖范围包括：
- IRCv3 标签解析与转义字符（`\s`, `\:`, `\\`, `\n`, `\r`）处理
- Twitch PRIVMSG 消息解析（带标签/无标签/包含冒号网址等情况）
- 频道名称归一化与 URL query 参数提取
- 批量处理队列、定时刷写与指数退避算法测试
- Gemini 翻译与回复建议的 Prompt 构建与响应解析
- 暗色模式文字对比度自动提亮计算

---

## 📂 文件目录结构

```text
.
├── index.html        # 单页面主入口，包含语义化布局与 iPad Safari Viewport 适配
├── app.js            # 前端业务逻辑：WebSocket 通信、DOM 渲染、Gemini 批量翻译、回复面板
├── lib.js            # 纯函数库（IRC 标签解析、PRIVMSG 提取、Batcher 队列管理等）
├── styles.css        # 暗色主题样式表、触控目标、抽屉卡片与 Safe-Area 适配
├── tests/
│   └── lib.test.js   # 基于 node:test 的原生零依赖单元测试集
└── README.md         # 项目中文说明文档
```
