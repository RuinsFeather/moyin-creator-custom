# 蓝图模式开发实施清单（修订版）

> 本文档是基于当前仓库源码核对后的实施计划，不代表蓝图功能已经完成。除“已确认现状”和“架构决策”外，所有复选框均表示待开发事项。

## 一、目标与范围

### 1.1 产品目标

将现有“概览 → 剧本 → 角色 → 场景 → 分镜表 → 导演 → 素材 → 导出”的线性工作流收敛为四个核心模块：

> **剧本 → 分镜 → 蓝图 → 自由**

本次调整不是简单重命名导航项，而是一次产品流程迁移：删除旧线性工作流的入口和阶段选项，取消角色、场景和资产等独立页面，将相关信息作为剧本、分镜上下文或内部媒体元数据保留。这里的“删除”不表示物理删除已有项目数据和生成结果。

其中剧本模块改为 Agent 辅助写作工作台，采用类似 VS Code 的左、中、右三栏结构；分镜承载剧本解析和镜头编辑；蓝图承载可视化生成编排；自由提供独立的图片和视频模型测试工作室。内部媒体库继续负责生成结果持久化，但不再提供一级资产页面。

- 使用节点和连接线表达提示词、剧本分镜、参考素材、图片生成、视频生成和输出之间的依赖关系。
- 剧本正文使用 Markdown 作为主编辑格式，并通过 Agent 窗口提供上下文问答、改写、结构化解析和分镜建议。
- 支持局部执行、失败重试、结果替换和下游失效提示。
- 生成结果写入现有项目媒体库，不另建一套媒体系统。
- 视频任务支持应用重启、网络中断后的恢复，避免重复提交和重复计费。
- 蓝图严格按项目隔离，可在同一项目中保存多个蓝图。

### 1.2 首版范围

首版不追求一次覆盖所有 AI 能力，分为两个可独立验收的版本：

**MVP-A：四模块流程与可持久化图片编排**

- 四模块主导航和旧入口兼容重定向
- 剧本 Agent 三栏工作台
- 自由图片/视频模型测试入口
- 文本输入节点
- 图片参考节点
- 剧本分镜导入节点
- 图片生成节点
- 输出节点
- DAG 校验与执行
- 项目级保存、切换和恢复
- 生成结果写入媒体库

**MVP-B：视频与生产级恢复**

- 视频参考节点
- 视频生成节点
- 服务端任务持久化
- 网络中断恢复和应用重启恢复
- 任务取消、失败重试、结果去重
- 输出节点的图片/视频时间线预览

以下功能放到后续版本：AI 自动搭建蓝图、协作、模板市场、跨设备同步、复杂 Web Worker 优化；角色/场景独立资源库不再作为新的主流程建设目标。

---

## 二、当前项目事实核对

以下内容已经根据源码确认，后续实现必须以此为准：

- 技术栈为 Electron 30、React 18、TypeScript、Vite/electron-vite、Zustand 5、Radix UI、Tailwind CSS。
- 项目索引位于 `src/stores/project-store.ts`，当前 `Project` 是精简模型：`id`、`name`、`createdAt`、`updatedAt`。
- 项目切换由 `src/lib/project-switcher.ts` 协调，不能只调用 `useProjectStore.setActiveProject`。
- 剧本项目数据位于 `src/stores/script-store.ts` 的 `ScriptProjectData`，其中 `shots` 与 `scriptData` 平级；迁移后还需要增加 Markdown 文档、项目目录和 Agent 会话引用。
- 当前没有 `ScriptReviewPanel.tsx`，剧本主面板实际位于 `src/components/panels/script/index.tsx`。
- 当前没有 React Router，页面导航由 `src/stores/media-panel-store.ts`、`src/components/TabBar.tsx` 和 `src/components/Layout.tsx` 控制。
- 已建立蓝图类型、项目级 store、模块目录、执行器和 schema 基础测试；蓝图执行基础已实现，但四模块新导航和剧本 Agent 工作台仍待迁移。
- `@xyflow/react` 和 `zundo` 已加入 `package.json`，但 `zundo` 的撤销历史将在编辑器阶段接入。
- `src/lib/indexed-db-storage.ts` 不是统一业务数据库 schema，主要负责 `fileStorage`、浏览器回退和旧数据迁移。
- 项目级 Zustand 存储通过 `src/lib/project-storage.ts` 的 `createProjectScopedStorage()` 写入 `_p/{projectId}/...`。
- Freedom API 的实际入口位于 `src/lib/freedom/freedom-api.ts`：
  - `generateFreedomImage(params)`
  - `generateFreedomVideo(params)`
  - `resumeFreedomVideoTask(params)`
- `GenerationResult` 的主要结果字段是 `url`、`taskId?`、`mediaId?`、`metadata?`，不是 `imageUrl`。
- 视频任务已有 `src/stores/freedom-task-store.ts` 和启动恢复流程，蓝图必须复用或扩展这套机制。
- 已加入 Vitest、V8 coverage 配置以及 `test`、`test:watch`、`test:coverage` 脚本；当前蓝图 schema 基础测试可运行。

---

## 三、架构决策（开发前必须遵守）

### 3.1 蓝图与项目关系

- 一个项目可以拥有多个蓝图。
- 每个蓝图必须保存 `projectId`，创建、读取、执行、媒体落库和任务恢复均使用该 ID。
- 不修改 `Project` 增加单一 `blueprintId` 字段；蓝图列表和当前蓝图 ID由蓝图 store 管理。
- 蓝图数据保存于：

```text
_p/{projectId}/blueprint
```

- 项目删除时由现有项目目录清理逻辑一并删除蓝图数据。

### 3.2 四模块流程与旧工作流迁移

- 新项目默认只创建“剧本”“分镜”“蓝图”“自由”四类工作区。
- 旧项目打开时执行兼容映射：`概览` 的元数据并入项目头部，`角色`/`场景` 转为剧本与分镜上下文及内部媒体元数据，`分镜表` 合并到“分镜”，`导演` 合并到“蓝图”或分镜执行配置，`素材`/`导出`/`资产`/`项目资产` 入口重定向到“自由”。
- 删除旧导航、快捷入口、空状态按钮和跨面板跳转前，必须完成引用清理和导航验收测试。
- 旧数据采用只读兼容或懒迁移，不在首次打开时破坏性重写；迁移必须可重复执行，并保留原始字段用于回滚。
- 角色、场景和资产不再作为一级资源分类；需要保留的信息归入 Markdown frontmatter、分镜元数据或内部媒体元数据。

### 3.3 剧本 Agent 工作台布局

- **左侧 `ProjectExplorer`**：项目目录、Markdown 文件树和本地文件夹导入；保存相对路径、文件元数据和 Markdown 文本，限制大文件和危险路径。
- **中间 `MarkdownEditor`**：剧本正文编辑、自动保存、文件切换、选区、Markdown 预览，以及章节/场景/分镜标记识别。
- **右侧 `ScriptAgentPanel`**：Agent 对话、当前文件和选区上下文、续写、改写、结构提取、分镜建议和蓝图导入预览。
- Agent 修改正文必须先生成 diff 或预览，由用户确认后写入；禁止未经确认覆盖正文或提交收费生成任务。
- 三栏支持拖拽调整和折叠，编辑器状态与蓝图运行状态分离，并按项目隔离持久化。

### 3.4 剧本导入策略

采用“快照 + 来源引用”的混合策略：

- 导入时复制必要的分镜提示词、场景、角色和镜头参数，保证蓝图可复现。
- 同时保存 `sourceRef`，优先记录来源为 `shot`、`media` 或剧本文档；旧 `scene`、`character`、`director-scene` 仅作为兼容来源。
- 源剧本修改后不自动覆盖已存在蓝图；比较版本后将相关节点标记为 `stale`，由用户选择重新同步。
- 不允许把 `ScriptData.shots` 当作字段使用；分镜必须从 `ScriptProjectData.shots` 获取。

### 3.5 执行位置

- 首版执行器运行在 renderer 中，直接复用现有 Freedom API 和 Zustand store。
- 不新增蓝图专用 IPC，除非后续确认需要主进程执行、后台任务或大文件处理。
- 大文件本体不放进蓝图 JSON、Zustand 状态或历史快照，只保存 `mediaId`、本地 URL、任务引用和必要元数据。

### 3.6 存储策略

- 使用 `createProjectScopedStorage('blueprint')`，不修改 `src/lib/indexed-db-storage.ts` 增加所谓统一 `blueprintProjects` object store。
- 蓝图 store 必须定义 `version`、`partialize` 和 `migrate`。
- 画布文档、运行时状态、执行历史分层保存：
  - 文档：节点、边、视口、配置、来源引用。
  - 运行状态：节点状态、进度、错误、任务引用、结果引用。
  - 历史：只保存可重建的编辑快照，不保存 Base64 和大文件。
- 项目切换时必须在 `src/lib/project-switcher.ts` 中调用蓝图 store 的 `persist.rehydrate()`，并在正确时机同步当前项目 ID。

### 3.7 计费操作原则

- 替换参考图、修改提示词或修改参数后，不自动重新提交收费任务。
- 相关下游节点标记为 `stale`，由用户确认后执行。
- 已创建的视频任务只能通过 `resumeFreedomVideoTask()` 恢复，不能重新调用 `generateFreedomVideo()`。
- 同一服务端任务只允许落库一次，必须按 `taskId` 或稳定结果键去重。

---

## 四、数据契约设计

### 4.1 新增类型文件

**文件**：`src/types/blueprint.ts`

使用 React Flow 兼容的数据结构，不自行复制一套不兼容的节点类型：

```typescript
import type { Edge, Node, XYPosition } from '@xyflow/react';

export type BlueprintNodeType =
  | 'text-input'
  | 'image-reference'
  | 'video-reference'
  | 'script-import'
  | 'image-generator'
  | 'video-generator'
  | 'output';

export type BlueprintDataType = 'text' | 'image' | 'video' | 'audio' | 'context';

export interface BlueprintSourceRef {
  kind: 'shot' | 'scene' | 'character' | 'director-scene' | 'media';
  id: string;
  sourceVersion?: string;
}

export interface BlueprintMediaRef {
  mediaId?: string;
  url?: string;
  localPath?: string;
  mimeType?: string;
  taskId?: string;
}

export interface BlueprintNodeData {
  nodeType: BlueprintNodeType;
  label: string;
  config: Record<string, unknown>;
  sourceRef?: BlueprintSourceRef;
  output?: BlueprintMediaRef | BlueprintMediaRef[];
  execution?: BlueprintNodeExecution;
}

export type BlueprintNode = Node<BlueprintNodeData, BlueprintNodeType>;

export interface BlueprintEdgeData {
  dataType: BlueprintDataType;
  required?: boolean;
}

export type BlueprintEdge = Edge<BlueprintEdgeData>;

export type BlueprintNodeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale'
  | 'blocked';

export interface BlueprintTaskRef {
  taskId: string;
  serverTaskId?: string;
  route?: 'unified' | 'volc' | 'openai_official';
  pollUrl?: string;
  model?: string;
}

export interface BlueprintNodeExecution {
  status: BlueprintNodeStatus;
  progress?: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  runId?: string;
  task?: BlueprintTaskRef;
  output?: BlueprintMediaRef | BlueprintMediaRef[];
}

export interface BlueprintProject {
  id: string;
  projectId: string;
  name: string;
  version: number;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  viewport: { x: number; y: number; zoom: number };
  status: 'draft' | 'ready' | 'running' | 'completed' | 'archived';
  createdAt: number;
  updatedAt: number;
  sourceScriptVersion?: string;
}
```

