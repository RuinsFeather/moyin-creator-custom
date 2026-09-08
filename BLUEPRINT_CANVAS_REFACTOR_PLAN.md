# 蓝图画布化重构方案（BLUEPRINT_CANVAS_REFACTOR_PLAN）

> 状态：待评审 → 待开发
> 日期：2026-08-31（2026-09-01 修订：去除“输出”窗口；生成内容支持点击下载；取消图片/视频窗口的上传/生成模式区分）
> 关联：`BLUEPRINT_DEVELOPMENT_PLAN_diff.md`（P1/MVP-B 已全部完成的现状基线）
> 结论：**执行引擎/持久化/恢复体系全部复用，仅重构"节点类型收敛 + 展示交互层"**，Schema 升 v2 并自动迁移旧数据。

---

## 0. 结论摘要（TL;DR）

1. 把现有 7 种节点收敛为 **3 种“窗口”**：`text-box`（文本窗口）、`image-box`（图片窗口）、`video-box`（视频窗口），外加保留的 `script-import`（归入“高级”菜单）。**`output` 输出节点退役删除**（画布范式下无聚合导出语义，素材入库/下载由窗口自身承担）。
2. 窗口是画布上的**圆角矩形内容卡片**（280–360px）；创建后只展示对应内容：图片窗口展示当前图片，视频窗口展示视频首帧并可点击播放，文本窗口展示文本内容。默认不展开抽屉；选中窗口后才显示该窗口的配置抽屉，抽屉为圆角矩形并悬浮在选中窗口下方，覆盖其他未选中窗口。抽屉内提供三段式功能配置：**顶部参考区 → 中部文本输入区 → 底部模型选择与控制区**。
3. **图片/视频窗口不区分“上传内容”与“生成内容”**：窗口就是当前内容的容器——拖入图片即导入图片窗口、拖入视频即导入视频窗口；生成的图片/视频结果默认写回对应窗口成为其当前内容。执行行为由“是否配置了生成”推导（有 `generation` 配置即走生成链路，否则媒体直通），不再有显式 `mode` 字段与模式 tab。
4. **生成内容可直接点击下载**：图片/视频窗口对当前内容（含生成结果与导入内容）提供下载按钮，机制与“自由”页图片工作室/视频工作室完全一致（`saveFreedomMedia`：Electron 下走 `saveFileDialog` 另存为，Web 下走 Blob + `<a download>`，复用 `src/lib/freedom/download-utils.ts`）。
5. 引擎层零重写：新增 `text-box` / `image-box` / `video-box` 三个 executor **适配器**，image-box/video-box 内部按“有无 `generation` 配置”委托给现有 `executeImageGenerator` / `executeVideoGenerator` 或媒体直通逻辑。
6. 旧蓝图通过既有 `blueprint-migrations.ts` 框架做 **v1 → v2 类型重映射**（端口 id 基本不变，映射表见 §3.3），用户无感。
7. 参考连接自由组合：**图片窗口可接多个图片窗口作参考**；**多个图片窗口 + 视频窗口可同时接入同一视频窗口**构成多功能参考（首帧/尾帧/参考角色可指派）；**图片抽屉底部提供手动“上传至素材资产管理”**按钮。
8. **文本窗口双向增强**：保留“分镜 → 蓝图”发送链路（转换器产出 `text-box`，发送后自动选中，见 §5.4）；文本窗口 ✨ AI 助手新增 **skill 引用**——可装载 `skill/` 文件夹下的 md 技能文件（如 `seedance_SKILL.md`），选中技能正文注入 AI 请求 system prompt（见 §5.3）。

预估总工作量：**8–11 个工作日**（见 §6 阶段表）。

---

## 1. 现状盘点与问题诊断

### 1.1 现有资产分类

| 分类 | 模块/文件 | 说明 |
|---|---|---|
| ✅ 完整复用（不改） | `execution-engine.ts`、`dag-traversal.ts`、`input-merge.ts`、`error-utils.ts`、`execution-metrics.ts`、`execution-bridge.ts` | DAG 校验/拓扑分层/并发调度/上游合并/指标/付费确认全链路保留 |
| ✅ 完整复用 | `blueprint-store.ts`（含 beginRun 锁、任务恢复、stale 传播）、`undo-redo.ts`、`schema-version.ts`、`createProjectScopedStorage` 持久化 | store 的 node/edge 增删改查 API 不变，只是数据里的 `type` 字段换值 |
| ✅ 完整复用 | `freedom/freedom-api.ts`（generate/resume）、`use-asset-upload.ts`、`VolcAssetPanel`、`freedom/download-utils.ts`（`saveFreedomMedia`：窗口内容点击下载与图片工作室同一实现） | 生成 API、素材库上传/选图、内容下载直接复用 |
| 🔧 适配改造 | `types/blueprint.ts`（端口表 + Config 类型）、`graph-validation.ts`（读新端口表）、`node-executors.ts`（新增 3 个适配器）、`blueprint-migrations.ts`（v2 映射）、`ai-assist.ts`（`AIAssistRequest` 扩 `skillRefs`，§5.3）、`storyboard-to-blueprint.ts` / `director-to-blueprint.ts` / `script-to-blueprint.ts`（产出类型同步 v2，§5.4） | 逻辑不变，注册新类型 + 小幅扩展 |
| ♻️ 重写（UI 层） | `BlueprintCanvas.tsx`、`nodes/*.tsx`（7 个节点组件 → 3 个盒子组件；`OutputNode` 随 output 类型退役删除）、`PropertiesPanel.tsx`（退役）、`BlueprintToolbar.tsx`（简化）、`BlueprintOnboarding.tsx`（改引导） | 交互范式换血 |
| 📦 复用外部组件 | `panels/freedom/ModelSelector.tsx`、`PromptTextarea.tsx`、`model-registry.ts` 能力探测（`getAspectRatiosForT2IModel` / `getAspectRatiosForT2VModel` / `getDurationsForModel` / `getResolutionsForModel`）、`veo-capability` / `seedance-capability`、`VolcAssetPanel`、`vaul`（底部抽屉，已在依赖中） | 抽屉功能对齐图片/视频工作室的关键收益点 |

### 1.2 ComfyUI 式工作流的效率问题

- **类型过碎**：想"放一张图"必须先想清楚放 `image-reference` 还是 `image-generator`，语义负担在用户侧。
- **配置局促**：`NodeCard` 限宽 300px、`text-[10px]` 字号，模型选择、时长、提示词全挤在折叠区/侧面板里，来回切换视角成本高。
- **编辑路径长**：改一个提示词要 点选节点 → 看侧面板 → 找到字段 → 修改；不如直接在卡片上写。
- **模型硬编码**：`VideoGeneratorNode.tsx` 里的 `VIDEO_MODELS` 是静态 5 项，与 `model-registry.ts`（含阿里百炼 wan 系列等数十个模型）脱节。
- **"运行"重心偏全局**：引擎其实已支持 `mode: 'node' | 'downstream' | 'all'`，但 UI 没有把"单盒生成"做成一等公民。

---

## 2. 目标交互范式（画布 + 三种盒子）

### 2.1 设计原则

1. **窗口是内容容器，不是函数节点**：一个图片窗口既能导入内容也能发起生成（两种能力并存，无需切换模式），不再逼用户区分 reference/generator；**窗口内不区分“上传内容”与“生成内容”**——拖入图片即导入图片窗口、拖入视频即导入视频窗口，生成出的图片/视频也默认成为对应窗口的当前内容。
2. **默认收起**：窗口创建、画布切换、生成完成后默认不展开抽屉；仅点击/选中窗口时打开对应抽屉。点击画布空白或按 Escape 取消选中并关闭抽屉。
3. **内容优先展示 + 可点击下载**：文本窗口展示可编辑文本；图片窗口只展示当前图片或图片空态；视频窗口只展示视频首帧，点击首帧进入播放状态，再次点击暂停，控件区域提供静音/全屏等标准视频操作。图片/视频窗口的当前内容（无论导入还是生成）均可通过窗口上的下载按钮直接下载，机制与“自由”页图片工作室/视频工作室一致（见 §2.2）。
4. **选中态悬浮抽屉**：选中窗口增加高亮边框/轻微上浮阴影；`BoxConfigDrawer` 定位在选中窗口正下方，与窗口保持 8–12px 间距，使用圆角矩形、阴影和较高 z-index，覆盖其他未选中窗口；抽屉位置随画布平移、缩放和窗口移动实时跟随，不改变画布布局，不推动其他窗口。
5. **单盒直跑（唯一执行入口）**：抽屉底部提供醒目的“开始生成”按钮，可直接执行 `executeBlueprintRun('node', boxId)`；运行中按钮变为进度/取消状态，生成完成后保留窗口内容并自动关闭抽屉（可配置为不关闭，但默认关闭）。**同时移除工具栏“运行选中/运行下游/运行全部”三按钮**（见 §2.5，彻底告别 ComfyUI 全局运行范式）。
6. **连接球优先于隐藏端口**：每个窗口左右两侧各显示一个小圆球（圆形、可点击/拖拽、选中或 hover 时增强对比度），从圆球拖拽创建连接；不再要求用户寻找卡片内部的细小 Handle。连接球根据窗口类型承担输入/输出方向：左侧为输入、右侧为输出；一个球可以承载多个连接，具体数据类型由目标窗口的语义和端口映射决定。拖拽过程中高亮可连接窗口，松开到无效区域取消连接。
7. **连线表达依赖，不表达配置**：文本窗口→图片/视频窗口 = 当提示词；图片窗口→图片窗口 = 当生成参考；图片/视频窗口→视频窗口 = 当多功能参考。连线后抽屉参考/文本区显示“上游输入”预览，可与手动内容混排或一键切换为自定义覆盖。
8. **没有“新手/高级”两套界面**：取消 `beginnerMode` 双模式（默认还隐藏视频节点），只保留一套画布交互；进阶能力（剧本导入、自动布局）收进“更多”菜单而非模式切换。

