# 停靠岛（Pocket Isle）项目交接说明

> 新对话接手时，直接读本文件即可在 10 秒内了解全部现状，无需全量扫描。

## 1. 项目位置与仓库
- **根目录**：`D:\Pocket Isle`（建议直接将 `D:\Pocket Isle` 作为工作区打开）
- **GitHub 仓库**：`https://github.com/cowboyjun754/pocket-isle`（分支 `main`）
- **技术栈**：Electron 45 (`45.3.4`) + React 18 + TypeScript + electron-vite `2.3.0`（配置文件为 `electron.vite.config.mjs`）
- **一键启动（无命令行黑框）**：
  - 日常唤起：双击根目录 `停靠岛.lnk`（或 `release\停靠岛\停靠岛.exe`）无黑框直达；如已有实例在运行则直接唤醒显示。
  - 重启切换新版：双击 `启动停靠岛.vbs`（或 `启动停靠岛.bat`）会先温和通过 `--quit` 通知**当前目录对应完整路径**的旧实例落盘退出（2.5s 超时未退时弹窗由用户决定是否强制关闭），再无窗口拉起最新版（优先运行已打包的 `release\停靠岛\停靠岛.exe`，无打包版时才回退 `electron.exe`）。
  - 打包独立版：源码修改后运行 `npm.cmd run package` 生成 `release/停靠岛/停靠岛.exe` 与 `build/icon.ico`（使用临时 staging 目录校验后再替换 `resources/app`，且 `app.isPackaged === true` 可用开机自启）。
- **测试与检查**：`npm.cmd run typecheck`、`npm.cmd test`（Vitest，13 个测试文件 / 共 69 项单测）、`npm.cmd run build`、`npm.cmd run package`

## 2. 已实现的核心设计（v3）
1. **左右双侧贴边三段式停靠**（`src/shared/shape.ts`、`src/main/index.ts`）：
   - `docked`（停靠态，露 56px）：露出水平手绘木栈桥头、麻绳系船桩、文件数角标 `(17, 74)`，水獭稳坐在第 2-3 块桥板中央 `(35, 118)`。
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

## 3. 最近修复与美术优化记录
### 历史阶段（早期基线记录，当时为 39 tests）
1. **栈桥左键拖出、原地/拖离后放回与去重收尾**（`src/main/index.ts`、`src/renderer/src/Island.tsx`、`src/main/dock.ts`、`src/main/dock.test.ts`）：
   - 经实测确认三项拖拽交互（左键拖出、拖离后拖回/原地松手放回、桌面拖回入岛）均已稳定；已移除 `src/main/index.ts` 中 `drag-diag.log` 与 `writeFileSync` 临时调试代码。
   - 补充 `Island.tsx` `handleOutboundDragPosition` 实时同步 `dock:syncDragPassThrough` 避免起拖未出岛时穿透，并在 `Dock.add` 增加 `samePath(i.path, raw)` 避免应用内副本拖回重复入栈。
2. **全套手绘水彩美术与 UI 精修**（`src/renderer/src/assets/*.png`、`src/shared/shape.ts`、`src/renderer/src/Island.tsx`、`src/renderer/src/island.css`、`src/renderer/src/base.css`、`src/renderer/src/panel.css`、`src/main/icons.ts`）：
   - 逐层清理深色壁纸下的白边、杂线与残留色块：`parcel-scroll.png` 右上浅蓝角、`deco-lamp.png` 乳白光斑与黄草方块及横穿灯柱的残线、`deco-flowers/bench/cabin/windmill/tree` 残留山坡轮廓线与碎点、`island-horiz.png` 栈桥右端绿色接缝与底部平切灰影外缘。
   - 优化栈桥构图与层次：`DOCK_SLOTS` 调整至 `(47, 117) / (70, 120) / (93, 123)` 避开系船桩麻绳并增加包裹落点投影；角标移至 `(17, 74)`、`+N` 胶囊移至 `(46, 82)`、停靠/迎宾态水獭位置分别调整为 `(35, 118)` 与 `(121, 138)`。
   - 升级夜晚氛围光影（微调暮色滤镜、路灯暖黄草地光斑、木屋窗格暖光对齐）、前景 SVG 水彩渐变与投影、手绘风微型小岛托盘图标与面板暖纸滚动条/卡片质感。
3. **最新四项方向优化与无黑框启动（`typecheck` / `test` / `build` / `package` 全通过）**：
   - **视觉生动度与低功耗**：风车拆分为静止塔身 + 连续缓慢旋转风车扇叶（`deco-windmill-blades.png`）；新增第三种氛围「细雨听海」（`rain` 模式，含斜雨丝与海面雨圈 + 暖窗/路灯光）；全展开时水獭与 6 件装饰按基底 Y 轴深度穿插（`DECO_Z_ORDER` vs `100 + otterPos.y`）；靠边休眠时通过 `.is-sleeping-fx` 暂停背景动画省电。
   - **码头文件流转效率**：支持文件夹作为快捷引用拖入（`isDir: true` / `ext: 'dir'`）；工具栏新增「清理失效」一键移除原路径失效条目；行内新增「复制」快捷按钮（图片/文本前段/路径到剪贴板）与纯文本/代码弹窗预览（含截断提示）；`+N` 胶囊悬停提示列举被折叠的文件名。
   - **专注自定义时长与 AI 体验**：支持 15/25/45/60 分预设与 1~180 分钟自定义专注时长、1~60 分钟休息时长持久化，计时结束自动弹出系统桌面通知与可关闭的三音柔和铃声；暴露「✦ 联合速览」可选对比侧重方向输入框与 AI 分阶段进度提示。
   - **零黑框启动与本地打包**：新增 `scripts/make-ico.mjs` + `scripts/package-win.mjs` 本地零依赖生成 `build/icon.ico` 与 `release/停靠岛/停靠岛.exe` + 快捷方式 `停靠岛.lnk`，配合 `启动停靠岛.vbs` 彻底去除开机/启动指令框。