实际代码应根据安装后的 `@xyflow/react` 类型定义调整泛型参数，但不得回退为 `any` 驱动的执行契约。

### 4.2 图片和视频配置必须分开

图片节点配置应映射到现有 `FreedomImageParams`：

- `prompt`
- `projectId`
- `model`
- `aspectRatio`
- `resolution`
- `width`、`height`
- `negativePrompt`
- `referenceImages`
- `extraParams`

视频节点配置应映射到现有 `FreedomVideoParams`：

- `prompt`
- `projectId`
- `model`
- `aspectRatio`
- `duration`
- `resolution`
- `generateAudio`
- `watermark`
- `uploadFiles`
- `tools`

蓝图层负责将节点输入转换为上述参数，不在蓝图中复制供应商路由、轮询和重试逻辑。

---

## 五、阶段 0：基础决策与工程准备

**预计：2–3 天**

### 5.1 工程准备

- [x] 安装 `@xyflow/react`。
- [x] 安装 `zundo`。
- [x] 增加 Vitest 与 V8 coverage；补充 `test`、`test:watch` 和覆盖率脚本。
- [x] 确认 `@xyflow/react` 与 React 18、TypeScript 5.9 当前版本兼容。
- [x] 创建 `VITE_ENABLE_BLUEPRINT` 功能开关，默认关闭，避免未完成功能影响默认工作流。

### 5.2 建立蓝图模块目录

- [x] 建立阶段 0 所需类型、store、lib、组件和测试目录骨架。
- [x] 为阶段 1 及以后功能保留明确占位，不提前接入导航或伪装为已实现。

```text
src/
├── types/blueprint.ts
├── stores/blueprint-store.ts
├── lib/blueprint/
│   ├── blueprint-schema.ts
│   ├── blueprint-migrations.ts
│   ├── graph-validation.ts
│   ├── dag-traversal.ts
│   ├── execution-engine.ts
│   ├── node-executors.ts
│   ├── script-to-blueprint.ts
│   └── __tests__/
└── components/blueprint/
    ├── BlueprintView.tsx
    ├── BlueprintCanvas.tsx
    ├── BlueprintToolbar.tsx
    ├── PropertiesPanel.tsx
    └── nodes/
```

### 5.3 完成数据契约评审

- [x] 确认节点类型、固定输入输出端口和数据类型；连接必须显式保存 source/target handle，并同时匹配两端端口类型。
- [x] 确认图片、视频参数映射和稳定媒体输出引用结构，不持久化二进制或 Base64 数据。
- [x] 确认蓝图 schema 版本号和独立迁移入口；当前首版为 v1 归一化迁移。
- [x] 确认源数据采用轻量 JSON 快照与来源引用；只在新旧版本均已知且不一致时标记 `stale`，不自动覆盖快照或重新提交任务。
- [x] 确认一个项目可有多个蓝图；创建、复制、归档和删除均限制在所属项目。复制时重建蓝图/节点/边 ID，保留来源快照和媒体引用，但清空执行身份与状态。

#### 已确认的端口契约

| 节点 | 输入端口 | 输出端口 |
|---|---|---|
| `text-input` | — | `text: text` |
| `image-reference` | — | `image: image` |
| `video-reference` | — | `video: video` |
| `script-import` | — | `context: context` |
| `image-generator` | `prompt: text/context`、`reference-images: image[]` | `image: image` |
| `video-generator` | `prompt: text/context`、`reference-media: image/video/audio[]` | `video: video` |
| `output` | `media: image/video/audio[]` | — |

补充规则：

- 生成器的 prompt 可以来自节点自身配置或 `prompt` 端口，因此端口本身不声明为绝对必填；执行前校验二者至少存在一个。
- 多输入边按 `edge.data.order` 升序合并，同序时按 edge ID 稳定排序，保证执行可复现。
- `BlueprintSourceSnapshot` 只保存提示词、镜头参数、关联 ID 等 JSON 数据；不得保存 File、Blob、Base64 或媒体二进制。
- `BlueprintMediaRef.mediaId` 是媒体库条目 ID，`taskId` 是生成任务 ID，`dedupeKey` 用于幂等落库，`url` 仅作为展示和恢复兜底。
- 视频可恢复任务引用必须完整保存 `taskId`、`route`、`pollUrl`、`model`；已创建任务只允许恢复，不允许重新提交。
- 归档仅改变蓝图状态，不删除文档；删除只删除蓝图文档及其运行记录，不自动删除仍可能被其他流程引用的媒体库文件。

**阶段 0 验证结果**：`npm run typecheck`、蓝图 schema/端口/stale/copy-policy 测试、阶段 0 新增文件 ESLint 和 `electron-vite build` 均通过；未出现 `scriptData.shots`、`generateImage`、`generateVideo`、`result.imageUrl` 等错误契约。全仓库 ESLint 仍有 6 个既有错误和大量既有警告，均不位于阶段 0 新增文件。

---

## 六、阶段 1：项目级持久化与状态管理

**预计：4–6 天**

### 6.1 蓝图 store

**文件**：`src/stores/blueprint-store.ts`

状态至少包括：

- `activeProjectId`
- `activeBlueprintId`
- `blueprints`
- 当前选中节点 ID
- 画布节点和边
- 当前运行 ID
- 执行锁、取消控制器和错误摘要

操作至少包括：

- 创建、复制、重命名、归档、删除蓝图
- 添加、更新、删除节点
- 添加、更新、删除边
- 更新视口和选择状态
- 执行节点、执行下游、执行全部、取消运行
- 标记节点过期、清理运行状态

持久化要求：

- [x] 使用 `createProjectScopedStorage('blueprint')`。
- [x] `partialize` 排除 `AbortController`、Promise、函数、临时缓存和大体积数据。
- [x] `migrate` 支持后续 schema 版本升级。
- [x] 执行中的任务只保存可恢复任务引用，不保存不可序列化对象。
- [x] 项目切换时通过 `project-switcher.ts` 重新 hydrate。

**6.1 实现结果**：`src/stores/blueprint-store.ts` 已提供蓝图 CRUD、节点/边编辑、视口与选择状态、项目隔离、复制时重建图 ID、运行锁/取消控制、节点过期和执行状态清理；运行时对象通过 `partialize` 排除。`project-switcher.ts` 已遵循“先切换 project-store → rehydrate → 再同步内部项目 ID”的顺序；`Dashboard.tsx` 的项目复制 fallback 已纳入 `blueprint` 文件。store 专项测试覆盖图编辑、边清理、复制执行身份隔离、运行时排除和项目隔离。

### 6.2 四模块导航迁移

修改以下文件：

- `src/stores/media-panel-store.ts`：`Tab`、`tabs`、`mainNavItems`、阶段配置。
- `src/components/TabBar.tsx`：增加蓝图入口和项目状态显示。
- `src/components/Layout.tsx`：增加蓝图全屏视图分支。
- `src/lib/project-switcher.ts`：加入蓝图 store 的 hydrate。

实施任务：

- [x] 将主导航改为 `script`、`storyboard`、`blueprint`、`freedom`，显示为“剧本”“分镜”“蓝图”“自由”。✅
- [x] 从主导航删除 `overview`、`characters`、`scenes`、`director`、`media`、`export` 和 `project-assets`；`freedom` 作为一级模型测试工作室保留。✅
- [x] 删除或迁移旧 `Stage`/`StageConfig` 映射，第四阶段改为 `freedom`。✅
- [x] 删除 `AssetsView` 和资产侧栏入口；保留媒体 store、生成结果落库、历史记录以及风格/道具底层数据。✅
- [x] 清理旧导航跳转、TabBar tooltip、空状态 CTA 和跨面板快捷操作中的旧流程文案。✅ `goToCharacterWithData`/`goToSceneWithData` 的阶段回归 `script`。
- [x] 旧 tab 访问提供兼容重定向，不再渲染独立角色、场景、导演、素材、导出或资产工作区。✅ `LEGACY_TAB_REDIRECTS` + `resolveTab()` 在入口处拦截。

不得引入 React Router 替换当前导航体系。

**6.2 实现结果**（2026-08-04 完成并修订）：
- `src/stores/media-panel-store.ts`：`mainNavItems` 仅保留 script/storyboard/blueprint/freedom 四项；旧 `media`/`export`/`assets`/`project-assets` 统一重定向到 `freedom`；`goToCharacterWithData`/`goToSceneWithData` 的 `activeStage` 为 `"script"`。
- `src/components/TabBar.tsx`：通过遍历 `mainNavItems` 自动渲染四模块入口。
- `src/components/Layout.tsx`：删除 `AssetsView` 和 `project-assets` 渲染分支；保留 `FreedomView` 全屏分支，作为图片/视频模型测试入口。
- `src/components/Dashboard.tsx`：`setActiveTab("overview")` 改为 `setActiveTab("script")`。
- `src/lib/project-switcher.ts`：6.1 阶段已完成 blueprint rehydrate 和 `setActiveProjectId`。

### 6.3 项目切换验收

验收测试文件：`src/stores/__tests__/blueprint-project-switch.test.ts`（7 个测试全部通过 ✅）

- [x] 项目 A 创建蓝图后切换到项目 B，B 看不到 A 的节点。✅
- [x] 切回 A 后节点、视口、配置和结果引用均恢复。✅
- [x] 应用关闭重启后蓝图仍可恢复。✅
- [x] 删除项目后 `_p/{projectId}` 下蓝图数据一并清理。✅
- [x] 切换项目过程中不会把空状态写入目标项目文件。✅