### 2.2 三种盒子规格

**📝 文本窗口 `text-box`（宽 ~280px）**
- 圆角矩形窗口即编辑器：内联 textarea（现有 `NodeTextarea` 加大），实时保存进 config（走 updateNode → undo 栈）；未选中时仍展示文本摘要，避免窗口只显示标题。
- 头部：字数统计 + ✨ AI 按钮 → 弹 `AIAssistPanel`（现有组件，改为 vaul 抽屉或 popover 均可，建议抽屉统一交互）。
- AI 生成交互：用户输入一句指令（如"写一段雨夜巷战的分镜提示词"）→ AI 返回建议文本 → 应用/放弃（复用现有 accept/reject 流）。- **✨ AI 面板内新增 skill 引用（“装载技能”）**：面板顶部展示 skill 库 chip 列表（技能名 + description tooltip，来自 md frontmatter），可多选装载；选中技能正文拼入该次 AI 请求的 system prompt（链路见 §5.3）；装载选择持久化到 `config.skillRefs`，重开面板保持；面板内提供“管理技能目录”入口，可选自定义文件夹（与内置 `skill/` 合并去重）。
- **来源徽标**：由“分镜”页发送而来的文本窗口（`sourceRef.kind === 'shot'`，现有字段）头部显示“分镜”小徽标；发送链路与类型同步见 §5.4。- 保留 `role`（提示词/负向/台词/上下文）与 `language` 字段（下拉收进卡片底部小行，默认收起）。
- 输出端口：`text`。

**🖼️ 图片窗口 `image-box`（宽 ~320px）**
- 圆角矩形媒体窗口只展示当前图片；无图片时展示导入/生成空态。不要在窗口主体长期展开完整模型参数。**不区分上传/生成两种模式**——窗口就是当前图片的容器，导入与生成能力常驻，无模式 tab。
- **导入内容**：拖拽图片文件到窗口即导入（复用 `NodeDropZone` 拖放链路）+ "从素材库选"（`VolcAssetPanel`）+ "上传到素材库"（`useAssetUpload`）——能力全部继承自现 `VideoReferenceNode`；导入的图片直接成为窗口当前内容。
- **生成内容**：抽屉“开始生成”产出的结果默认写回本窗口成为当前内容（历史进媒体库，窗口展示最新一张/一组网格）；未生成且未导入时显示空态 + "生成"主按钮 → 打开 BoxConfigDrawer（图片版）。
- 输入端口：`prompt`（text/context，multiple）、`reference-images`（image，multiple）；输出端口：`image`。
- 导入或生成的媒体统一作为 `image` 输出（供下游视频框引用），等价旧 `image-reference`。执行层按“有无 `generation` 配置”自动推导走生成链路还是媒体直通（§5.1），UI 与数据均无 `mode` 字段。
- **点击下载**：窗口当前内容（导入或生成均可）提供 `⬇ 下载` 按钮，直接调用 `saveFreedomMedia(url, filename)`（与图片工作室“下载”按钮同一实现，见 §2.2 末尾说明），失败 toast“下载失败，请稍后重试”。
- **图片框 ↔ 图片框互连**：一个图片框可同时接入多个上游图片框的 `image` 输出作为生成参考；上限沿用图片工作室 `MAX_REFERENCE_IMAGES = 10`（连线参考 + 抽屉手动追加共用该上限），参考顺序可调。

**🎥 视频窗口 `video-box`（宽 ~340px）**
- 圆角矩形媒体窗口只展示视频首帧；点击首帧后播放视频，窗口内保留暂停、静音、全屏等必要播放控制，不在未选中状态展示完整配置表单。**不区分上传/生成两种模式**——窗口就是当前视频的容器，导入与生成能力常驻，无模式 tab。
- **导入内容**：拖拽视频文件到窗口即导入（复用 `NodeDropZone` 拖放链路）+ "从素材库选"（`VolcAssetPanel`）；导入的视频直接成为窗口当前内容。
- **生成内容**：抽屉“开始生成”产出的结果默认写回本窗口成为当前内容；未生成且未导入时显示空态 + "生成"主按钮 → 打开 BoxConfigDrawer（视频版）。
- 卡片布局（有内容时）：
  - 参考区：横向缩略条，显示来自连线（图片窗口/视频窗口输出）+ 手动追加（`generation.referenceMediaRefs`）的参考，角标显示角色（首帧/尾帧/参考）。
  - 提示区：若连了文本框 → 只读预览上游合并文本 + “覆盖”开关；未连 → “点击输入提示词”占位，点击打开 BoxConfigDrawer 并聚焦文本区。
  - 结果区：视频预览（`<video controls>`）+ 进度/重试。
- 输入端口：`prompt`（text/context，multiple）、`reference-media`（image/video/audio，multiple）；输出端口：`video`。
- 执行层按“有无 `generation` 配置”自动推导走生成链路还是媒体直通（§5.1），UI 与数据均无 `mode` 字段。
- **点击下载**：窗口当前内容（导入或生成均可）提供 `⬇ 下载` 按钮，直接调用 `saveFreedomMedia(url, filename)`（与图片工作室同一实现，见 §2.2 末尾说明），失败 toast“下载失败，请稍后重试”。
- **多功能参考**：多个图片框与视频框可同时接入同一视频框的 `reference-media`（混合 image + video），等价视频工作室的“多功能参考”模式；音频参考因画布无音频盒子，仅经抽屉手动追加 / 素材库选取。角色与数量校验沿用工作室同一能力探测（`veo-capability` 的 single/first_last/multi 模式、`seedance-capability` 张数与时长、HappyHorse 仅图 ≤9）。

> **下载机制统一说明（图片/视频窗口共用）**：与“自由”页图片工作室的“下载”按钮完全同一实现——`saveFreedomMedia(url, filename)`（`src/lib/freedom/download-utils.ts`）：Electron 环境优先弹 `saveFileDialog` 另存为（本地化 URL 走 `local-image://` / `local-video://` 直读），非 Electron 或取消降级为 fetch Blob + `<a download>` 触发浏览器下载；失败统一 toast“下载失败，请稍后重试”。视频窗口的结果 URL 已由生成链路本地化（`saveVideoToLocal`），同一函数即可保存。

### 2.3 连接规则（简化但保校验）

- 连线交互沿用 ReactFlow：从输出端口拖到目标盒子，`isValidConnection` 复用 `canConnectBlueprintPorts`（数据类型兼容 + 防自环 + 防重复边）。
- **增强**：`onConnectStart` 时高亮所有兼容的输入端口（按数据类型着色），降低"找端口"成本。
- 允许的典型连线（等价校验表）：
  - `text-box.text` → `image-box.prompt` / `video-box.prompt`
  - `image-box.image` → `image-box.reference-images` / `video-box.reference-media`
  - `video-box.video` → `video-box.reference-media`
  - `script-import.context` → `*.prompt`（高级模式）
- 多对一参考：`reference-images` / `reference-media` 均为 `multiple` 端口，天然支持“多个图片框 → 一个图片框”与“多个图片框 + 视频框 → 一个视频框”；参考合并顺序按连线 `order` 字段（`BlueprintEdgeData.order`，已有），抽屉内可拖拽调序。

### 2.4 底部功能配置抽屉 BoxConfigDrawer

