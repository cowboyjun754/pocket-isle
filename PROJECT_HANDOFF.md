# 停靠岛（Pocket Isle）项目交接说明

> 新对话接手时，直接读本文件即可在 10 秒内了解全部现状，无需全量扫描。

## 1. 项目位置与运行方式
- **根目录**：`D:\Pocket Isle`（建议直接将 `D:\Pocket Isle` 作为工作区打开）
- **技术栈**：Electron 33 + React 18 + TypeScript + electron-vite（配置文件为 `electron.vite.config.mjs`）
- **一键启动**：双击 `D:\Pocket Isle\启动停靠岛.bat`（或运行 `npm.cmd run build`）
- **测试与检查**：`npm.cmd run typecheck`、`npm.cmd test`（Vitest，共 38 项单测）

## 2. 已实现的核心设计（v3）
1. **左右双侧贴边三段式停靠**（`src/shared/shape.ts`、`src/main/index.ts`）：
   - `docked`（停靠态，露 56px）：露出水平手绘木栈桥头、麻绳系船桩、文件数角标，水獭稳坐在第 2-3 块桥板中央 `(38, 117)`。
   - `peek`（迎宾半开态，露 148px）：鼠标或拖文件靠近时滑出完整水平木栈桥，展示最近 3 个手绘包裹（按文件类型映射：文档=卷轴、图片/压缩包=纸箱、文本/代码=信封；超过 3 个显示 `+N`，**左键直接拖出**走原生 `startDrag` 传出到微信等外部应用，**右键按住拖入海里**或点悬停名牌 `🌊 扔海里` 由纯前端小手抓起扔海沉没移除且无系统路径字与角标）。
   - `full`（全展开态，320×240）：左键点栈桥展开整座手绘水彩小岛；右键或双击栈桥打开 430×580 操作面板（支持 `📌` 钉住防失焦隐藏与标题栏 `-webkit-app-region: drag` 原生拖动）；鼠标移开 1.5s 后自动收回（水獭动作演出期间延后收回，空闲时偶尔自主散步）。
   - **丝滑拖拽**：渲染端以 `requestAnimationFrame` 对齐显示器刷新率驱动主进程 `setPosition` 纯位移（避免高频 `setBounds` 引发的 DWM 重绘卡顿），半开/停靠起拖自动补偿 `+prevOffsetX`，拖到左右边缘 ≤ 64px 松手 0 延迟停靠。
2. **手绘水彩分层资产**（`src/renderer/src/assets/`）：
   - 底图：`island-horiz.png`（水平左伸手绘木栈桥已搭上右侧水彩草地）
   - 装饰层（6 件，自由桌搭直接开关）：`deco-flowers.png`、`deco-bench.png`、`deco-lamp.png`、`deco-tree.png`、`deco-cabin.png`、`deco-windmill.png`
   - 水獭 5 动作：`otter-idle.png`、`otter-receive.png`、`otter-read.png`、`otter-wave.png`、`otter-rest.png`
   - 动态物件：`parcel-envelope.png`、`parcel-box.png`、`parcel-scroll.png`、`paper-boat.png`
3. **全岛减压互动与持久记忆**（`src/renderer/src/Island.tsx`、`src/main/store.ts`）：
   - 点击草地空白处种小花苗、手动开关路灯暖光/木屋暖窗均持久化保存在 `store.ts`；夜晚模式增加草地萤火虫、海面微光闪烁、木屋烟囱轻烟与风车微摆等氛围动效。
   - 点击野花丛（飞蝴蝶）、长椅（坐下休息）、圆冠树（落叶看书）、小风车（蒲公英）、野餐茶席（喝茶冒爱心）、岸边海星、外圈海水（扩散涟漪）、小纸船（拖动放漂）。
4. **AI 水獭搭档与独立专注计时**（`src/main/aiService.ts`、`src/main/focusTimer.ts`、`src/renderer/src/Panel.tsx`）：
   - 码头页签：支持拖入、面板/小岛 `Ctrl+V` 粘贴剪贴板截图或文本暂存、关键词搜索过滤（`Ctrl+F`）；支持读取纯文本/`.docx`/`.pptx`/`.xlsx`/`FlateDecode` 压缩流 `.pdf` 与可选 Vision 图片压缩识别，「✦ AI 整理」自动分组与生成速览，选中 2～6 份文件可「✦ 联合速览」生成并一键复制 Markdown 汇总卡片；所有 AI 请求均支持随时取消。
   - 专注页签：25+5 独立番茄钟 + 「AI 帮我拆解」生成本轮小目标与微步骤，支持关联文件搜索与全量勾选。
   - 桌搭页签：6 件装饰自由开关 + 白天/夜晚氛围 + AI 推荐搭配。
   - 设置页签：通用停靠设置（窗口置顶、开机自启、临时副本容量上限与用量条、左右停靠复位、打开数据目录）与 OpenAI 兼容接口配置（DeepSeek / 通义千问 / OpenAI / 本地 Ollama / LM Studio 免 Key 模板、Vision 开关、连接测试）。