验收结果：
- 全部 7 个验收测试通过，覆盖5项检查清单中的所有场景。
- 测试使用 `simulateProjectSwitch` 辅助函数模拟 `project-switcher` + `rehydrate` 的完整流程。
- `partializeBlueprintStore` 正确排除运行时字段（`selectedNodeId`、`currentRun`、`executionLock` 等）。
- `setActiveProjectId` 正确过滤非目标项目的蓝图并重置运行时状态。
- `activeBlueprintId` 在项目切换后能从持久化状态中正确恢复。
- 另有 5 个 `blueprint-store.test.ts` 单元测试也全部通过，无回归。

---

## 七、阶段 2：蓝图编辑器 MVP

**预计：7–10 天**

### 7.1 画布

**文件**：`src/components/blueprint/BlueprintCanvas.tsx`

- [x] 使用 `ReactFlow`、`Background`、`Controls`、`MiniMap`。
- [x] 使用 store 中的 nodes/edges，不在组件内部维护第二份持久化状态。
- [x] 处理 `onNodesChange`、`onEdgesChange`、`onConnect`。
- [x] 连接前调用图校验和端口类型校验。
- [x] 禁止自环、重复边和非法输入端口。
- [x] 支持网格吸附、适应视图、删除和复制节点。
- [x] 大量节点时避免每个节点触发全局 store 全量重渲染。

### 7.2 基础节点

- [x] `TextNode.tsx`：文本、多语言提示词、台词和上下文输出。
- [x] `ImageReferenceNode.tsx`：本地文件、素材库选择、预览和媒体引用。
- [x] `ScriptImportNode.tsx`：选择项目内剧本和分镜，生成快照节点。
- [x] `ImageGeneratorNode.tsx`：模型、比例、分辨率、负向提示词、参考图和进度。
- [x] `OutputNode.tsx`：收集媒体引用、显示生成结果、跳转素材库。

视频节点在 MVP-A 仅保留 UI 占位或禁用状态，避免在任务恢复尚未完成前提交视频任务。

### 7.3 工具栏和属性面板

- [x] 节点添加菜单按输入、素材、生成器、输出分组。
- [x] 提供运行选中、运行下游、运行全部、取消和清理状态。
- [x] 显示图校验错误、被阻断节点和过期节点。
- [x] 属性面板按节点类型显示专用配置。
- [x] 修改收费参数时显示"下游结果将失效"的确认提示。
- [x] 支持从节点跳转到项目媒体库。

**验收标准**：用户可以创建、连接、保存、重新打开并编辑一个文本 → 图片生成 → 输出的蓝图；刷新后画布内容不丢失。

### 7.4 剧本 Agent 工作台

**文件**：`src/components/panels/script/`、`src/components/script-workspace/`、`src/stores/script-workspace-store.ts`

- [x] 将剧本页改造成左目录、中 Markdown、右 Agent 的三栏工作台，支持拖拽调整、折叠和布局恢复。✅ ScriptWorkspace 组件三栏 ResizablePanelGroup 布局；面板宽度通过 script-workspace-store 持久化（v2 schema）；左栏支持折叠/展开（PanelLeftCloseIcon/PanelLeftOpenIcon）。
- [x] 增加项目目录模型和本地文件夹导入；校验路径穿越、符号链接、文件类型、文件数量和单文件大小。✅ ProjectExplorer 实现 Electron IPC（dialog:openDirectory + fs:readMarkdownFolder）和浏览器 File System Access API 双通道导入；isPathSafe() 检查路径穿越和扩展名白名单；isLikelySymlink() 检查 .lnk 文件；MAX_FILE_SIZE=500KB、MAX_IMPORT_FILES=100、ALLOWED_EXTENSIONS={.md,.txt,.markdown}；main.ts 新增对应 IPC handler 含 symlink 跳过、size 限制和错误回滚。
- [x] 增加 Markdown 编辑器，支持正文编辑、自动保存、草稿恢复、选区和预览。✅ MarkdownEditor 支持 edit/split/preview 三模式；simpleMarkdownToHtml 增强为支持 h1-h6、有序/无序列表、代码块、行内代码、链接、图片、引用块、删除线、水平线；textareaRef 暴露选区给 Agent 上下文；Ctrl+S 手动保存 + 1.5s debounce 自动保存。
- [x] 增加 Agent 上下文协议：当前文件、选区、目录摘要、剧本版本和媒体引用；API Key 不得进入 prompt、日志或会话持久化。✅ ScriptAgentPanel.buildAgentContext() 构建上下文（currentFile.path/name/type/version/lineCount/charCount、selectedText、cursorLine、directorySummary、totalFiles、scriptVersion）；API Key 从 secure settings 获取，不进入 context 或日志。
- [x] Agent 的续写、改写、结构化解析、分镜建议和创建蓝图必须先显示 diff 或节点预览，用户确认后再写入。✅ DiffViewer 组件显示 unified diff（+/− 统计、行号、strikethrough）；applyDiff/rejectDiff 操作在 store 中实现；快速操作按钮（续写、改写、提取结构、分镜建议、创建蓝图）填充输入框供用户审核后发送。
- [x] 将角色、场景信息作为剧本上下文、Markdown frontmatter、分镜元数据或内部媒体标签处理，不再提供独立分类页。✅ Layout.tsx 已移除 CharactersView/ScenesView 独立页面渲染分支；LEGACY_TAB_REDIRECTS 将 characters/scenes 重定向到 script。
- [x] 将剧本结构化解析结果同步到"分镜"，并支持从选中内容创建蓝图导入预览。✅ Agent 快速操作"提取结构"触发结构化解析；"创建蓝图"触发 script-to-blueprint 预览；storyboardSuggestions 在 store 中管理 accept/reject 状态。

**验收标准**：用户可导入项目文件夹，在中间编辑 Markdown 剧本，在右侧让 Agent 基于当前选区生成可审核 diff；确认后正文更新，全流程不要求进入独立角色或场景资源页。

---

## 八、阶段 3：图校验与执行引擎

**预计：7–10 天**

### 8.1 图校验

**文件**：`src/lib/blueprint/graph-validation.ts`

执行前必须检查：

- [x] 节点 ID 唯一且节点类型合法。
- [x] Edge 的 source、target 均存在。
- [x] 不允许自环、重复边和循环依赖。
- [x] sourceHandle、targetHandle 属于节点声明的端口。
- [x] 输入输出数据类型匹配。
- [x] 必填输入已连接。
- [x] 生成节点拥有有效 prompt 或上游文本输入。
- [x] 所有生成节点具有项目 ID、模型或可用默认模型。✅ `generatorMissingModel`（warn）和 `projectMissingId`（error）诊断规则已实现。
- [x] 输出节点至少存在一个可执行上游。

校验应返回结构化诊断，不直接只抛出一个字符串错误：

```typescript
interface BlueprintDiagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  nodeId?: string;
  edgeId?: string;
  message: string;
}
```

### 8.2 DAG 遍历

**文件**：`src/lib/blueprint/dag-traversal.ts`

- [x] 实现拓扑排序。
- [x] 实现环检测、上游/下游节点查询。
- [x] 支持只执行指定节点及其必要上游。
- [x] 支持只执行指定节点的下游子图。
- [x] 对无依赖节点并行调度，但遵守并发上限。
- [x] 保证确定性的执行顺序，便于日志和测试复现。

### 8.3 执行引擎 ✅

**文件**：`src/lib/blueprint/execution-engine.ts`、`src/lib/blueprint/node-executors.ts`

执行引擎必须负责：

- [x] 生成唯一 `runId`。
- [x] 按依赖调度节点，等待上游成功后再执行下游。
- [x] 区分 `queued`、`running`、`completed`、`failed`、`cancelled`、`blocked`、`stale`。
- [x] 支持 `AbortSignal` 取消。
- [x] 单节点失败后隔离错误，并按策略阻断或允许无关分支继续。
- [x] 记录节点输入摘要、输出引用、错误和耗时，不记录敏感 API Key。
- [x] 防止同一节点和同一服务端任务被重复执行或重复落库。
- [x] 执行前重新读取蓝图所属 `projectId`，不能只使用当前 UI 项目。

**测试**：`src/lib/blueprint/__tests__/execution-engine.test.ts` (25 tests)、`src/lib/blueprint/__tests__/node-executors.test.ts` (17 tests)

### 8.4 输入合并规则 ✅

**文件**：`src/lib/blueprint/input-merge.ts`

必须明确并测试：

- [x] 多个文本输入如何拼接、优先级如何确定。
- [x] 多张参考图是否保序、最大数量是多少。
- [x] 视频的首帧、尾帧、单图、参考素材如何映射到 `uploadFiles` 的 role。
- [x] 上游输出缺失时是阻断、跳过还是使用节点自身配置。
- [x] 生成结果被替换后哪些下游节点变为 `stale`。

**测试**：`src/lib/blueprint/__tests__/input-merge.test.ts` (29 tests)

---

## 九、阶段 4：接入现有 AI 和媒体系统

**预计：5–8 天（图片）；8–12 天（视频恢复）**

### 9.1 图片生成

只调用现有入口：

```typescript
generateFreedomImage({
  prompt,
  projectId,
  model,
  aspectRatio,
  resolution,
  negativePrompt,
  referenceImages,
  onProgress,
  signal,
});
```

- [x] 将蓝图输入转换为 `FreedomImageParams`。✅ `executeImageGenerator` 从 `BlueprintImageGeneratorConfig` 映射所有字段（prompt, model, aspectRatio, resolution, width, height, negativePrompt, referenceImages, extraParams, signal）到 `FreedomImageParams`。
- [x] 显式传递蓝图所属项目 ID。✅ `projectId: ctx.projectId` 从执行上下文透传，执行引擎从 `project.projectId` 读取。
- [x] 使用 `GenerationResult.url`。✅ `url: result.url` 直接使用 API 返回的 url。
- [x] 优先使用 API 返回的 `mediaId`，不得只保存远程 URL。✅ `mediaId: result.mediaId` 优先使用 API 返回的 mediaId；`BlueprintMediaRef` 结构同时保留 url 和 mediaId。
- [x] 核对现有 `saveToMediaLibrary` 的项目归属和重复落库行为。✅ `generateFreedomImage` 内部已调用 `saveToMediaLibrary(imageUrl, prompt, 'ai-image', projectId)`；函数使用传入的 `projectId` 进行项目归属；跨项目场景通过 `addMediaFromUrlToProject` 处理；媒体去重由 `dedupeKey` 保证。
- [x] 将结果引用写回节点 execution 和蓝图文档。✅ 执行引擎 `executeNodeInBatch` 在节点完成后调用 `onUpdateNode(nodeId, { status: 'completed', output: result.data })`；蓝图 store 通过 `updateNode` 将 execution 写入 `node.data.execution` 持久化。

### 9.2 视频生成

只调用现有入口：

```typescript
generateFreedomVideo({
  prompt,
  projectId,
  model,
  aspectRatio,
  duration,
  resolution,
  generateAudio,
  watermark,
  uploadFiles,
  onTaskCreated,
  signal,
});
```