- 载体：`vaul`（Drawer，从底部滑出，已在 package.json），受控 open、可半开拖动；open 时画布 `pointer-events-none`。
- **功能基准 = “自由”页已有的图片工作室（ImageStudio）/ 视频工作室（VideoStudio）**：抽屉不另起一套参数体系，而是把工作室已验证的能力（模型能力探测、参考管理、参数控件）抽成共享叶子组件接入，`ImageStudio` / `VideoStudio` / `BoxConfigDrawer` 三方共用，避免两份维护（见 §4.1 工作室共享抽取）。**不整体内嵌 Studio 组件**（其全局 freedom-store 状态/任务历史与蓝图执行态冲突），生成仍走蓝图执行器（保 DAG/任务恢复/指标/去重），但参数与能力面和工作室完全对齐、共用同一 `freedom-api` 层。
- 三段式布局（同一抽屉，按 `kind: 'image' | 'video'` 切内容）：

  **① 顶部 · 参考区（小尺寸缩略图条）**
  - 参考预览统一使用**小尺寸缩略图**（建议 36×36px，缩略图条整体单行高度 ≤48px，图标/角标 8–10px）：横向单行排列、可横向滚动，不占用抽屉主体空间；缩略图上叠加来源徽标（连线 ◇ / 手动 ◆ / 素材库 ▲）、视频/音频角标与序号，hover 显示放大预览与完整文件名。
  - 汇总当前窗口的全部参考为一个有序列表：连线引入（徽标“连线”+ 来源框名）与手动追加（本地文件 / `VolcAssetPanel` 素材库选取，带 `assetId` / `volcAssetUri`）混排，可拖拽调序、删除（删除仅作用于缩略图 hover 的删除钮，避免误触）。
  - 图片版：参考上限 10（对齐 `ImageStudio.MAX_REFERENCE_IMAGES`），支持多图片窗口连线 + 手动混合。
  - 视频版：可为每条参考指派角色（首帧 / 尾帧 / 参考）；按所选模型实时校验 —— `veo-capability`（single / first_last / multi 模式与张数上下限）、`seedance-capability`（参考数与时长）、HappyHorse（仅图片 ≤9），校验模块直接 import 工作室同一实现。

  **② 中部 · 文本输入区**
  - 复用自由页 `PromptTextarea`（输入、字数、清空等行为与工作室一致）。
  - **视频版保留工作室“右键参考缩略图 → 在光标处插入文件引用”**：复用 `PromptTextarea` 的 ref 暴露 `insertAtCursor(text)`（已有实现），右键参考缩略图时在提示词文本框光标位置插入 `@image_file_N` / `@video_file_N` / `@audio_file_N` 引用标签（编号规则沿用工作室 `getMultiRefTag`：同类型内按参考顺序 1 起编号，参考增删后实时重算）；toast 提示“已在光标位置插入 @xxx”，并在缩略图 hover 提示与卡片角标展示其引用标签，方便用户对应；Seedance 类多功能参考模型提交时按标签与 uploadFiles 关联（沿用工作室同一机制，抽屉与工作室共用同一插入/标签实现）。
  - 上游连了文本框 → 显示“使用上游文本（N 个来源，按连线 order 合并）”折叠预览 + `自定义覆盖` 开关（覆盖即写 `generation.prompt`，保留现状 `upstreamPrompt || cfg.prompt` 优先级并显式化）；无连线 → 直接输入（即“直接点击输入提示词”）。
  - 引用标签随参考列表变化自动重算并同步替换 prompt 中的旧标签（沿用工作室行为；若标签已被用户手改，保留用户文本不强制覆盖）。

  **③ 底部 · 模型选择与控制区**
  - 模型：复用 `freedom/ModelSelector`（`type: 'image' | 'video'`），替换节点内硬编码 `VIDEO_MODELS` —— 一次性接入整个 model-registry 与 API 功能绑定。
  - 能力驱动参数控件（随模型动态显隐，数据源同工作室）：
    - 图片：aspectRatio（`getAspectRatiosForT2IModel`）、resolution（`model.inputs.resolution.enum`）、Midjourney / Ideogram 特有参数折叠区。
    - 视频：aspectRatio（`getAspectRatiosForT2VModel`）、duration（`getDurationsForModel`）、resolution（`getResolutionsForModel`）、generateAudio / watermark / webSearch（折叠）。
  - 操作：`生成`（主按钮，走 `executeBlueprintRun('node', boxId)`，付费先过 `allowPaidExecution` / confirmPaidTask；首次点击"生成"即把所选模型与参数落 `config.generation`，此后窗口即视为生成型）+ `仅保存配置`。
  - **图片版专属：`⬆ 上传至素材资产管理` 按钮** —— 手动点击上传（复用 `useAssetUpload`，与现 VideoReferenceNode“一键上传到素材库”同链路）：把盒子当前内容（上传媒体或生成结果）入库为稳定 `assetId` / `volcAssetUri`，或选取新本地文件入库并加入参考；视频版同位置放“从素材库选参考”入口。

- 生成中再次打开 → 显示进度与取消（复用 store 的 abortController）。

### 2.5 画布与工具栏

- `PropertiesPanel` **退役**：属性内联进盒子 + BoxConfigDrawer；右侧区域还给画布（全宽）。
- **运行入口收敛（移除 ComfyUI 式全局运行）**：删除工具栏 `RunActions` 的“▶ 选中 / ▶ 下游 / ▶▶ 全部”三按钮（现状 `BlueprintToolbar.tsx` 的 `RunActions` 组件），**“运行整图”彻底删除、不留任何入口（已定案：当前版本无老用户，不存在过渡问题）**。**唯一的执行入口 = 选中窗口 → 抽屉底部“开始生成”**（文本窗口无生成语义，其抽屉无此按钮，只有 ✨ AI 生成文案）。引擎层 `executeBlueprintRun` 的 `'downstream'`/`'all'` mode 保留不删（执行引擎零改动，测试与内部恢复链路仍可用），仅 UI 不再暴露：多窗口批量生成 = 逐个打开抽屉点“开始生成”（画布范式：用户看到每个窗口各自产出）。
- **保留但降级**：`🔄 重试`（仅选中失败窗口时出现在抽屉内，重试该窗口及其上游，非工具栏）、`■ 取消`（运行中出现在抽屉/状态条）、`🧹 清理`（状态条小按钮，保留现状）。
- **取消“新手/高级”分类**：删除 `BeginnerModeToggle` 与 store 的 `beginnerMode` / `toggleBeginnerMode`（含持久化字段，`blueprint-store.ts:70/120/157/791`），`AddNodeMenu` 不再按模式过滤节点；`BlueprintOnboarding` 不再依赖 beginnerMode 显隐，改为新项目首次进入显示一次、完成后不再出现（显隐条件改挂 activeProjectId + localStorage 标记）。
- **添加窗口入口收敛为两处**：
  1. **左上角“＋ 添加窗口”**：唯一的常驻工具栏按钮，点开下拉目录（文本/图片/视频 + 高级：剧本导入；不再按“输入/素材/生成器”三组划分，改为按 3 种窗口直列 + “高级”小节）；
  2. **画布空白处右键 → 上下文菜单**：ReactFlow `onPaneContextMenu`（阻止默认菜单，菜单项与左上角目录同源同一份 `BOX_CATALOG` 常量），在右键位置创建窗口（`addNode` 带 `screenToFlowPosition` 坐标）；后续可扩展“在此处粘贴/自动布局”项。
- `BlueprintToolbar` 简化为：`＋ 添加窗口`、撤销/重做、`更多`（剧本导入、指标面板、自动布局）、状态条（运行中/错误数/就绪，含取消与清理）。
- 空画布：双击空白快速加文本框（保留）；`BlueprintOnboarding` 改为“三步引导”（加文本框 → 连到图片框 → 点生成）。
- 保留 MiniMap / Controls / 背景 / 快捷键（Ctrl+Z 等现有实现不动）。

---

## 3. 数据模型改造（Schema v2）

### 3.1 节点类型与端口表

```ts
export type BlueprintNodeType =
  | 'text-box'        // ← text-input
  | 'image-box'       // ← image-reference | image-generator
  | 'video-box'       // ← video-reference | video-generator
  | 'script-import';  // 保留（高级）；output 退役删除

export const BLUEPRINT_NODE_PORTS = {
  'text-box': [
    { id: 'text', direction: 'output', dataTypes: ['text'] },
  ],
  'image-box': [
    { id: 'prompt', direction: 'input', dataTypes: ['text', 'context'], multiple: true },
    { id: 'reference-images', direction: 'input', dataTypes: ['image'], multiple: true },
    { id: 'image', direction: 'output', dataTypes: ['image'] },
  ],
  'video-box': [
    { id: 'prompt', direction: 'input', dataTypes: ['text', 'context'], multiple: true },
    { id: 'reference-media', direction: 'input', dataTypes: ['image', 'video', 'audio'], multiple: true },
    { id: 'video', direction: 'output', dataTypes: ['video'] },
  ],
  'script-import': [{ id: 'context', direction: 'output', dataTypes: ['context'] }],
} as const satisfies Record<BlueprintNodeType, readonly BlueprintPortDefinition[]>;
```

> 端口 id 与旧 generator 类型**完全一致**（prompt / reference-images / reference-media / image / video / text / context / media），`graph-validation.ts` 的校验逻辑零改动，只是查表换数据源。

### 3.2 Config 结构