4. **运行目录注意**：用户个人配置与日记/暂存列表保存在 `%APPDATA%\pocket-isle\data.json`（含用户本地配置与加密凭据），排查时注意不要改动或泄露用户隐私配置。

### 最新代码审查加固（Phase 1 ~ 3，当前实测 12 个测试文件 / 65 项单测全通过）
1. **AI 安全与发送透明化**：按服务源（`protocol + host + port`）通过 Electron `safeStorage` 加密保管密钥（`src/main/aiSecrets.ts`），配置广播仅传脱敏 `hasApiKey`；「测试连接」直测草稿不覆写已保存配置；专注页未选文件时严格只发目标不带最近 5 份，搜索过滤下「AI 整理筛选」所见即所得；代码复制与预览保留缩进与换行。
2. **解析诚实度、Worker 线程与异常恢复**：Office/PDF 重解析迁入 `worker_threads`（`src/main/extractWorker.ts` / `src/main/fileExtractor.ts`）并支持并发/总字节预算及中止信号；修正 41 行 Excel 截断状态、纯扫描件 PDF 误判、6 张图超过 4 张上限与目录提示；`Panel.tsx` 收敛为单一 `activeAiTask` 状态机并接收主进程实时阶段进度；`summaryGuard.ts` 严格清洗模型与历史存档结构；`Dock` 串行化导入去重与配额预留，支持 20 秒误删撤销与失败删除 `pendingDeletes` 墓碑对账，默认关闭 `drop-log.txt`。
3. **Windows 启动、多屏 DPI 与安全功耗加固**：`启动停靠岛.vbs` 精确比对 `ExecutablePath` 且超时由用户确认；`scripts/package-win.mjs` 兼容 Node 18+ 并通过 staging 目录校验替换；`display-metrics-changed`/`display-removed` 后重算贴边与自定义位置面板（`reconcileIslandPosOnDisplayChange` / `clampPanelBoundsToWorkArea`）；`FocusController` 每 15s 落盘检查点；全量 IPC 校验 `sender` 与主 frame 来源；`dock:open` 对可执行脚本弹出安全确认；隐藏/锁屏时停止鼠标轮询，面板缩略图按可见性与 `mtimeMs` 缓存更新。

### Phase 4 前端架构拆解与运行时评估（当前实测 13 个测试文件 / 69 项单测全通过）
1. **Panel 模块化**（`src/renderer/src/Panel.tsx` + `src/renderer/src/panel/`）：拆分为 `panelShared.tsx`、`useAiTask.ts`、`PreviewModal.tsx`、`DockTab.tsx`、`FocusTab.tsx`、`BuildTab.tsx`、`SettingsTab.tsx`，并消除倒计时格式化重复逻辑（统一复用 `src/renderer/src/util.ts` 的 `formatDurationMmSs`）。
2. **Island 模块化与单测**（`src/renderer/src/Island.tsx` + `src/renderer/src/island/`）：拆分为 `islandMath.ts`、`islandMath.test.ts`、`islandAssets.ts`、`IslandDecorSvg.tsx`、`ParcelLayer.tsx`、`HitRegionsSvg.tsx`、`useParcelGestures.ts`，100% 保留原有 DOM 结构、CSS 类名、IPC 契约与鼠标/拖拽交互。
3. **Electron 45 升级与剪贴板 API 适配**：
   - 将 `electron` 从 `^33.2.0` (`33.4.11`) 升级至 `^45.3.4` (`45.3.4`)；同步调整 [src/main/index.ts](src/main/index.ts) 中的剪贴板读写以适配 Electron 44+ W3C 异步 `Clipboard` / `ClipboardItem` 接口（`clipboard.read()` / `clipboard.write()` / `await clipboard.readText()` / `await clipboard.writeText()`，移除已废弃的 `readImage` / `writeImage`）。
   - [scripts/package-win.mjs](scripts/package-win.mjs) 兼容 Electron 45 按需下载二进制机制（若缺少 `node_modules/electron/dist/electron.exe`，自动调用 `node_modules/electron/install.js` 补全后再打包）。
   - 后续迁移备忘：`safeStorage` 同步接口（`isEncryptionAvailable`/`encryptString`/`decryptString`）在 Electron 45 中标记为 `@deprecated`、预计 Electron 46 移除，后续升 46 前需将 [src/main/aiSecrets.ts](src/main/aiSecrets.ts) 与 `safeCodec` 迁至 `*Async()`。