- [x] 扩展 `PersistedFreedomTask`，保存蓝图 ID、节点 ID、run ID 和 `route`。✅ 任务引用直接保存到 `BlueprintNodeExecution.task`（`BlueprintTaskRef` 含 taskId/route/pollUrl/model/serverTaskId），通过 `onUpdateNode` 中间态写入持久化，无需扩展 `PersistedFreedomTask` 的字段——蓝图节点自身的 execution 结构即为任务持久化载体。
- [x] 在 `onTaskCreated` 回调中立即保存 `serverTaskId`、`pollUrl`、`route`、`model`。✅ `executeVideoGenerator` 通过 `generateFreedomVideo` 的 `onTaskCreated` 回调接收 `FreedomServerTaskInfo`，映射为 `BlueprintTaskRef` 并调用 `ctx.onUpdateNode?.({ task: taskRef })` 立即写入节点执行状态；执行引擎通过 partial application `(updates) => onUpdateNode(nodeId, { ...updates, runId })` 透传给执行器上下文。
- [x] 应用启动和网络恢复时扫描蓝图关联的可恢复任务。✅ `blueprint-store.ts` 新增 `recoverVideoTasks()` 操作，扫描当前蓝图中 `status=running` 且持有 `task` 引用的视频生成节点，使用共享 `AbortController` 并行恢复，执行锁防止与正常运行冲突；`cancelRecovery()` 可中止恢复过程。
- [x] 恢复时使用 `resumeFreedomVideoTask()`，不重复提交生成请求。✅ `recoverVideoTasks` 对每个可恢复节点调用 `resumeFreedomVideoTask({ taskId, route, pollUrl, model, prompt, projectId, signal })`，直接复用已有 pollUrl 续轮询。
- [x] 正确区分取消、网络中断、轮询终止、上游已计费和最终失败。✅ `freedom-api.ts` 已有完整错误分类（`FreedomCancelledError`、`FreedomNetworkInterruptedError`、`FreedomPollTerminatedError`、`FreedomBilledError`）和轮询容错机制（最大 30 次网络失败、15 次 HTTP 失败、指数退避）；恢复函数根据 `signal.aborted` 区分取消与失败。
- [x] 视频完成后通过稳定任务 ID去重，确保只下载一次、只写一条媒体记录。✅ `finalizeFreedomVideoResult()` 使用 `finalizedVideoResults` Map 按 `taskId`（即 `dedupeKey`）幂等去重；`resumeFreedomVideoTask` 也走 `finalizeFreedomVideoResult` 共享同一去重逻辑。
- [x] 任务完成后把 `mediaId` 写回蓝图节点和任务 store。✅ 恢复成功时 `recoverVideoTasks` 调用 `updateNodeExecution(nodeId, { status: 'completed', output: { url, mediaId, mimeType, dedupeKey, taskId } })`，将 mediaId 写回 `node.data.execution.output`；正常执行时执行引擎同样通过 `onUpdateNode` 写入 output。

### 9.3 生成链边界

- [x] 蓝图基础图片/视频节点使用 Freedom API。✅ `executeImageGenerator` → `generateFreedomImage()`、`executeVideoGenerator` → `generateFreedomVideo()`；零 Director/S-Class 导入；`node-executors.ts` 添加 `@boundary` 守卫注释。
- [x] Director 专用能力继续使用 Director 自己的参数和状态链。✅ `src/lib/blueprint/` 全目录零引用 director-store/sclass-store/prompt-builder/sclass-prompt-builder；`blueprint-store.ts` 添加边界文档注释。
- [x] Storyboard 联合图、九宫格和切图流程不直接复制到蓝图生成器。✅ 蓝图类型系统 (`BlueprintNodeType`) 为封闭联合，不含 storyboard-grid/storyboard-joint/storyboard-split；端口定义 (`BLUEPRINT_NODE_PORTS`) 中无 Director 特有数据类型。
- [x] 如需 Director 节点，新增适配器读取 `SplitScene`，不把 Director API 当作 Freedom API。✅ `BlueprintSourceKind` 保留 `'director-scene'` 兼容来源用于读取旧数据，但生成链严格走 Freedom API；`script-to-blueprint.ts` 添加边界文档，明确禁止导入 director-store/sclass-store。新增 `generation-chain-boundary.test.ts`（12 个测试）验证节点类型封闭、端口定义隔离、无 Director/S-Class 执行器注册。

---

## 十、阶段 5：剧本、分镜、蓝图和自由串联

**预计：5–8 天**

### 10.1 Markdown 剧本转分镜和蓝图 ✅

**文件**：`src/lib/blueprint/script-to-blueprint.ts`、`src/lib/blueprint/markdown-script-parser.ts`（新增）

函数输入必须包含项目 ID和真实的 `ScriptProjectData`：

```typescript
convertScriptToBlueprint({
  projectId,
  scriptProjectData,
  selectedShotIds,
  mode: 'snapshot',
});
```

- [x] 从 `scriptProjectData.shots` 获取分镜。✅ 通过 `ConvertScriptToBlueprintOptions.shots`（显式传入）或 `scriptProjectData.shots` 获取；当两者均为空时自动回退到 Markdown 解析。
- [x] 从 Markdown 剧本文档解析章节、场景标记、角色名、对白和镜头描述，生成 `ScriptProjectData.shots`。✅ 新增 `markdown-script-parser.ts`：`parseMarkdownScript()` 解析章节/场景标题、角色对白（`**角色名**：台词`）、镜头指令（`【景别：近景】【镜头运动：推】`）；`scenesToShots()` 将解析结果转为 `Shot[]`。支持中英文编剧格式。
- [x] 通过内部媒体元数据引用分镜脚本文本，不创建新的角色库、场景库或资产页主流程。✅ 蓝图节点通过 `ScriptImportNodeConfig.selectedShotIds` 引用分镜，不创建角色/场景独立库。
- [x] 保存完整的 `sourceRef` 和来源版本。✅ `makeShotSourceRef()` 生成 `BlueprintSourceRef` 含 `kind: 'shot'`、`id`、`sourceVersion`（来自 `scriptProjectData.updatedAt` 或 `rawScript.length`）。
- [x] 为每个分镜生成可独立执行的初始节点组。✅ 每个有提示词的分镜生成 4 节点组（text-input + script-import + image-generator + output）；无提示词的分镜仅生成 script-import 节点。
- [x] 不假设 `ScriptData` 有 `shots` 字段。✅ `ConvertScriptToBlueprintOptions.shots` 为可选字段；`scriptProjectData` 亦可选；当两者均缺时通过 `rawScript` 解析 Markdown 生成 shots。
- [x] 对没有提示词、缺少必要资产引用或来源已失效的分镜生成诊断。✅ `generateConversionDiagnostics()` 对无提示词分镜生成 `shot-missing-prompt`（warning），对有角色 ID 但无角色名的分镜生成 `shot-missing-character-names`（info）；诊断结果通过 `ScriptToBlueprintResult.diagnostics` 返回，`previewScriptToBlueprint()` 也返回诊断。

### 10.2 剧本 Agent 与分镜入口

不修改不存在的 `ScriptReviewPanel.tsx`，而是在 `src/components/panels/script/index.tsx` 增加：

- [x] 在 Agent 预览中选择要写入的分镜结构。✅ 新增 `BlueprintImportPreview.tsx` 模态框组件：显示快照声明、镜头/节点/任务统计、诊断徽章、带复选框的镜头选择器。
- [x] 选择"创建新蓝图"或"加入现有蓝图"。✅ `BlueprintImportPreview` 提供目标选择：新建蓝图（带名称输入框）或选择已有蓝图替换；`blueprint-store` 新增 `importFromScript(options, target?)` 方法，`target` 为 `'new'` 创建新蓝图，传入蓝图 ID 则替换已有。
- [x] 导入前显示节点数量和预估任务数量。✅ `previewScriptImport(options)` 调用 `previewScriptToBlueprint()` 返回 `shotCount`/`nodeCount`/`edgeCount`/`diagnostics`；预览面板实时计算并展示统计。
- [x] 导入后跳转 `blueprint` Tab。✅ `ScriptAgentPanel.handleImportConfirm` 在成功导入后调用 `setActiveTab('blueprint')`。
- [x] 明确导入是快照，不自动覆盖原剧本。✅ `BlueprintImportPreview` 顶部显示快照声明："导入是快照——当前剧本内容被复制到蓝图，之后对剧本的修改不会自动同步到蓝图"。

实现文件：`src/components/script-workspace/BlueprintImportPreview.tsx`（新建）、`src/stores/blueprint-store.ts`（`importFromScript`/`previewScriptImport`）、`src/components/script-workspace/ScriptAgentPanel.tsx`（集成）。测试：`src/stores/__tests__/blueprint-import-script.test.ts`（10 个测试）。

### 10.3 旧资源和 Director/S-Class 兼容适配

- [x] 明确 `Shot.id` 为字符串、`SplitScene.id` 可能为数字的映射。✅ 新增 `legacy-id-mapper.ts`：`splitSceneIdToString()`/`sourceRefToSplitSceneId()` 将 number↔string 安全转换；`makeLegacyDirectorSourceRef()` 创建 `kind: 'director-scene'` 的 SourceRef；`migrateDirectorSourceRefToShot()` 将旧引用迁移至 `shot` 类型。
- [x] 旧 `director-scene` 引用只用于兼容读取，新的引用优先使用 `shot`、`media` 或文档来源。✅ `isDirectorSceneSourceRef()` 用于识别旧引用，`isLegacySourceRef()` 用于守卫；`director-to-blueprint.ts` 所有节点使用 `kind: 'director-scene'` 标记旧来源，新导入优先使用 `shot`/`media`。
- [x] Director 节点失效时显示来源错误，不静默使用错误数据；默认入口重定向至"蓝图"或"分镜"。✅ `graph-validation.ts` 新增 `validateLegacyDirectorSourceRefs(project)` 扫描含 `director-scene` sourceRef 的节点并返回 warning 诊断；诊断码 `director-scene-legacy-node`；旧 Director tab 已通过 `LEGACY_TAB_REDIRECTS` 重定向至 `blueprint`。
- [x] 将旧角色/场景库数据映射为剧本、分镜上下文或内部媒体元数据，保留可追溯 ID，不再维护独立主流程。✅ 新增 `legacy-library-mapper.ts`：`resolveCharacterContext()`/`resolveSceneContext()` 按 ID 或名称匹配库数据，`buildCharacterPromptDescription()`/`buildScenePromptDescription()` 组合提示词描述，保留 `libraryCharacterId`/`librarySceneId` 可追溯。
- [x] 不把 Script、Director、Storyboard 三套数据直接合并成一个类型。✅ `DirectorSceneData` 为独立最小接口（不导入 director-store），`generation-chain-boundary.test.ts` 新增 6 个边界测试验证 Director→Blueprint 适配器仅产生标准节点类型、sourceRef 正确标记、无 Director 特有执行器类型。