```ts
export interface TextBoxConfig {
  text: string;
  language?: string;   // zh/en/ja/auto
  role?: string;       // prompt/negative/dialogue/context
  skillRefs?: string[]; // ✨ AI 面板装载的技能（skill 库 name），随节点持久化（§5.3）
}

export interface ImageBoxConfig {
  /** 当前内容（导入或生成的最新结果，历史进媒体库）；无 mode 字段 */
  media: BlueprintMediaRef[];
  /** 存在即视为“生成型窗口”：含 model/aspectRatio/resolution/prompt(覆盖)/extraParams；执行层据此委托生成链路 */
  generation?: BlueprintImageGeneratorConfig;
  referenceImageRefs?: BlueprintMediaRef[]; // 抽屉手动追加的参考（与连线参考共用上限）
}

export interface VideoBoxConfig {
  media: BlueprintMediaRef[]; // 当前内容，无 mode 字段
  generation?: BlueprintVideoGeneratorConfig; // 含 referenceMediaRefs（role 字段已有）
}
```

- **取消 mode 的推导规则**：窗口是否走生成链路由“是否配置了 `generation`”决定——有 `generation`（即抽屉里选过模型/点过生成）→ executor 委托生成器；无 `generation` → 媒体直通。导入（拖入/素材库/上传）只写 `media`，不触碰 `generation`；生成完成把结果写回 `media` 并保留 `generation`（可再次生成）。UI 不再有“上传/生成”模式 tab，也不再有 `mode` 字段。

- **统一参考列表不新增持久化结构**：连线参考由 edges 实时推导（含 `order`），手动参考存 `referenceImageRefs` / `generation.referenceMediaRefs`；执行时 adapter 按“连线（按 order）→ 手动”合并构建 `referenceImages` / `uploadFiles`。
- **连线参考的角色指派**存 `generation.edgeReferenceRoles?: Record<edgeId, role>`（新增小字段，随 `BlueprintVideoGeneratorConfig` 扩展），保证首帧/尾帧/参考角色在 DAG 语义中可持久化，不依赖抽屉 UI 状态。

### 3.3 迁移映射表（`blueprint-migrations.ts` 新增 v2 case）

| 旧 type | 新 type | config 变换 | 边 handle |
|---|---|---|---|
| `text-input` | `text-box` | 原样（text/language/role 已兼容；`skillRefs` 为新增可选字段，旧数据缺省即无技能，无需迁移处理） | `text`→`text`（不变） |
| `image-reference` | `image-box` | `{ media: 原 media }`（无 generation → 媒体直通） | `image`→`image`（不变） |
| `image-generator` | `image-box` | `{ media: 原 output 单值转数组, generation: 原config }` | `prompt`/`reference-images`/`image` 全不变 |
| `video-reference` | `video-box` | `{ media: 原 media }`（无 generation → 媒体直通） | `video`→`video`（不变） |
| `video-generator` | `video-box` | `{ media: 原 output 单值转数组, generation: 原config }` | `prompt`/`reference-media`/`video` 全不变 |
| `script-import` | 不变 | 不变 | 不变 |
| `output` | **删除** | 节点及其连线直接移除（画布范式下无聚合导出语义；导出/入库/下载由各媒体窗口自身承担） | — |

> 迁移后无 `mode` 字段：旧 reference 节点不带 `generation`（媒体直通），旧 generator 节点带 `generation`（生成链路），语义由结构推导，无需显式标记。

- 执行状态（`execution`/task ref）随节点保留 → **任务恢复不受影响**（恢复按 nodeId + taskRef 工作，与 type 字符串无关）。
- 版本号继续走 `schema-version.ts` 与软件版本派生，migration 框架检测版本差自动跑。
- 节点尺寸变大后旧坐标可能重叠：迁移时对同 type 群组做一次简单的错位排布（y+40 递增），另提供工具栏"自动布局"（按拓扑层 x=层*400，层内 y 递增，无需引入 dagre）。

### 3.4 兼容策略

- **读旧写新**：打开旧蓝图 → migrate → 保存即 v2；不保留双 schema 运行时。
- 旧 type 字符串在 `NODE_EXECUTORS` / 校验表中删除，但 migration 单测覆盖全部 6 条映射（含 output 删除）+ 端口保持断言。

---

## 4. 组件架构

### 4.1 组件清单与替代关系

```
src/components/blueprint/
├── BlueprintView.tsx        🔧 改造：去掉右侧面板，画布全宽；持有 BoxConfigDrawer 状态
├── BlueprintCanvas.tsx      🔧 改造：盒子渲染表、端口高亮(onConnectStart/End)、双击加框
├── BlueprintToolbar.tsx     🔧 简化：删 RunActions 三按钮与 BeginnerModeToggle；“＋ 添加窗口”（唯一常驻添加入口）+ 撤销/重做 + 更多菜单 + 状态条
├── CanvasContextMenu.tsx   🆕 画布空白处右键菜单（onPaneContextMenu + BOX_CATALOG 同源菜单项，右键位置创建窗口）
├── BoxConfigDrawer.tsx      🆕 选中窗口下方的悬浮功能配置抽屉（圆角矩形）：顶部参考 / 中部文本 / 底部模型控制，图片/视频两态；底部“开始生成”
├── boxes/
│   ├── TextBox.tsx          🆕 ← TextInputNode.tsx（退役）
│   ├── ImageBox.tsx         🆕 ← ImageReferenceNode(隐) + ImageGeneratorNode（退役）；无模式区分，拖入即导入、生成结果写回，含下载按钮
│   ├── VideoBox.tsx         🆕 ← VideoReferenceNode + VideoGeneratorNode（退役）；无模式区分，拖入即导入、生成结果写回，含下载按钮
│   └── BoxShell.tsx         🆕 共享窗口壳：圆角矩形、状态色条、选中态、左右连接球、hover 工具条(删除/复制；失败态加重试按钮)
├── boxes/MediaPreview.tsx   🆕 图片完整展示 / 视频首帧与点击播放预览
├── nodes/NodeUI.tsx         ✅ 复用（NodeTextarea/NodeDropZone/NodeProgress/NodeError…）
├── AIAssistPanel.tsx        🔧 改造：改从底部/弹出呈现；新增“装载技能”chip 区（skill 引用，§5.3）
├── nodes/constants.ts       ✅ 复用（ASPECT_RATIOS 等）
├── BlueprintOnboarding.tsx  🔧 改三步引导
└── PropertiesPanel.tsx      ❌ 退役删除
```

> **工作室共享抽取**：把 `ImageStudio` / `VideoStudio` 中“参考管理 + 参数控件”的 JSX/逻辑抽为共享叶子组件（建议放 `panels/freedom/shared/`，如 `ReferenceList`、`GenParamControls`），工作室与 BoxConfigDrawer 共同消费；抽取以“组件搬移、零行为变更”为约束，自由页人工冒烟 + `npm run typecheck` 保障回归。

> **skill 引用新增件**：`src/lib/skills/skill-library.ts` 🆕（扫描/解析/缓存 skill，消费主进程 `skills:list` IPC，§5.3）；`electron/main.ts` 新增 `skills:list` handler（复用 `fs:readMarkdownFolder` 的目录读取实现，定位内置 + 自定义目录）。

### 4.2 布局变化

```
旧：[Toolbar          ]                    旧：节点(≤300px 小卡) + 右侧 PropertiesPanel
  [Canvas | Properties]                 新：窗口(圆角矩形, 展示内容) + 选中窗口下方悬浮功能配置抽屉
新：[Toolbar(简)      ]                        （按需弹出，不占常驻空间）
  [Canvas 全宽      ]       ○───○
               [选中窗口]
               [BoxConfigDrawer 悬浮覆盖]
```

### 4.3 关键交互实现要点

- **防拖拽误触**：窗口内 textarea/按钮/视频播放器加 `nodrag`（现有模式延续）；连接球不加 `nodrag`，仅连接球启动连线；textarea/播放器聚焦时禁用 Delete 键删窗口。
- **连接球实现**：底层仍使用 `@xyflow/react` `Handle`，视觉改为窗口左右两侧的小圆球；左侧 `type="target"`、右侧 `type="source"`，通过 CSS 在默认态、hover、connecting、invalid、valid 状态显示不同颜色和尺寸。为保持多种数据类型校验，连接球拖拽结束后根据 source/target 窗口类型和上下文选择实际端口，不能绕过 `canConnectBlueprintPorts`。
- **悬浮抽屉定位**：使用 React Flow `screenToFlowPosition` / `flowToScreenPosition` 或节点 DOM `getBoundingClientRect` 计算选中窗口底部中心点；抽屉挂载在画布 overlay 层而非节点内部，使用 `position:absolute` + `transform:translateX(-50%)`，同步 viewport/resize/drag 更新；设置边界修正避免抽屉超出画布。
- **选中状态管理**：沿用 `selectedNodeId` 作为唯一来源；`selectedNodeId !== null` 才渲染抽屉，切换节点先关闭旧抽屉再绑定新窗口，pane click / Escape 清空选择。
- **视频首帧**：媒体窗口使用 `<video preload="metadata" muted playsInline>`，未播放时展示首帧/封面；点击时调用 `play()`，播放失败回退为原生 controls；不要在窗口缩略态自动播放。
- **内容点击下载**：图片/视频窗口对当前内容（导入或生成）提供 `⬇ 下载` 按钮，统一调用 `saveFreedomMedia(url, filename)`（`src/lib/freedom/download-utils.ts`，与图片工作室同一实现：优先 Electron `saveFileDialog` 另存为，降级 Blob + `<a download>`）；按钮加 `nodrag` 防拖拽误触；下载失败 toast 提示。
- **memo 化**：盒子组件 `memo` + store 细粒度 selector（沿用现有模式）；生成进度只更新 `execution` 字段，避免全画布重渲。
- **单跑按钮（唯一执行入口）**：悬浮抽屉底部“开始生成” → `executeBlueprintRun('node', id)`；重试入口收进抽屉（选中失败窗口时显示，调 `retryNodeExecution`）；不再提供“运行下游”UI（引擎 capability 保留）。
- **失效传播**：上游盒子内容变化 → `getStaleDownstreamNodes`（已有）→ 下游盒子显示 stale 色条 + "重新生成"快捷键。