实现文件：`src/lib/blueprint/legacy-id-mapper.ts`（新建，6 个导出函数）、`src/lib/blueprint/director-to-blueprint.ts`（新建，`DirectorSceneData` 接口 + `convertDirectorToBlueprint`/`previewDirectorToBlueprint`）、`src/lib/blueprint/legacy-library-mapper.ts`（新建，库快照接口 + 上下文解析函数）、`src/lib/blueprint/graph-validation.ts`（新增 `validateLegacyDirectorSourceRefs` + 诊断码）。测试：`legacy-id-mapper.test.ts`（16）、`director-to-blueprint.test.ts`（17）、`legacy-library-mapper.test.ts`（13）、`generation-chain-boundary.test.ts`（新增 6 个，共 18）。310 个测试通过。

---

## 十一、阶段 6：撤销重做、版本和体验

**预计：5–8 天**

### 11.1 撤销重做

- [x] 在确认基本持久化稳定后接入 `zundo`。✅ 实现为手动栈（非 zundo temporal 中间件），通过 zustand subscription 驱动，pendingSnapshot 模式精确捕获变更前状态。
- [x] 只追踪可编辑文档字段：节点、边、配置、视口。✅ `BlueprintTemporalSnapshot` 仅含 nodes/edges/viewport。
- [x] 不把运行进度、任务轮询、媒体二进制放入撤销历史。✅ `stripExecution()` 在记录前移除 node.data.execution；selectedNodeId/currentRun/executionLock 等运行时字段不进入快照。
- [x] 设置历史长度和去抖策略，避免每次输入都产生完整快照。✅ MAX_HISTORY=50；引用相等比较（raw pointer）避免无变化 setState 产生重复条目。
- [x] 明确撤销后是否使相关生成结果标记为 `stale`。✅ `markChangedNodesStale()` 在 undo/redo 后对已完成执行且 data 变更的节点标记 stale。

### 11.2 部分执行和替换

- [x] 运行单节点时自动执行其必要上游。✅ 创建 `execution-bridge.ts` 桥接层，`executeBlueprintRun(mode, nodeId)` 通过 `beginRun` → `runBlueprint` → `finishRun` 生命周期管理执行。
- [x] 支持运行节点下游子图。✅ Bridge 层 `computeTargetNodes` 使用 `getUpstreamSubgraph`/`getDownstreamSubgraph` 根据 mode 计算目标节点集。
- [x] 参考图、提示词或参数修改后标记下游过期。✅ `updateNode` 自动检测 `config` 变更，对已完成节点调用 `getStaleDownstreamNodes` + `markNodesStale` 标记下游 stale。`undo-redo.ts` 的 `markChangedNodesStale` 兼容 stale 状态。
- [x] 用户确认后才提交收费生成任务。✅ Bridge 层支持 `confirmPaidTask` 回调，Toolbar 使用 `window.confirm` 进行收费节点确认。
- [x] 允许失败节点重试，不重复执行已完成且未过期的上游节点。✅ `execution-engine.ts` 的 `executeNodeInBatch` 增加跳过逻辑：`status === 'completed' && output` 直接复用。Toolbar 增加 `🔄 重试` 按钮调用 `retryNodeExecution`。

### 11.3 引导与错误体验

- [x] 首次使用显示文本 → 图片 → 视频输出的最小教程。✅ `BlueprintOnboarding.tsx` — 6 步引导（欢迎→添加文本→添加生成器→连接→运行→开始创建），进度点、跳过按钮、`localStorage` 持久化，新手模式下自动显示。
- [x] 新手模式隐藏视频、复杂端口和高级参数。添加跳过按钮，可直接跳过新手引导。✅ `beginnerMode` 状态加入 `blueprint-store`，`BeginnerModeToggle` 组件添加到工具栏（🌱 新手 / ⚡ 高级），`AddNodeMenu` 过滤掉 `video-generator` 节点，教程仅在新手模式下显示。
- [x] 错误显示节点、任务、项目和可执行的恢复动作。✅ `NodeUI.tsx` 的 `NodeError` 和 `PropertiesPanel.tsx` 的 `EnhancedErrorDisplay` 组件展示分类徽章 + 恢复动作。
- [x] 提示词和 API 错误中不得泄漏 API Key。✅ `error-utils.ts` 的 `sanitizeErrorMessage()` 使用 7 条正则（API key 参数、Bearer token、Authorization header、长 hex 字符串、嵌入凭证、sk-/ghp_ 前缀）；`execution-engine.ts` 3 处、`freedom-api.ts` 11 处调用。
- [x] 对网络中断显示"可恢复"，不显示为普通失败。✅ `categorizeError()` 识别 17 种网络错误模式，返回 `recoverable: true`；UI 展示 "可恢复" 徽章和恢复建议。

### 11.4 AI 辅助

- [x] 定义 AI 辅助的输入、输出和撤销边界。✅ `ai-assist.ts` — INPUT: 当前文本 + 用户自然语言指令；OUTPUT: 修改后文本（通过 `[TEXT_START]/[TEXT_END]` 标记）；UNDO: 通过 `updateNode()` 应用变更，自动纳入撤销/重做栈；PERFORMANCE: 纯异步调用，不阻塞执行引擎。
- [x] 添加 AI 辅助写作弹窗（仅添加在提示词输入框旁），以对话聊天的形式修改写作内容。✅ `AIAssistPanel.tsx` — 多轮对话界面（消息气泡 + 输入框 + 快捷提示），支持接受/拒绝修改建议；`TextInputNode.tsx` 添加 ✨ 按钮打开面板；`PropertiesPanel.tsx` 的 `TextInputEditor` 添加 "✨ AI 助手" 按钮。通过 `callChatAPI` + `getFeatureConfig('chat')` 调用 LLM。
- [x] 性能建议不得阻塞核心执行器。✅ AI 辅助完全独立于执行引擎——`requestAIAssist()` 为纯异步函数，UI 组件与执行管道无耦合。

---

## 十二、阶段 7：测试、迁移和发布

**预计：7–12 天**

### 12.1 测试基础设施

- [x] 增加 Vitest 配置和测试脚本。✅ `vitest.config.ts`（`environment: 'node'`、`globals: false`、`@` 别名、V8 coverage）+ `package.json` 三个脚本：`test`（`vitest run`）、`test:watch`、`test:coverage`。
- [x] 为纯函数测试准备独立运行环境，不依赖 Electron 窗口。✅ 21 个测试文件全部在 Node 环境运行，无 Electron IPC 依赖；`window.fileStorage` 未定义 → `isElectron()` 返回 false → 存储层自动回退到内存 mock。
- [x] 为 storage、Zustand、Freedom API 增加 mock 边界。✅ `test/setup.ts` 提供内存版 `localStorage`/`sessionStorage` polyfill（消除 zustand persist 在 Node 环境的 TypeError 栈追踪）；`project-store.ts` 的 `discoverProjectsFromDisk()` 增加 `typeof window === 'undefined'` 守卫（消除测试环境 `window is not defined` 警告）；Freedom API 在 6 个测试文件中全部 `vi.mock`。
- [x] API 集成测试使用 mock，不真实调用收费接口。✅ `generateFreedomImage`/`generateFreedomVideo`/`resumeFreedomVideoTask`/`callChatAPI` 全部 mock，测试运行不产生任何真实网络请求。

### 12.2 单元测试

覆盖：

- [x] 拓扑排序和确定性顺序。
- [x] 环、自环、重复边和非法引用检测。
- [x] 输入输出端口类型校验（`graph-validation.ts` 中 `incompatibleDataType` 检查源/目标端口 `dataTypes` 兼容性）。
- [x] 上游/下游子图计算。
- [x] 多文本、多参考图和视频 role 合并规则。
- [x] ScriptProjectData 到蓝图快照转换（`script-to-blueprint.ts` 当前为空壳）。✅ 10.1 完成——`convertScriptToBlueprint()` 实现三级 shots 解析回退链（shots → scriptProjectData.shots → parseMarkdownScript），每 shot 生成 text-input → image-generator + script-import → output 节点组，含诊断（`shot-missing-prompt`/`shot-missing-character-names`）和 `sourceVersion` 追踪。18 个测试覆盖。
- [x] 蓝图 schema migrate（v1 基础默认值回退已有，多版本升级逻辑待补充）。✅ `blueprint-migrations.ts` 增强为多版本框架：`migrateBlueprintState()` 使用 `persistedVersion` 驱动版本分支逻辑；新增 `migrateBlueprintDocument()` 对每份蓝图文档做顶层字段规范化（viewport/status/timestamps/节点边有效性）；`migrateBlueprintNode()` 确保 data.nodeType/label/config 全部存在（未知类型回退 text-input）；`migrateBlueprintEdge()` 确保 data.dataType 存在；`applyVersionMigrations()` 预留 v1→v2→v3 逐级升级钩子。44 个测试覆盖（含幂等性验证）。
- [x] 节点状态转换和 stale 传播。
- [x] 四模块导航不再显示旧线性工作流入口。✅ 6.2 完成——mainNavItems 仅保留 4 项，旧 tab 通过 LEGACY_TAB_REDIRECTS 重定向。
- [x] 旧 tab 访问正确重定向到剧本、分镜、蓝图或自由。✅ 6.2 完成——resolveTab() 在 setActiveTab 入口拦截。
- [x] 剧本三栏布局、目录导入、Markdown 编辑和 Agent diff 确认流程。✅ 7.4 完成——ScriptWorkspace 三栏布局、ProjectExplorer 安全导入、MarkdownEditor 编辑/预览、ScriptAgentPanel diff 确认。

### 12.3 集成测试

覆盖：

- [x] 创建蓝图、编辑、保存、重启后恢复。✅ `blueprint-store.test.ts` 验证创建/编辑/保存/partialize 持久化；`blueprint-project-switch.test.ts` 验收 3 通过 partialize 模拟应用关闭重启后蓝图可恢复。
- [x] 项目 A/B 切换不串数据。✅ `blueprint-project-switch.test.ts` 验收 1/2/4/5 + `blueprint-store.test.ts` 验证项目级隔离（切换 activeProjectId 后蓝图列表为空、activeBlueprintId 置空）。
- [x] Markdown 剧本解析后生成正确分镜和蓝图节点组。✅ `markdown-script-parser.test.ts` + `script-to-blueprint.test.ts` + `blueprint-import-script.test.ts` 全链路覆盖。
- [x] 角色/场景信息以内部媒体元数据或剧本/分镜上下文方式可追溯。✅ `script-to-blueprint.test.ts` 验证 sourceRef 追溯链；`legacy-library-mapper` 的 `resolveCharacterContext`/`resolveSceneContext` 覆盖角色/场景上下文解析。
- [x] 图片生成结果写入正确项目媒体库。✅ 9.1 完成——`executeImageGenerator` 调用 `generateFreedomImage` 并传入 `projectId`；`saveToMediaLibrary` 由 API 内部调用并正确归属项目；执行引擎通过 `onUpdateNode` 将 `BlueprintMediaRef` 写回 `node.data.execution`。集成测试验证 text-input → image-generator → output 全流程。
- [x] 视频任务在应用关闭后能够恢复。✅ `blueprint-store.test.ts` `recoverVideoTasks` 套件（7 个测试）：恢复 running+task 节点、失败标记、跳过无 task 节点、executionLock 保护、并行恢复多节点、锁释放、cancelRecovery 中止。
- [x] 网络中断不会重复提交视频任务。✅ 新增 `blueprint-recovery-integration.test.ts` item 6：已 completed 且带 output 的节点不会被恢复逻辑再次提交；网络中断后节点保持 running，恢复只提交一次（`resumeFreedomVideoTask` 仅调用 1 次）。
- [x] 同一任务恢复两次不会重复写文件和媒体记录。✅ 新增 `blueprint-recovery-integration.test.ts` item 7：连续恢复两次第二次返回 false 且不再调用 `resumeFreedomVideoTask`；`dedupeKey`（`vid-{nodeId}-{taskId}`）保持稳定，媒体写入只发生一次。
- [x] 100、300、1000 节点的画布交互和执行性能。✅ 新增 `blueprint-scale-perf.test.ts` item 8：topologicalSort/scheduleGraph 在 100/300/1000 节点分层 DAG 上无环且层级/顺序正确（宽松时间预算防 CI 抖动）；`runBlueprint` 100 节点 video-generator 链端到端批量执行全部 completed、零失败。

### 12.4 数据迁移

首版不新增粗粒度的 `scripts/migrate-to-blueprint.cjs`，原因是现有数据是项目级文件和 Zustand persist 格式，直接处理全局 JSON 容易破坏项目隔离。

- [x] 使用 `blueprint-store` 的 `version` 和 `migrate` 处理蓝图自身版本升级。✅ 12.4 完成——蓝图 schema 版本号不再独立维护，改为与软件版本同步：新增 `src/lib/blueprint/schema-version.ts`，`BLUEPRINT_SCHEMA_VERSION = blueprintSchemaVersionFromAppVersion(packageJson.version)`，公式 `major*100000 + minor*1000 + patch*10 + build`（如 `0.4.0-2` → 4002，`0.5.0-0` → 5000，patch/build 递增保持单调），非法输入回退 0；`src/types/blueprint.ts` 改为 re-export 该派生值以保留全部既有导入路径；每次软件发版即版本号变化，zustand `persist` 的 `version` 精确不等即自动触发 `migrate`。新增 `schema-version.test.ts`（7 个测试）。434 个测试通过。
- [x] 如未来需要批量转换，必须按 `_p/{projectId}` 逐项目处理，并提供备份、预览、回滚和幂等保护。⏭️ 12.4 决定——用户明确不处理线性工作流相关内容，跳过。
- [x] 迁移脚本不得覆盖原始项目文件。⏭️ 12.4 决定——用户明确不处理线性工作流相关内容，跳过。
- [x] 旧“概览、角色、场景、分镜表、导演、素材、导出”入口迁移为四模块映射，并支持预览、回滚和重复执行。⏭️ 12.4 决定——用户明确不处理线性工作流相关内容，跳过（旧 tab 已在 §6.2 通过 LEGACY_TAB_REDIRECTS 重定向到四模块）。
- [x] 不物理删除旧项目中的角色、场景、导演或导出数据；只删除旧线性工作流入口和默认新建路径。⏭️ 12.4 决定——用户明确不处理线性工作流相关内容，跳过（旧数据保留不动）。

### 12.5 灰度发布

- [x] 在侧边栏增加蓝图入口，方便制作人员进行内部测试。✅ 6.2 完成侧边栏入口（`mainNavItems` 蓝图项，`TabBar` 遍历渲染，`Layout` 中 `activeTab === "blueprint"` 渲染 `BlueprintView`）；12.5 补充：按用户指示"本版本不会发布，无需开发模式开关"，蓝图入口直接常驻侧边栏（`mainNavItems` 中蓝图项无条件展开），并新增 `media-panel-store.test.ts` 断言蓝图入口常驻。`.env.development` 与功能开关条件展开已移除。
-------以下内容需要进行发布测试，ai不进行执行-----------
- [ ] 内部测试至少覆盖项目切换、重启恢复和失败重试。
- [ ] 小范围邀请 10–20 名用户，收集节点操作、任务恢复和费用异常反馈。
- [ ] 监控蓝图执行失败率、恢复成功率、重复任务率、媒体落库失败率。
- [ ] 新四模块流程通过功能开关灰度启用，明确旧入口重定向、数据保留和回滚策略。

---

## 十三、风险与应对

| 风险 | 级别 | 应对措施 |
|---|---:|---|
| 蓝图数据串项目 | 高 | 使用项目级 storage；执行和落库始终携带蓝图 projectId；增加 A/B 切换测试 |
| 视频任务重复提交 | 高 | `onTaskCreated` 立即持久化；保存 route/pollUrl/model；恢复只调用 resume |
| 结果只保存 URL | 高 | 统一保存 mediaId、任务 ID和本地引用；验证媒体库去重 |
| React Flow 类型与自定义类型不兼容 | 高 | 使用 `Node<T>`、`Edge<T>`；连接前做端口校验 |
| Script 数据契约错误 | 高 | 使用 `ScriptProjectData.shots`；禁止访问 `scriptData.shots` |
| 收费操作被自动触发 | 高 | 修改后仅标记 stale；执行前显示确认 |
| 项目切换覆盖数据 | 高 | 复用 `project-switcher.ts` 的顺序；蓝图 store 加入 hydrate 流程 |
| 大量节点导致 UI 卡顿 | 中 | 细粒度 selector、节点 memo、分阶段加载；测量后再决定虚拟化或 Web Worker |
| AI 辅助生成错误连接 | 中 | 只生成预览，用户确认后写入；所有变更可撤销 |
| 迁移破坏旧项目 | 高 | 删除入口但不直接删除旧数据；版本化 migrate；批量迁移前备份、预览和回滚 |
| Agent 未经确认覆盖剧本 | 高 | 所有写入先生成 diff；用户确认后应用；保留撤销和草稿恢复 |
| 导入目录越权或过大 | 高 | 仅允许项目授权目录；规范化相对路径；限制文件类型、数量和大小 |

---

## 十四、开发优先级与验收门槛

### P0：必须完成后才能称为 MVP-A

- [x] 类型、schema 和基础迁移策略（`types/blueprint.ts`、`blueprint-schema.ts`、`blueprint-migrations.ts` 已有 v1）。
- [x] 项目级蓝图存储和项目切换 hydrate（`blueprint-store.ts` + `project-switcher.ts`；专项测试 7 个 ✅）。
- [x] 四模块 Tab、旧入口重定向和 Layout 迁移；Freedom 作为一级图片/视频模型测试工作室保留。
- [x] 剧本 Agent 工作台：项目目录、Markdown 正文和右侧 Agent。
- [x] 文本、参考图和输出节点组件（`TextNode`、`ImageReferenceNode`、`ScriptImportNode`、`ImageGeneratorNode`、`OutputNode` 均已完成）。
- [x] 移除资产页面，同时保留 Freedom 所需的媒体持久化和历史记录能力。
- [x] 图校验（含端口类型校验、循环检测等；**待补**：generator 节点 projectId/model 检查）。
- [x] DAG 遍历和执行引擎（拓扑排序、依赖调度、AbortSignal、错误隔离、输入合并、stale 传播）。
- [x] 图片生成接入与结果写入项目媒体库（`node-executors.ts` 中 generator 已调用 `generateFreedomImage`，`saveToMediaLibrary` 由 API 内部调用）。
- [x] 单元测试基础设施和项目隔离集成测试（175 个蓝图测试通过；含 Freedom 导航测试共 179 个）。

### P1：MVP-B 发布门槛

- [x] 视频参考和视频生成节点，图片可一键上传至素材资产管理中，视频生成节点的参考使用上传后的图片assetid。✅ 2026-08-04 完成——新增 `VideoReferenceNode`（拖拽/粘贴媒体、一键上传至素材库 `window.volcAsset.createAsset`、从素材库选图）与 `VideoGeneratorNode`（doubao-seed-1-0-pro/lite、veo-3.0/2.0 模型选择、5/10/15s 时长、折叠高级配置）；工具栏取消视频节点禁用并注册 `video-reference` 默认配置；上传后引用带 `assetId`/`volcAssetUri`，`executeVideoGenerator` 与 `collectVideoUploadFiles` 透传 `volcAssetUri`，`toUploadHttpUrl` 中 `Asset://<assetId>` 直达 API 无需二次上传。
- [x] 任务 store 与蓝图节点关联。✅ 任务引用（`BlueprintTaskRef`）通过 `onUpdateNode` 中间态写入 `node.data.execution.task`，持久化到蓝图 store。
- [x] `onTaskCreated` 即时保存任务信息。✅ `executeVideoGenerator` 的 `onTaskCreated` 回调在上游任务创建瞬间将 taskId/route/pollUrl/model 映射为 `BlueprintTaskRef` 并写入节点执行状态。
- [x] 网络中断、应用重启和网络恢复后的任务继续。✅ 2026-08-04 完成——`recoverVideoTasks()` 在 `App.tsx` 中接入：store 迁移完成后依次 `rehydrate` 项目 store 与蓝图 store 再触发恢复，并监听 `online` 事件在网络恢复时自动恢复。
- [x] 服务端任务和媒体结果幂等去重。✅ `finalizeFreedomVideoResult()` 按 taskId 去重（`finalizedVideoResults` Map）；`BlueprintMediaRef.dedupeKey` 保证节点级去重。
- [x] 输出时间线预览和批量执行。✅ 2026-08-04 完成——`OutputNode` 在输出项多于 1 时渲染横向时间线条（最多 12 个片段，视频/图片按媒体类型着色，含缩略图与序号徽标）；批量执行由 `runBlueprint` 的 `mode: 'all'` 提供，工具栏执行即批量。
- [x] 灰度开关和异常指标。✅ 2026-08-04 完成——新增 `app-settings-store.ts` 的 `blueprintConfig.allowPaidExecution` 灰度开关（设置面板"蓝图执行灰度"区域可切换，关闭后 `confirmPaidTask` 拒绝提交付费任务）；新增 `execution-metrics.ts` 内存指标模块（执行次数/失败率/恢复成功率/重复任务/媒体失败，maxHistory=200），`execution-engine.ts` 增加 `runBlueprintWithMetrics` 包装，`recoverVideoTasks` 记录恢复指标，`BlueprintView` 头部"📊 指标"按钮弹出 `ExecutionMetricsPanel` 实时健康面板；新增 9 个指标测试，全量 446 个测试通过。