---

## 5. 执行层适配

### 5.1 Executor 适配器（`node-executors.ts` 新增）

```ts
// text-box: 直接输出 config.text（同旧 executeTextInput）
// image-box:
//   无 generation   → 输出 media[]（同旧 executeImageReference，multi 化）
//   有 generation   → 委托现有 executeImageGenerator 逻辑
//                     （prompt 合并、referenceImages 收集、FreedomImageParams 构造全部复用）
// video-box:
//   无 generation   → 输出 media[]
//   有 generation   → 委托现有 executeVideoGenerator 逻辑
//                     （onTaskCreated 落 taskRef → 恢复链路不变）
```

- `NODE_EXECUTORS` 注册表换成 4 个新 key；generator 逻辑抽成内部共享函数供适配器调用，避免复制。
- `mergePromptText` / `collectReferenceImageRefs` / `collectVideoUploadFiles`（input-merge.ts 体系）原样复用。
- **参数对齐工作室**：`BlueprintImageGeneratorConfig` / `BlueprintVideoGeneratorConfig` 本就 extends Freedom 参数（含 `extraParams`、`referenceMediaRefs[].role`）；adapter 补齐工作室在用的能力透传（webSearch、上传角色校验、`edgeReferenceRoles` 合并），确保“抽屉能配的参数，执行层都能收”。

### 5.2 运行与付费

- 单盒生成 = `executeBlueprintRun('node', boxId)`，UI 唯一入口在抽屉；`'downstream'` / `'all'` 仅引擎/测试内部使用，无 UI 入口。
- 付费确认：`PAID_NODE_TYPES` 改为按“配置了 `generation` 的 image-box/video-box”判定（adapter 内上报 isPaid，无 generation 的纯导入窗口不触发付费确认）。
- 指标：`runBlueprintWithMetrics` 包装不动，自动覆盖新类型。

### 5.3 文本窗口 AI 助手 · skill 引用（新增能力）

**背景**：`skill/seedance_SKILL.md` 目前是纯文档，项目内无任何加载代码；`requestAIAssist` 目前不支持附加上下文/自定义 system prompt（`AIAssistRequest` 仅 currentText/userInstruction/role/language/history，且 history 未真正拼入请求）。

**能力定义**：在文本窗口 ✨ AI 面板中，可装载 `skill/` 文件夹下的 md 技能文件；装载后 AI 生成的文案遵循所选技能的写作规范（如 seedance 技能 → 生成 Seedance 多模态提示词结构）。

**链路设计**（四层，全部复用现有件）：

1. **技能库读取（Electron 主进程）**：新增 `skills:list` IPC handler——定位内置 skill 目录，复用 `fs:readMarkdownFolder` 的实现（`electron/main.ts` 已有，递归读 md/≤500KB，直接抽公共函数或同逻辑重写），返回 `[{ name, description, filePath, content }]`（frontmatter 解析 name/description，取不到 name 则用文件名）；**内置 skill 目录定位**：开发环境走仓库根 `skill/`（`app.getAppPath()` 拼 `skill`），**生产环境依赖打包配置**——`electron-builder.yml` 的 `extraResources` 新增 `from: skill` 条目，运行时用 `process.resourcesPath` 拼 `skill`，两分支与 demo-data 的处理方式一致。
2. **技能库封装（渲染层）**：`src/lib/skills/skill-library.ts` 🆕——IPC 取列表（web 环境降级为 fetch 内置清单）+ 内存缓存 + frontmatter 解析 + 按 name 索引；对 UI 暴露 `listSkills()` / `getSkillContent(name)` / `subscribeSkills()`（供设置面板反映射目录变化）。
3. **AI 请求扩展（`ai-assist.ts` 🔧）**：`AIAssistRequest` 新增可选字段 `skillRefs?: string[]`；`requestAIAssist` 实现改为：有 skillRefs 时，拼接 `skill 系统指令 = 内置 buildSystemPrompt(role, language) + '\n\n' + 选中技能正文依次拼接`，作为 system prompt 传给 `callChatAPI`（底层已完全由调用方指定 system prompt，链路无障碍；参考剧本 Agent 的 `SCRIPT_AGENT_SYSTEM_PROMPT + agentContextFiles` 同范式）；无 skillRefs 时行为与现状完全一致（向后兼容）。
4. **UI（`AIAssistPanel.tsx` 🔧）**：面板顶部新增“装载技能”chip 区（全量技能 chip + 已装载态高亮，多选；chip tooltip 显示 description）；选择变化时同步写回 `config.skillRefs`（updateNode → undo 栈）；“开始生成”时把 `skillRefs` 传入 `requestAIAssist`。

**多选与体积控制**：允许装载多个技能（正文依次拼接）；单技能正文 ≤500KB（读取层已限）；拼接后超长时截断并 toast 提示；技能正文不写入节点 config（config 只存 name 列表，执行时按 name 现取内容，避免 config 膨胀与版本漂移）。

**自定义技能目录**：`skill-library.ts` 同步扫描一个用户自定义目录（默认无）；入口在 ✨ 面板“管理技能目录”→ 弹目录选择（复用 `dialog:openDirectory` IPC）→ 持久化到本地设置（`localStorage`，沿用 `createLocalStorage`/普通 persist，不进项目数据）。列表 = 内置 + 自定义合并，按 name 去重（内置优先）。

### 5.4 “分镜 → 蓝图”发送同步（既有链路对齐 v2）

**背景**：`useStoryboardToBlueprint` 链路已完整存在（勾选镜头 → `composeStoryboardToBlueprint` 组 `text-input` → `addNodeInCenter` 落位并自动选中 → `setActiveTab("blueprint")` 跳页 → 清选 + toast），用户无需重复操作即可在蓝图继续编辑。

**本次仅需同步**（不改交互）：
1. `storyboard-to-blueprint.ts` 的产出节点 type `text-input` → `text-box`（config 原样：text/language/role 已兼容，`sourceRef: { kind: 'shot', … }` 字段照旧）；
2. 同步 `director-to-blueprint.ts` / `script-to-blueprint.ts` 两个入口（同样产出旧 type，P0 类型重命名后必须跟进，否则运行时校验/注册表报错）；
3. 文本窗口头部显示来源徽标（“分镜”）强化来源感知（§2.2 已述）；
4. 发送后 `addNodeInCenter` 自动选中 → 新文本窗口自动弹出抽屉，用户可立即用 ✨ AI + skill 生成文案（无额外点击）。

---

## 6. 开发阶段与工作量