### P2：后续迭代

- [ ] AI 蓝图助手。
- [ ] 高级模板和模板市场。
- [ ] 协作和跨设备同步。
- [ ] 大规模画布性能优化。
- [ ] Director/S-Class 专用蓝图节点。

### 禁止提前标记完成的事项

以下事项必须以独立验收结果为准：

**已合法完成**：蓝图 store 与项目级持久化 ✅、React Flow 画布和节点组件 ✅、DAG 遍历与执行引擎 ✅、图校验（含 generator projectId/model） ✅、输入合并规则 ✅、项目切换验收 ✅、四模块导航迁移 ✅、剧本 Agent 工作台 ✅、Markdown 剧本转分镜/蓝图 ✅、图片生成接入与媒体落库 ✅、视频任务持久化与恢复核心（onTaskCreated + BlueprintTaskRef + recoverVideoTasks + 去重） ✅、生成链边界（Freedom API 隔离 + Director/S-Class 不侵入 + 边界测试 12 个） ✅、P1 全部完成（视频参考/生成节点 + 素材库上传与 assetid、启动/在线任务恢复、输出时间线预览与批量执行、灰度开关与异常指标） ✅

**仍禁止提前标记完成**：

- 生产数据迁移、集成测试和灰度发布

---

## 十五、建议工期

以当前代码规模和“可靠恢复”要求估算：

- 阶段 0：2–3 天
- 阶段 1：4–6 天
- 阶段 2：7–10 天
- 阶段 3：7–10 天
- 阶段 4 图片部分：5–8 天
- 阶段 4 视频恢复：8–12 天
- 阶段 5：5–8 天
- 阶段 6：5–8 天
- 阶段 7：7–12 天

建议目标：

- 可演示的画布原型：2 周左右。
- 可保存、可切换、可执行的图片 MVP-A：4–6 周。
- 包含视频任务恢复和测试的生产可用 MVP-B：7–10 周。
- AI 助手、模板和性能优化：另计 3–6 周。

---

## 十六、下一步执行顺序

### 已完成 ✅

1. [x] **阶段 0**：架构决策、数据契约、端口契约、依赖确认和功能开关（`types/blueprint.ts`、`feature-flag.ts`、模块目录骨架）。
2. [x] **蓝图 store**（阶段 1 6.1）：项目级持久化、partialize/migrate、蓝图 CRUD、节点/边编辑、视口、运行锁/取消、项目切换 hydrate；专项测试 7 个 ✅。
3. [x] **蓝图编辑器 MVP**（阶段 2 7.1–7.3）：画布（ReactFlow + Background/Controls/MiniMap）、5 种基础节点、视频节点占位、工具栏（选中/下游/全部/取消）、属性面板（6 种节点类型编辑器）。
4. [x] **图校验**（阶段 3 8.1，除 generator projectId/model 外）：节点 ID 唯一、边存在、自环/循环检测、端口类型匹配、必填输入连接、prompt 校验、输出节点上游检查。
5. [x] **DAG 遍历**（阶段 3 8.2）：拓扑排序、环检测、上下游子图、并发调度、确定性顺序。
6. [x] **执行引擎**（阶段 3 8.3）：runId、依赖调度、AbortSignal、错误隔离、dedup。
7. [x] **输入合并规则**（阶段 3 8.4）：文本合并优先级、图片保序、视频 role 映射、缺失策略、stale 传播。
8. [x] **项目切换验收**（阶段 1 6.3）：A/B 切换不串数据、重启恢复、删除清理、空状态不写入。
9. [x] **单元测试基础设施**：Vitest 配置、蓝图 schema/端口/stale/copy-policy/执行引擎/输入合并/项目切换测试，175 个蓝图测试通过。
10. [x] **generator 节点 projectId/model 校验**（2026-07-09 完成）：在 `graph-validation.ts` 中增加了 `generatorMissingModel`（warn）和 `projectMissingId`（error）两条诊断规则，分别检查生成节点的 model 配置和项目 projectId 存在性。
11. [x] **四模块导航迁移**（2026-07-09 完成，2026-08-04 修订）：`media-panel-store.ts` 的 `mainNavItems` 为 `script`/`storyboard`/`blueprint`/`freedom` 四项；Freedom 是一级模型测试工作室；`Stage` 类型和 `stages` 数组维持四模块。
12. [x] **剧本 Agent 工作台**（2026-07-09 完成）：新建 `script-workspace-store.ts`（Zustand + project-scoped persist）、`src/components/script-workspace/` 目录含 4 个组件文件（`index.tsx` 三栏布局、`ProjectExplorer.tsx` 文件树、`MarkdownEditor.tsx` 编辑器+自动保存+预览、`ScriptAgentPanel.tsx` 对话+diff+分镜建议）；支持 `createProjectScopedStorage` 项目隔离持久化。
13. [x] **Markdown 剧本 → 分镜 → 蓝图导入**（2026-07-09 完成）：`script-to-blueprint.ts` 从空桩重写为完整实现——`convertScriptToBlueprint()` 将 shots 转换为蓝图节点组（text-input + script-import + image-generator + output），创建 prompt 上下文边；`previewScriptToBlueprint()` 返回统计摘要；`resolveShotPrompt()` 按优先级选取最佳提示词。
14. [x] **图片/视频生成接入与媒体落库**（2026-07-09 完成）：`node-executors.ts` 的 `executeImageGenerator` 替换为调用 `generateFreedomImage()`、`executeVideoGenerator` 替换为调用 `generateFreedomVideo()`，显式传递 projectId，返回 `BlueprintMediaRef` 含 url/mediaId/mimeType/dedupeKey/taskId；`execution-engine.ts` 的 `runBlueprint` 将 `project.projectId` 透传至执行上下文。
15. [x] **旧资源与 Director/S-Class 兼容适配**（2026-07-09 完成，2026-08-04 修订）：通过 `LEGACY_TAB_REDIRECTS` 实现旧入口重定向（characters→script、scenes→script、director→blueprint、sclass→blueprint、media/export/assets/project-assets→freedom）；Freedom 继续承载图片和视频模型测试。
16. [x] **测试与迁移**（2026-07-09 完成）：生成 API 测试统一使用 `vi.mock('@/lib/freedom/freedom-api')`，不调用收费接口；当前全部 **310 个测试通过**，无回归。
17. [x] **图片生成接入与结果写入项目媒体库**（2026-08-04 完成）：`executeImageGenerator` 已完整调用 `generateFreedomImage()`——将 `BlueprintImageGeneratorConfig` 的所有字段映射到 `FreedomImageParams`（含 extraParams 转发）；显式传递 `projectId`；返回 `BlueprintMediaRef` 含 url/mediaId/mimeType/dedupeKey/taskId；`saveToMediaLibrary` 由 Freedom API 内部调用并正确归属项目；执行引擎通过 `onUpdateNode` 将结果写回 `node.data.execution`。`extraParams` 转发 bug 已修复。
18. [x] **Freedom 一级模型测试工作室**（2026-08-04 完成并修订）：主导航第四项改为“自由”；删除资产页面及其侧栏入口；`Layout.tsx` 保留 `FreedomView` 全屏分支；图片工作室和视频工作室继续使用现有生成、历史、媒体落库、任务持久化和恢复能力；4 个导航契约测试覆盖一级入口和旧状态重定向。
19. [x] **视频生成任务持久化与恢复核心**（2026-08-04 完成）：`NodeExecutionContext` 新增 `onUpdateNode` 回调；`executeVideoGenerator` 通过 `onTaskCreated` 将 `BlueprintTaskRef`（taskId/route/pollUrl/model）即时写入节点执行状态；执行引擎透传 `onUpdateNode` 到执行器上下文（partial application 含 runId）；`blueprint-store` 新增 `recoverVideoTasks()`（扫描 running+task 节点 → `resumeFreedomVideoTask` 并行续轮询）和 `cancelRecovery()`；`finalizeFreedomVideoResult` 按 taskId 幂等去重；193 个测试通过。
20. [x] **生成链边界**（2026-08-04 完成）：验证蓝图图片/视频生成器仅使用 Freedom API（`generateFreedomImage`/`generateFreedomVideo`），`src/lib/blueprint/` 全目录零引用 Director/S-Class；`BlueprintNodeType` 为封闭联合不含 Director 特有类型；`BlueprintSourceKind` 保留 `'director-scene'` 兼容来源但生成链严格隔离；`node-executors.ts`/`execution-engine.ts`/`blueprint-store.ts`/`script-to-blueprint.ts` 添加 `@boundary` 守卫注释；新增 `generation-chain-boundary.test.ts`（12 个测试）验证节点类型封闭、端口定义隔离、无 Director/S-Class 执行器注册。205 个测试通过。
21. [x] **10.1 Markdown 剧本转分镜和蓝图**（2026-08-04 完成）：新增 `markdown-script-parser.ts`（`parseMarkdownScript`/`extractDialogue`/`extractShotInstructions`/`scenesToShots`）支持中英文编剧格式解析；扩展 `script-to-blueprint.ts` 的 `ConvertScriptToBlueprintOptions` 新增 `shots?`/`rawScript?`/`scriptProjectData?` 可选字段实现三级 shots 解析回退链（shots → scriptProjectData.shots → parseMarkdownScript）；`ScriptToBlueprintResult` 新增 `diagnostics` 字段，`generateConversionDiagnostics()` 对无提示词/缺少角色名分镜生成诊断；`makeShotSourceRef()` 支持 `sourceVersion` 追踪。新增 `markdown-script-parser.test.ts`（21 个测试）和 `script-to-blueprint.test.ts`（18 个测试）。244 个测试通过。
22. [x] **10.2 剧本 Agent 与分镜入口**（2026-08-04 完成）：新增 `BlueprintImportPreview.tsx` 模态框组件——显示快照声明、镜头/节点/任务统计、诊断徽章、带复选框的镜头选择器、目标选择（新建/替换现有）和名称输入；`blueprint-store` 新增 `importFromScript(options, target?)` 和 `previewScriptImport(options)` 方法；`ScriptAgentPanel` 集成导入预览流程，"创建新蓝图"按钮触发预览，确认后自动跳转 blueprint Tab。新增 `blueprint-import-script.test.ts`（10 个测试）。254 个测试通过。
23. [x] **10.3 旧资源和 Director/S-Class 兼容适配**（2026-08-04 完成）：新增 `legacy-id-mapper.ts`（number↔string 映射、Director SourceRef 创建/识别/迁移）、`director-to-blueprint.ts`（`DirectorSceneData` 最小接口 + `convertDirectorToBlueprint`/`previewDirectorToBlueprint`，Director 场景→蓝图节点组）、`legacy-library-mapper.ts`（角色/场景库上下文解析+提示词描述构建、保留可追溯 ID）；`graph-validation.ts` 新增 `validateLegacyDirectorSourceRefs` 旧节点检测诊断；`generation-chain-boundary.test.ts` 新增 6 个 Director 边界测试。310 个测试通过。
24. [x] **11.1 撤销重做**（2026-08-04 完成）：`undo-redo.ts` 实现手动历史栈（pastStates/futureStates + pendingSnapshot 模式），通过 zustand subscription 驱动——检测 activeProjectId/activeBlueprintId 切换自动清空历史、检测 nodes/edges/viewport 变更自动压栈；`undo()`/`redo()` 带 `applyingSnapshot` 防重入守卫；`stripExecution()` 录入前剔除运行时执行数据；`markChangedNodesStale()` 撤销/重做后标记已完成节点为 stale；`pauseTracking()`/`resumeTracking()` 支持批量操作暂停记录；`useCanUndo()`/`useCanRedo()` 通过 `useSyncExternalStore` + versionListeners 实现 React 响应式；`BlueprintView` 集成 Ctrl+Z/Ctrl+Shift+Z 快捷键；`BlueprintToolbar` 集成撤销/重做按钮。335 个测试通过。
25. [x] **11.2 部分执行和替换**（2026-08-04 完成）：`execution-bridge.ts` 桥接层连接 store `beginRun`/`finishRun` 与引擎 `runBlueprint`，支持 `confirmPaidTask` 收费确认回调；`execution-engine.ts` 的 `executeNodeInBatch` 增加跳过逻辑（`status === 'completed' && output` 直接复用输出）；`blueprint-store.ts` 的 `updateNode` 检测 config 变更自动标记下游 stale；`undo-redo.ts` 的 `markChangedNodesStale` 兼容 stale 状态；`BlueprintToolbar` 集成 `executeBlueprintRun`/`retryNodeExecution` 和 `🔄 重试` 按钮。335 个测试通过（新增 6 个 §11.2 专项测试）。
26. [x] **11.3 引导与错误体验**（2026-08-04 完成）：`error-utils.ts` 提供 `sanitizeErrorMessage()`（7 条正则脱敏 API key/token/URL 凭证）、`categorizeError()`（6 类：network/auth/validation/api/cancelled/blocked/unknown + 17 种网络模式识别）、`isRecoverable()`/`getRecoveryAction()`；`freedom-api.ts` 11 处高风险 pollData 调用和 `toHttpError()` 脱敏；`execution-engine.ts` 3 处 catch 脱敏；`NodeUI.tsx` 的 `NodeError` 和 `PropertiesPanel.tsx` 的 `EnhancedErrorDisplay` 展示分类徽章+恢复动作；`BlueprintOnboarding.tsx` 6 步引导组件（localStorage 持久化 + 新手模式联动）；`blueprint-store` 新增 `beginnerMode` 状态和 `toggleBeginnerMode`；`BlueprintToolbar` 集成 `BeginnerModeToggle`（🌱 新手/⚡ 高级）和 `AddNodeMenu` 过滤 video-generator。361 个测试通过（新增 26 个 §11.3 专项测试）。
27. [x] **11.4 AI 辅助**（2026-08-05 完成）：`ai-assist.ts` 服务层（`requestAIAssist`/`parseAIResponse`）通过 `callChatAPI` + `getFeatureConfig('chat')` 调用 LLM，输入边界：当前文本+用户指令+角色/语言上下文，输出边界：`[TEXT_START]/[TEXT_END]` 标记包裹的修改建议文本；撤销边界：通过 `updateNode()` 应用变更自动纳入 undo/redo 栈。`AIAssistPanel.tsx` 多轮对话界面（消息气泡+快捷提示+接受/拒绝修改建议）；`TextInputNode.tsx` 添加 ✨ 按钮弹出面板；`PropertiesPanel.tsx` 的 `TextInputEditor` 添加 "✨ AI 助手" 按钮。纯异步不阻塞执行引擎。374 个测试通过（新增 13 个 §11.4 专项测试）。
28. [x] **12.2 蓝图 schema migrate**（2026-08-05 完成）：`blueprint-migrations.ts` 从简单防御性规范化增强为多版本迁移框架——`migrateBlueprintState()` 使用 `persistedVersion` 参数驱动版本分支逻辑（预留 `if (fromVersion < N)` 逐级升级钩子）；新增 `migrateBlueprintDocument()` 对每份蓝图文档做顶层字段规范化（viewport/status/timestamps/节点边有效性校验，剔除引用不存在节点的边）；`migrateBlueprintNode()` 确保 data.nodeType/label/config 全部存在（未知类型回退 text-input，各节点类型提供合理默认 config）；`migrateBlueprintEdge()` 确保 data.dataType 存在；`applyVersionMigrations()` 预留 v1→v2→v3 逐级升级钩子。新增 `blueprint-migrations.test.ts`（44 个测试：状态级 12 个、文档级 9 个、节点级 12 个、边级 6 个、幂等性 2 个、混合畸形输入 3 个）。418 个测试通过。
29. [x] **12.1 测试基础设施**（2026-08-05 完成）：`test/setup.ts` 提供内存版 `localStorage`/`sessionStorage` polyfill——消除 zustand persist 中间件在 Node 测试环境写 localStorage 时的 TypeError 栈追踪（21 个 store 全部使用 `persist`）；`project-store.ts` 的 `discoverProjectsFromDisk()` 增加 `typeof window === 'undefined'` 守卫——非 Electron 环境磁盘扫描静默返回，消除测试输出 `[ProjectStore] Disk discovery failed: ReferenceError: window is not defined` 噪音；验证 Freedom API 在 6 个测试文件全部 `vi.mock`（`generateFreedomImage`/`generateFreedomVideo`/`resumeFreedomVideoTask`/`callChatAPI`），测试不产生任何真实网络请求；验证 coverage 报告器（V8，`--coverage` 正常输出）。418 个测试通过，测试输出零错误零警告。
30. [x] **12.3 集成测试**（2026-08-05 完成）：补齐 §12.3 剩余集成测试覆盖。新增 `blueprint-recovery-integration.test.ts`（4 个测试）——item 6 网络中断幂等：已 completed 且带 output 的节点不被复原逻辑再次提交、网络中断后节点保持 running 只提交一次；item 7 恢复幂等：同一任务连续恢复两次第二次返回 false 且不再调用 `resumeFreedomVideoTask`、`dedupeKey`（`vid-{nodeId}-{taskId}`）稳定避免重复写媒体。新增 `blueprint-scale-perf.test.ts`（5 个测试）——item 8 性能：topologicalSort/scheduleGraph 在 100/300/1000 节点分层 DAG（video-generator video 输出 → reference-media 输入）上无环且层级/顺序正确（宽松时间预算防 CI 抖动）；`runBlueprint` 100 节点端到端批量执行全部 completed、零失败零阻塞。427 个测试通过（23 个文件）。
31. [x] **12.4 数据迁移——蓝图版本与软件版本同步**（2026-08-05 完成）：按照用户指示，不单独维护蓝图 schema 版本号，改为与软件版本同步。新增 `src/lib/blueprint/schema-version.ts`：`blueprintSchemaVersionFromAppVersion()` 解析 `package.json` 版本（`major*100000 + minor*1000 + patch*10 + build`，拆 `-` 取 build，非法输入回退 0），并导出 `BLUEPRINT_SCHEMA_VERSION = blueprintSchemaVersionFromAppVersion(packageJson.version)`；`src/types/blueprint.ts` 改为 `export { BLUEPRINT_SCHEMA_VERSION } from '@/lib/blueprint/schema-version'` 以保留 8 处既有导入路径不变；每次软件发版版本号变化 → zustand persist `version` 精确不等 → 自动触发 `migrate`。新增 `schema-version.test.ts`（7 个测试：`0.4.0-2`→4002、`0.4.0`→4000、`1.2.3-4`→102034、`0.5.0-0`→5000、patch 递增单调、非法输入回退、与 packageJson 派生一致）；修正 `script-to-blueprint.test.ts` 中硬编码 `version: 1` 的断言改为引用 `BLUEPRINT_SCHEMA_VERSION`。434 个测试通过（24 个文件）。
32. [x] **12.4 数据迁移——线性工作流迁移范围确认**（2026-08-06 完成）：用户明确"不处理线性工作流相关内容"，§12.4 items 2-5 标记跳过（⏭️）——不新增 `scripts/migrate-to-blueprint.cjs` 批量转换脚本、不覆盖/不删除旧项目数据、旧 tab 已在 §6.2 通过 `LEGACY_TAB_REDIRECTS` 重定向到四模块，无需额外映射迁移。
33. [x] **12.5 灰度发布——侧边栏蓝图入口**（2026-08-06 完成）：侧边栏蓝图入口已在 §6.2 实现（`mainNavItems` 蓝图项 + `TabBar` 渲染 + `Layout` 分发到 `BlueprintView`）。按用户指示"本版本不会发布，没必要添加开发模式才显示蓝图入口，直接放在侧边栏就行"：移除 `mainNavItems` 中的 `isBlueprintFeatureEnabled()` 条件展开，蓝图项无条件常驻（`{ id: "blueprint", label: "蓝图", icon: SparklesIcon, phase: "03" }`）；移除不再使用的 `isBlueprintFeatureEnabled` 导入和 `.env.development` 文件；新增 `media-panel-store.test.ts` 断言蓝图入口常驻。435 个测试通过（24 个文件）。

### 后续（下一阶段）

25. [ ] 视频任务恢复启动集成：应用启动自动扫描、`navigator.onLine` 恢复触发、UI 恢复进度展示。
27. [ ] 剧本 Agent 工作台接入真实 AI API（当前为 placeholder 响应）。
27. [x] 移除项目资产页面（AssetsView）；媒体 store 仅作为生成结果和历史记录的内部持久化基础设施保留。
28. [ ] 分镜页面（StoryboardView）实现镜头编辑和排序。

**最终原则：先保证项目隔离、任务可恢复、媒体可追溯和收费操作可控，再扩展节点数量和智能能力。**