| Phase | 内容 | 产出物 | 预估 | 验收标准 |
|---|---|---|---|---|
| **P0 Schema v2 + 迁移** | types 新端口表/Config；migrations v2 映射；节点坐标错位排布；迁移单测 | `types/blueprint.ts`、`blueprint-migrations.ts`、测试 | 0.5–1 天 | 旧蓝图打开后全部显示为 3 种盒子，连线/执行态/媒体引用不丢；迁移测试全绿 |
| **P1 窗口组件 + 画布** | BoxShell/TextBox/ImageBox/VideoBox；圆角窗口内容展示；图片完整预览/视频首帧点击播放；左右连接球；**内容点击下载（saveFreedomMedia）**；Canvas 改造（渲染表/连接高亮/双击加窗/**空白右键菜单**）；Toolbar 简化（**删 RunActions 三按钮与 BeginnerModeToggle，单一“＋ 添加窗口”**）；PropertiesPanel 退役 | `boxes/*`、`CanvasContextMenu.tsx`、改造 3 文件 | 2–3 天 | 创建后只显示对应窗口内容；拖入图片/视频即导入；生成结果写回窗口；下载按钮可用；视频首帧可播放；连接球可拖线；文本可编辑；无右侧面板画布全宽；右键空白可加窗；工具栏无运行按钮 |
| **P2 BoxConfigDrawer 功能配置抽屉** | 默认关闭；选中窗口下方悬浮覆盖；圆角矩形；vaul 三段式抽屉（参考/文本/模型控制）；工作室共享叶子组件抽取；上游预览+覆盖开关；能力驱动参数控件；参考角色指派与拖拽调序；图片版“上传至素材资产管理” | `BoxConfigDrawer.tsx`、`panels/freedom/shared/*` | 2–2.5 天 | 未选中不显示；选中后准确跟随窗口并覆盖其他窗口；模型列表来自 model-registry；连线+手动参考可混排；“开始生成”可直接运行；自由页工作室回归无变化 |
| **P3 执行集成 + 文本窗口增强** | 3 个 executor 适配器；PAID 判定改按 generation 存在性；单跑/跑下游按钮接线；stale 视觉；**skill 引用四件套（skills:list IPC + skill-library + ai-assist 扩 skillRefs + AIAssistPanel 装载 chip）；electron-builder extraResources 加 skill/；三个 to-blueprint 转换器 type 同步 v2** | `node-executors.ts`、`skill-library.ts`、`ai-assist.ts`、`AIAssistPanel.tsx`、`electron-builder.yml`、转换器 3 文件 | 1.5–2 天 | 单盒生成→结果写回窗口→素材库；中断恢复回归通过；付费确认生效；✨ 装载 seedance_SKILL 后生成文案遵循其结构；分镜发送链路全绿 |
| **P4 打磨** | onboarding 三步引导；自动布局按钮；快捷键补充（Delete/双击）；空态文案 | 上述文件 | 1 天 | 新用户 3 分钟内完成"文本框→图片框→生成"路径 |

依赖关系：P0 → P1 → P2 → P3 严格串行；P4 可与 P3 并行。每个 Phase 结束跑全量 `npm run test` + `npm run typecheck`。skill 引用四件套（§5.3）在 P3 内完成，但 `AIAssistPanel` 呈现形态改造（底部弹出）随 P2 抽屉体系落地。

---

## 7. 测试计划

- **保留**：dag-traversal 42 / input-merge 29 / execution-engine 25 等引擎测试（不触碰逻辑，应全绿）。
- **改造**：`graph-validation`（30）与 `node-executors`（15）中 node type 字符串换新 key，断言逻辑不变。
- **新增**：
  - `blueprint-migrations` v2 映射：6 条类型映射（含 output 删除）× 端口/config/执行态保持断言（~12 个）。
  - `boxes` 组件渲染：三窗口默认态/内容预览/拖拽导入无模式区分/生成结果写回/点击下载（mock `saveFreedomMedia`）/视频首帧播放/连接球（@testing-library，~15 个）。
  - `CanvasContextMenu` + 简化 Toolbar：右键空白弹菜单且菜单项与“＋ 添加窗口”同源（BOX_CATALOG）、右键位置创建窗口坐标正确、工具栏不再渲染运行三按钮与 BeginnerModeToggle、beginnerMode 字段从 store 清除后旧持久化数据无害（~5 个）。
  - `BoxConfigDrawer`：默认关闭、选中定位、上游合并预览、覆盖开关写 config、模型选择写 generation.model、连线+手动参考合并与角色指派、参考缩略图小尺寸渲染与调序、右键插入引用标签到光标（视频版）、图片版“上传至素材资产管理”触发 useAssetUpload、“开始生成”触发单节点执行（~18 个）。
  - `AIAssistPanel` skill 引用：技能 chip 列表渲染与 description tooltip、勾选写 config.skillRefs、重开保持勾选、请求携带 skillRefs 且 system prompt 含技能正文、未勾选时请求不携带（向后兼容）、自定义目录扫描与内置去重（~8 个，`skill-library.ts` frontmatter 解析/去重/缓存单测在内）。
  - `storyboard-to-blueprint`：产出 `text-box`、`sourceRef.kind==='shot'`、发送后自动选中（~3 个改造断言）。
- 基线：当前 624 tests / 45 files，预计重构后 ~671 tests。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 旧蓝图迁移丢执行态/媒体引用 | P0 迁移单测逐字段断言；taskRef 随节点走，恢复链路按 nodeId 不受 type 影响；上线前用 demo-data 旧项目人工回归 |
| 大卡片导致旧坐标布局重叠 | 迁移时群组错位 + "自动布局"按钮（拓扑分层，不引新依赖） |
| vaul 抽屉与 ReactFlow 焦点/滚轮冲突 | 抽屉 open 时 canvas `pointer-events-none`；BoxConfigDrawer 用受控 open，不复用 NodeUI 内嵌 |
| 工作室共享抽取引发“自由”页回归 | 抽取以“组件搬移、零行为变更”为约束；共享叶子组件先落测试再接入抽屉；ImageStudio/VideoStudio 人工冒烟 + typecheck |
| 右键插入引用与参考增删的标签同步（如 @image_file_2 被删后序号变化） | 标签重算沿用工作室 getMultiRefTag 规则；同步替换仅限未手改的标签；单测覆盖增/删/重序三种场景 |
| ModelSelector 的能力映射与蓝图参数不匹配（如某模型无 duration） | ModelSelector 已含 inputs 元数据（prompt/aspect_ratio/duration/resolution），按 inputs 动态显隐参数控件 |
| textarea 内编辑触发频繁 updateNode → undo 栈爆炸 | undo-redo 已有节流/合并策略则沿用；否则输入态本地 state，失焦才提交 store |
| 删除 PropertiesPanel 后部分高级字段无处编辑（negativePrompt/extraParams） | BoxConfigDrawer 折叠"高级"区承接；script-import 的少量字段内联到各自卡片 |
| 生产包内 skill 目录定位失败（extraResources 未配/路径差异） | 开发/生产两分支定位 + 失败降级为空技能列表并提示“未找到技能目录”；打包后人工验证 `resources/skill/seedance_SKILL.md` 存在 |
| 三个 to-blueprint 转换器类型不同步导致运行时报错 | P0 类型重命名时 grep `text-input|image-reference|video-reference` 全仓满扫，转换器/测试/demo-data 同批替换；迁移单测 + 发送链路单测覆盖 |
| skill 正文拼接超长挤占上下文 | 单技能 ≤500KB（读取层已限）+ 拼接后总长截断 + toast 提示；技能正文不存 config 只存 name |
| 删除全局运行按钮后，多窗口批量生成效率下降 | 新范式 = 每窗口独立产出独立确认，与画布“逐窗口创作”心智一致（已定案无过渡期）；Onboarding 三步引导强化“选中→抽屉→开始生成”心智；若后续确有批量诉求，再评估“按连线顺序连跑”类方案，本期不做 |
| beginnerMode 从 store 删除后旧持久化数据残留 | persist 字段删除后多余 key 无害（zustand 忽略未知字段）；迁移不主动清理，避免触碰其他项目数据；UI 不再读取该字段 |
| 画布右键与浏览器默认菜单/面板拖拽冲突 | onPaneContextMenu 首行 preventDefault；菜单仅空白处触发（节点上右键不弹）；点击任意处/Esc 关闭（与抽屉同范式） |

## 9. 明确不做（Non-goals）

- 不引入 dagre/elk 等自动布局库（手写拓扑分层足够）。
- 不改执行引擎调度策略、不新增生成后端能力（Freedom API 边界保持，遵守 §9.3 生成链边界注释）；`executeBlueprintRun` 的 `'downstream'`/`'all'` mode 引擎层保留，仅 UI 不暴露。
- 不做协作/模板市场/跨设备同步（沿用原计划 Non-goals）。
- 不物理删除旧项目数据；`image-reference` 等旧 type 仅存在于迁移输入侧（唯一例外：迁移时按本计划删除旧 `output` 节点及其连线）。

---

## 10. 开发步骤与顺序总表

> 本节将 §6 阶段表展开为可执行的步骤清单，每步标注**前置依赖**、**涉及文件**、**验收方式**。步骤按 Phase 内严格串行排列，Phase 间依赖见 §6。

### P0 Schema v2 + 迁移（0.5–1 天）

| 步骤 | 内容 | 涉及文件 | 前置 | 验收 |
|---|---|---|---|---|
| P0-1 | 定义新类型：`BlueprintNodeType` 新枚举（text-box/image-box/video-box）、`BLUEPRINT_NODE_PORTS` 新端口表、`TextBoxConfig`/`ImageBoxConfig`/`VideoBoxConfig` 接口、`skillRefs` 字段 | `src/types/blueprint.ts` | 无 | typecheck 通过；新旧类型并存不冲突 |
| P0-2 | 新增 v2 迁移映射：6 条 type 重映射（含 output 节点及其连线删除）+ config 变换（media 数组化、无 mode 字段）+ 坐标错位排布 | `src/lib/blueprint/blueprint-migrations.ts` | P0-1 | 迁移函数可被调用；映射表覆盖全部旧类型（含 output 删除） |
| P0-3 | 更新端口校验表引用：`graph-validation.ts` 查表从旧 `BLUEPRINT_NODE_PORTS` 切到新 key（逻辑零改动，仅数据源切换） | `src/lib/blueprint/graph-validation.ts` | P0-1 | 现有 graph-validation 测试全绿 |
| P0-4 | 更新 executor 注册表：`NODE_EXECUTORS` 新增 4 个 key（text-box/image-box/video-box/script-import），旧 key 暂保留供迁移期间兼容 | `src/lib/blueprint/node-executors.ts` | P0-1 | 现有 node-executors 测试全绿 |
| P0-5 | 三个 to-blueprint 转换器类型同步：产出 type `text-input`→`text-box`、`image-reference`→`image-box`、`video-reference`→`video-box` 等；全仓 grep 旧类型字符串确认无遗漏 | `src/lib/blueprint/storyboard-to-blueprint.ts`、`director-to-blueprint.ts`、`script-to-blueprint.ts` | P0-1 | 转换器产出的节点 type 为新值；迁移单测覆盖 |
| P0-6 | `electron-builder.yml` extraResources 新增 `skill/` 目录打包 | `electron-builder.yml` | 无 | 打包后 `resources/skill/` 存在 |
| P0-7 | 编写迁移单测：6 条映射（含 output 删除）× 端口保持/config 变换/执行态保留/坐标错位断言（~12 个） | `test/lib/blueprint/blueprint-migrations.test.ts`（新建或扩展） | P0-2 | `npm run test` 全绿 |
| P0-8 | **Phase 门禁**：全量 `npm run test` + `npm run typecheck`；用 demo-data 旧蓝图文件验证迁移后可正常打开 | — | P0-1~7 | 0 错误；旧蓝图打开后显示为 3 种盒子 |

### P1 窗口组件 + 画布（2–3 天）

| 步骤 | 内容 | 涉及文件 | 前置 | 验收 |
|---|---|---|---|---|
| P1-1 | 创建 `BoxShell.tsx`：圆角矩形壳、状态色条（running/success/error/stale）、选中态高亮边框+阴影、左右连接球（Handle 底层+CSS 状态样式）、hover 工具条（删除/复制；失败态加重试） | `src/components/blueprint/boxes/BoxShell.tsx` | P0-1 | 组件可渲染；连接球可拖拽 |
| P1-2 | 创建 `MediaPreview.tsx`：图片完整展示（object-contain）+ 视频首帧（`<video preload="metadata" muted playsInline>`）点击播放/暂停/静音/全屏 | `src/components/blueprint/boxes/MediaPreview.tsx` | 无 | 图片/视频均可正确预览 |
| P1-3 | 创建 `TextBox.tsx`：内联 textarea（复用 NodeTextarea）、字数统计、✨ AI 按钮入口、来源徽标（sourceRef.kind==='shot'）、未选中时文本摘要展示 | `src/components/blueprint/boxes/TextBox.tsx` | P1-1 | 文本可编辑；实时保存进 config |
| P1-4 | 创建 `ImageBox.tsx`：无模式区分的图片容器（拖入/素材库/上传即导入为当前内容、生成结果写回展示）、空态+"生成"按钮、当前内容下载按钮（`saveFreedomMedia`） | `src/components/blueprint/boxes/ImageBox.tsx` | P1-1, P1-2 | 拖入图片即导入；生成结果写回窗口；下载按钮可保存本地 |
| P1-5 | 创建 `VideoBox.tsx`：无模式区分的视频容器（拖入视频即导入、生成结果写回）、首帧预览+播放控件、参考缩略条预览、提示区（上游文本预览/点击输入占位）、当前内容下载按钮 | `src/components/blueprint/boxes/VideoBox.tsx` | P1-1, P1-2 | 拖入视频即导入；首帧可播放；下载按钮可用 |
| P1-6 | 创建 `CanvasContextMenu.tsx`：`onPaneContextMenu` 阻止默认菜单、`BOX_CATALOG` 常量（3 窗口直列+高级小节，无输出节点）、右键位置 `screenToFlowPosition` 创建窗口、点击/Esc 关闭 | `src/components/blueprint/CanvasContextMenu.tsx` | P0-1 | 右键空白弹菜单；选中项在右键位置创建窗口；目录无输出节点 |
| P1-7 | 改造 `BlueprintCanvas.tsx`：渲染表从 7 节点组件切到 3 盒子组件、`onConnectStart/End` 端口高亮、双击加文本框、接入 CanvasContextMenu、`onPaneClick` 清选 | `src/components/blueprint/BlueprintCanvas.tsx` | P1-3~6 | 画布渲染 3 种盒子；连接球可连线；右键可加窗 |
| P1-8 | 简化 `BlueprintToolbar.tsx`：删除 `RunActions`（三运行按钮）、删除 `BeginnerModeToggle`、`AddNodeMenu` 改为"＋ 添加窗口"（BOX_CATALOG 同源，无输出节点）、保留撤销/重做、新增"更多"菜单（剧本导入/指标/自动布局）、状态条（运行中/错误/就绪+取消+清理） | `src/components/blueprint/BlueprintToolbar.tsx` | P1-6 | 工具栏无运行按钮；无新手/高级切换；添加菜单可创建 3 种窗口；无输出节点入口 |
| P1-9 | 清理 store：删除 `beginnerMode`/`toggleBeginnerMode` 字段与 action（`blueprint-store.ts`）；`AddNodeMenu` 不再按模式过滤节点 | `src/stores/blueprint-store.ts` | P1-8 | typecheck 通过；store 无 beginnerMode 引用 |
| P1-10 | 改造 `BlueprintView.tsx`：去掉右侧 PropertiesPanel 区域、画布全宽、持有 BoxConfigDrawer 状态（selectedNodeId） | `src/components/blueprint/BlueprintView.tsx` | P1-7, P1-8 | 画布占满宽度；无右侧面板 |
| P1-11 | 退役 `PropertiesPanel.tsx`：删除文件；全仓 grep 确认无残留 import | `src/components/blueprint/PropertiesPanel.tsx`（删除） | P1-10 | typecheck 通过；无 PropertiesPanel 引用 |
| P1-12 | 改造 `BlueprintOnboarding.tsx`：三步引导（加文本框→连图片框→点生成）、显隐条件改为 activeProjectId + localStorage 标记（不依赖 beginnerMode） | `src/components/blueprint/BlueprintOnboarding.tsx` | P1-9 | 新项目首次进入显示引导；完成后不再出现 |
| P1-13 | 编写测试：boxes 组件渲染 ~15 个（默认态/内容预览/拖入导入无模式/生成结果写回/点击下载 mock saveFreedomMedia/视频首帧/连接球）+ CanvasContextMenu/Toolbar ~5 个 | `test/components/blueprint/boxes/*.test.tsx`、`CanvasContextMenu.test.tsx` | P1-3~8 | `npm run test` 新增 ~20 个全绿 |
| P1-14 | **Phase 门禁**：全量 `npm run test` + `npm run typecheck`；人工验证：创建 3 种窗口→内容展示→拖入图片/视频即导入→下载按钮保存文件→连接球连线→右键加窗→工具栏无运行按钮 | — | P1-1~13 | 0 错误；人工冒烟通过 |

### P2 BoxConfigDrawer 功能配置抽屉（2–2.5 天）

| 步骤 | 内容 | 涉及文件 | 前置 | 验收 |
|---|---|---|---|---|
| P2-1 | 工作室共享叶子组件抽取：从 `ImageStudio`/`VideoStudio` 中抽取"参考管理"（ReferenceList：缩略图条、拖拽调序、删除、来源徽标）与"参数控件"（GenParamControls：ModelSelector + 能力驱动参数）到 `panels/freedom/shared/`；**组件搬移零行为变更** | `src/components/panels/freedom/shared/ReferenceList.tsx`（新建）、`GenParamControls.tsx`（新建）；`ImageStudio.tsx`、`VideoStudio.tsx`（改为 import 共享组件） | 无 | 自由页 ImageStudio/VideoStudio 人工冒烟无变化；typecheck 通过 |
| P2-2 | 创建 `BoxConfigDrawer.tsx` 骨架：vaul 载体、受控 open、三段式布局（参考/文本/模型控制）、按 `kind: 'image' \| 'video'` 切内容 | `src/components/blueprint/BoxConfigDrawer.tsx` | P2-1 | 抽屉可打开/关闭；三段布局正确 |
| P2-3 | 实现悬浮抽屉定位：overlay 层挂载、`getBoundingClientRect` 计算选中窗口底部中心、`position:absolute` + `translateX(-50%)`、viewport/resize/drag 实时跟随、边界修正 | `BoxConfigDrawer.tsx` + `BlueprintCanvas.tsx` | P2-2 | 选中窗口后抽屉准确定位在下方 8–12px；拖动窗口抽屉跟随 |
| P2-4 | 实现参考区（①顶部）：小缩略图条（36×36px、单行 ≤48px、横向滚动）、来源徽标（◇连线/◆手动/▲素材库）、角标序号、hover 放大预览+删除钮、拖拽调序；连线参考+手动参考混排合并逻辑 | `BoxConfigDrawer.tsx`（参考区段）+ `ReferenceList.tsx` | P2-1, P2-2 | 缩略图正确渲染；可拖拽调序/删除；连线+手动混排 |
| P2-5 | 实现文本区（②中部）：复用 `PromptTextarea`、上游文本框连线→折叠预览+自定义覆盖开关（覆盖写 `generation.prompt`）；无连线→直接输入 | `BoxConfigDrawer.tsx`（文本区段） | P2-2 | 上游预览正确；覆盖开关可切换；直接输入可用 |
| P2-6 | 实现视频版文本区扩展：右键参考缩略图→`insertAtCursor(@image_file_N)`、`getMultiRefTag` 编号规则、标签随参考增删自动重算、toast 提示 | `BoxConfigDrawer.tsx`（视频文本区） | P2-4, P2-5 | 右键插入标签到光标；增删参考后标签序号正确更新 |
| P2-7 | 实现模型控制区（③底部）：复用 `ModelSelector`（type: 'image' \| 'video'）、能力驱动参数控件（aspectRatio/duration/resolution 等随模型动态显隐）、"开始生成"主按钮（`executeBlueprintRun('node', boxId)`）+"仅保存配置" | `BoxConfigDrawer.tsx`（模型控制段）+ `GenParamControls.tsx` | P2-1, P2-2 | 模型列表来自 model-registry；参数随模型变化；"开始生成"可触发执行 |
| P2-8 | 实现图片版专属：参考上限 10 校验、"⬆ 上传至素材资产管理"按钮（`useAssetUpload`） | `BoxConfigDrawer.tsx`（图片版扩展） | P2-4, P2-7 | 超限 toast 提示；上传按钮可入库 |
| P2-9 | 实现视频版专属：参考角色指派（首帧/尾帧/参考）、`veo-capability`/`seedance-capability`/HappyHorse 校验、`edgeReferenceRoles` 持久化 | `BoxConfigDrawer.tsx`（视频版扩展） | P2-4, P2-7 | 角色可指派；校验实时生效；角色写入 config |
| P2-10 | 实现生成中状态：运行中再次打开抽屉→显示进度+取消（复用 store abortController）；生成完成→自动关闭抽屉（可配置） | `BoxConfigDrawer.tsx` | P2-7 | 运行中抽屉显示进度；完成后自动关闭 |
| P2-11 | 编写 BoxConfigDrawer 测试 ~18 个：默认关闭、选中定位、上游合并预览、覆盖开关、模型选择、参考混排+角色指派、缩略图渲染+调序、右键插入引用（视频版）、上传素材库、开始生成 | `test/components/blueprint/BoxConfigDrawer.test.tsx` | P2-2~10 | `npm run test` 新增 ~18 个全绿 |
| P2-12 | **Phase 门禁**：全量 `npm run test` + `npm run typecheck`；人工验证：选中窗口→抽屉定位正确→参考区/文本区/模型区功能完整→自由页工作室回归无变化 | — | P2-1~11 | 0 错误；人工冒烟通过（蓝图+自由页双验） |

### P3 执行集成 + 文本窗口增强（1.5–2 天）

| 步骤 | 内容 | 涉及文件 | 前置 | 验收 |
|---|---|---|---|---|
| P3-1 | 创建 3 个 executor 适配器：text-box（直接输出 config.text）、image-box（无 generation→media[] / 有 generation→委托 executeImageGenerator）、video-box（无 generation→media[] / 有 generation→委托 executeVideoGenerator）；generator 逻辑抽成内部共享函数 | `src/lib/blueprint/node-executors.ts` | P0-4, P2-7 | 适配器可被 NODE_EXECUTORS 调用 |
| P3-2 | 更新付费判定：`PAID_NODE_TYPES` 改为按"配置了 `generation` 的 image-box/video-box"判定（adapter 内上报 isPaid） | `src/lib/blueprint/node-executors.ts`、`execution-bridge.ts` | P3-1 | 付费确认在生成窗口触发；纯导入窗口不触发 |
| P3-3 | 实现 stale 视觉：上游盒子内容变化→`getStaleDownstreamNodes`→下游盒子显示 stale 色条+"重新生成"快捷操作 | `BoxShell.tsx`、`BlueprintCanvas.tsx` | P3-1 | 上游变化后下游显示 stale 标识 |
| P3-4 | 新增 `skills:list` IPC handler：定位内置 skill 目录（开发 `app.getAppPath()`/skill、生产 `process.resourcesPath`/skill）、复用 `fs:readMarkdownFolder` 实现、返回 `[{name, description, filePath, content}]`（frontmatter 解析） | `electron/main.ts` | P0-6 | IPC 可调用；返回 seedance_SKILL.md 数据 |
| P3-5 | 创建 `skill-library.ts`：IPC 取列表+内存缓存+frontmatter 解析+按 name 索引；暴露 `listSkills()`/`getSkillContent(name)`/`subscribeSkills()`；支持自定义目录（`dialog:openDirectory` + localStorage 持久化）；内置+自定义合并去重 | `src/lib/skills/skill-library.ts` | P3-4 | listSkills 返回技能列表；自定义目录可添加/去重 |
| P3-6 | 扩展 `ai-assist.ts`：`AIAssistRequest` 新增 `skillRefs?: string[]`；有 skillRefs 时拼接技能正文到 system prompt；无 skillRefs 时行为不变（向后兼容） | `src/lib/blueprint/ai-assist.ts` | P3-5 | 携带 skillRefs 时 system prompt 含技能正文；不携带时与现状一致 |
| P3-7 | 改造 `AIAssistPanel.tsx`：顶部新增"装载技能"chip 区（全量技能 chip + 已装载高亮 + description tooltip）、多选写 `config.skillRefs`、重开保持、"管理技能目录"入口 | `src/components/blueprint/AIAssistPanel.tsx` | P3-5, P3-6 | chip 列表正确渲染；勾选写 config；重开保持 |
| P3-8 | 编写测试：executor 适配器 ~5 个、skill-library ~5 个（frontmatter 解析/去重/缓存）、AIAssistPanel skill 引用 ~8 个、storyboard-to-blueprint 改造 ~3 个 | `test/lib/blueprint/node-executors.test.ts`、`test/lib/skills/skill-library.test.ts`、`test/components/blueprint/AIAssistPanel.test.tsx` | P3-1~7 | `npm run test` 新增 ~21 个全绿 |
| P3-9 | **Phase 门禁**：全量 `npm run test` + `npm run typecheck`；人工验证：单盒生成→结果写回窗口→素材库；中断恢复回归；付费确认生效；✨ 装载 seedance_SKILL 后生成文案遵循其结构；分镜发送链路全绿；窗口下载按钮可保存文件 | — | P3-1~8 | 0 错误；人工冒烟通过 |

### P4 打磨（1 天）

| 步骤 | 内容 | 涉及文件 | 前置 | 验收 |
|---|---|---|---|---|
| P4-1 | Onboarding 三步引导最终打磨：文案、动画、跳过逻辑 | `BlueprintOnboarding.tsx` | P1-12 | 新用户 3 分钟完成"文本框→图片框→生成"路径 |
| P4-2 | 自动布局按钮：拓扑分层（x=层×400，层内 y 递增） | `BlueprintToolbar.tsx`（更多菜单项）、`blueprint-store.ts`（layout action） | P1-8 | 点击后节点不重叠、层级清晰 |
| P4-3 | 快捷键补充：Delete 删选中窗口（textarea 聚焦时禁用）、Escape 关闭抽屉/清选 | `BlueprintCanvas.tsx`、`BoxConfigDrawer.tsx` | P1-7, P2-2 | 快捷键响应正确；不误触 |
| P4-4 | 空态文案：画布空态提示、窗口空态（无图片/无视频/无文本）、抽屉空态（无参考） | 各盒子组件 + `BoxConfigDrawer.tsx` | P1-3~5, P2-2 | 空态提示清晰、引导操作 |
| P4-5 | **最终门禁**：全量 `npm run test` + `npm run typecheck`；完整人工冒烟：创建→连线→配置→生成→结果展示→素材库→分镜发送→AI+skill→右键菜单→自动布局 | — | P4-1~4 + P0~3 | 0 错误；全链路冒烟通过 |

### 依赖关系总览

```
P0 ──→ P1 ──→ P2 ──→ P3
                  ↘ P4（可与 P3 并行）
```

- **P0 → P1**：新类型定义后才能写盒子组件；迁移完成后才能验证旧数据兼容
- **P1 → P2**：盒子组件壳（BoxShell）和画布改造完成后才能接入抽屉
- **P2 → P3**：抽屉"开始生成"按钮接线依赖 executor 适配器；但 P2 的 UI 骨架不依赖 P3（可先用 stub executor）
- **P3 ↔ P4**：P4 打磨项不阻塞 P3 核心功能，可并行推进
- **P2-1（工作室共享抽取）**：无前置依赖，可与 P0 并行启动以缩短关键路径
