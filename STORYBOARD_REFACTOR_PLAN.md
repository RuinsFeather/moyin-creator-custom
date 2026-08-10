# “分镜”功能重构开发计划

> 文档状态：待实施  
> 更新日期：2026-08-06  
> 适用项目：Moyin Creator  
> 目标模块：分镜（Storyboard）

---

## 1. 重构背景

当前“分镜”模块仍以 `SplitScene` 和 `director-store` 为核心，同时承载剧本导入、分镜编辑、首帧/尾帧生成、提示词、视频状态和旧导演台兼容逻辑，职责过多且数据结构复杂。

本次重构将“分镜”重新定义为：

> **面向当前项目中一份单集、单场剧本的 AI 拆镜和人工整理表，不负责生成图片或视频。**

每个项目只处理一个单集、单场剧本。其他集数通过打开其他项目管理，因此分镜模块内部不建立“第 X 集 / 第 X 场”层级，也不提供跨集、跨场切换或批量管理。

目标产品链路：

```text
当前项目剧本 → AI 拆分镜头 → 人工审核整理 → 保存分镜文件 → 蓝图生产
```

---

## 2. 核心边界

### 2.1 分镜表包含的信息

每条分镜只需要清楚表达以下内容：

1. **镜头号**
2. **画面内容描述**
   - 场景
   - 动作
   - 对白
   - 景别
   - 时长
   - 镜头运动
   - 其他必要镜头信息
3. **参考项**
   - 角色
   - 服装
   - 场景
4. **备注**
5. **参考图**

### 2.2 明确不包含的信息和功能

新分镜模块不再包含：

- 剧集列表。
- 场次列表。
- 第 X 集、第 X 场编号。
- 跨集、跨场筛选和导航。
- 整剧或多集批量分析。
- 首帧生成、上传和管理。
- 尾帧生成、上传和管理。
- 图片生成。
- 视频生成。
- 图片提示词。
- 视频提示词。
- 提示词生成和优化。
- 首尾帧连续性和级联。
- 视频尾帧提取。
- 九宫格故事板生成和切割。
- 图片模型、视频模型、宽高比和分辨率配置。

图片和视频生成统一交由“蓝图”或“自由”模块处理。

---

## 3. 目标工作流

```mermaid
flowchart LR
    A[当前项目剧本] --> B[导入分镜]
    B --> C[AI 分析单集单场剧本]
    C --> D[拆分镜头]
    D --> E[生成画面内容描述]
    E --> F[匹配角色/服装/场景]
    F --> G[分镜表人工审核]
    G --> H[补充备注和参考图]
    H --> I[保存到当前工作区]
    I --> J[提供给蓝图]
```

### 3.1 首次进入分镜页

当前项目没有分镜时显示空状态：

- “从剧本导入”主按钮。
- 当前剧本文件名称和更新时间。
- 当前项目不存在剧本时，引导用户前往“剧本”模块。

不得显示剧集、场次、首帧、尾帧或图片生成区域。

### 3.2 导入剧本

“从剧本导入”窗口展示：

- 当前项目中可导入的剧本文件。
- 剧本文本预览。
- 剧本最后更新时间。
- 当前分镜是否已经存在。
- 导入策略：首次导入、更新现有分镜、覆盖并重新拆分、创建新版本。

一次只导入一份代表当前项目单集、单场内容的剧本，不提供剧集或场次范围选择。

### 3.3 AI 拆分

AI 按以下顺序执行：

1. 读取当前剧本全文和项目背景。
2. 识别主要场景、人物、服装、动作和对白。
3. 根据视觉动作和叙事重点拆分镜头。
4. 为每个镜头生成结构化画面内容描述。
5. 给出角色、服装和场景参考项。
6. 返回严格 JSON。
7. 前端解析、校验和标准化结果。
8. 用户确认后写入分镜表。

AI 分析失败时不得覆盖现有分镜。

### 3.4 人工审核

用户可以编辑镜头号、画面内容、场景、动作、对白、景别、时长、镜头运动、角色、服装、场景参考项、备注和参考图，并可新增、复制、删除、拆分、合并和拖动排序镜头。

---

## 4. 页面和交互设计

## 4.1 页面布局

取消剧集/场次树，使用以分镜表为中心的双栏布局：

```text
┌─────────────────────────────────────────────────────────────┐
│ 顶部工具栏                                                   │
├──────────────────────────────────────────┬──────────────────┤
│ 分镜表                                   │ 当前镜头详情     │
│                                          │                  │
└──────────────────────────────────────────┴──────────────────┘
```

主区域显示当前项目唯一的分镜表；详情区域编辑当前镜头的完整画面信息、参考项、备注和参考图。不显示任何集、场层级。

## 4.2 顶部工具栏

工具栏包含：

- 从剧本导入。
- AI 拆分。
- 重新拆分。
- 新增镜头。
- 批量删除。
- 版本历史。
- 保存。

保存目标为资源管理器当前打开的工作区文件夹。默认生成或更新 `storyboard.json`，可选生成便于查看的 `storyboard.md`。

工具栏不包含剧集选择器、场次筛选器、首尾帧配置、模型选择、图片生成或提示词功能。

## 4.3 分镜表

核心列固定为：

| 列 | 内容 |
|---|---|
| 选择 | 批量选择镜头 |
| 镜头号 | 镜头顺序、拖动手柄和镜号 |
| 画面内容描述 | 场景、动作、对白、景别、时长、镜头运动等 |
| 参考项 | 角色、服装、场景 |
| 备注 | 制作要求、连续性和其他补充信息 |
| 参考图 | 资产库、本地上传或已有关联资源 |
| 操作 | 拆分、合并、复制、删除 |

“画面内容描述”以紧凑摘要展示，选中镜头后在详情面板中分别编辑场景、动作、对白、景别、时长、镜头运动和补充描述。

“参考项”使用分组标签或紧凑列表展示角色、服装和场景。参考项是语义引用，不等同于参考图；参考项可以没有图片，参考图也可以独立存在。

参考图只用于信息整理和后续蓝图消费，不触发任何生成任务。

## 4.4 当前镜头详情

详情面板包括：

- 镜头号。
- 场景描述。
- 动作描述。
- 对白。
- 景别。
- 时长。
- 镜头运动。
- 其他画面补充描述。
- 角色选择。
- 角色服装或造型选择。
- 场景选择。
- 备注。
- 参考图添加、删除和排序。

产品层面只提供一个“备注”字段，界面可以用模板辅助输入，不强制拆分为多个备注字段。

---

## 5. 新数据模型

新增独立分镜领域类型和 Store：

```text
src/types/storyboard.ts
src/stores/storyboard-store.ts
```

### 5.1 `StoryboardDocument`

一个项目只维护一份当前分镜文档，不包含集或场层级：

```ts
interface StoryboardDocument {
  id: string;
  projectId: string;
  title: string;

  sourceScriptPath: string;
  sourceScriptRevision?: string;
  sourceScriptContentHash?: string;

  version: number;
  status: 'draft' | 'analyzing' | 'review' | 'confirmed';
  shots: StoryboardShot[];

  createdAt: number;
  updatedAt: number;
}
```

### 5.2 `StoryboardShot`

```ts
interface StoryboardShot {
  id: string;

  sourceText?: string;
  sourceTextRange?: {
    start: number;
    end: number;
  };

  order: number;
  shotNumber: string;

  content: StoryboardShotContent;
  references: StoryboardReferences;
  notes: string;
  referenceImages: StoryboardReferenceImage[];

  origin: 'ai' | 'manual' | 'imported';
  reviewStatus: 'pending' | 'confirmed' | 'modified';
  createdAt: number;
  updatedAt: number;
}
```

### 5.3 `StoryboardShotContent`

```ts
interface StoryboardShotContent {
  summary: string;
  scene: string;
  action: string;
  dialogue: string;
  shotSize: string;
  durationSeconds?: number;
  cameraMovement: string;
  additionalDescription?: string;
}
```

### 5.4 `StoryboardReferences`

```ts
interface StoryboardReferences {
  characters: StoryboardReferenceItem[];
  costumes: StoryboardReferenceItem[];
  scenes: StoryboardReferenceItem[];
}

interface StoryboardReferenceItem {
  id: string;
  name: string;
  libraryItemId?: string;
  source: 'library' | 'ai-suggestion' | 'manual';
}
```

### 5.5 `StoryboardReferenceImage`

```ts
interface StoryboardReferenceImage {
  id: string;
  sourceType: 'asset' | 'character' | 'costume' | 'scene' | 'upload';
  assetId?: string;
  relatedReferenceId?: string;
  localUrl?: string;
  thumbnailUrl?: string;
  label?: string;
}
```

### 5.6 禁止进入新模型的字段

新分镜类型不得加入：

- `sourceEpisodeId`、`sourceSceneId`、`selectedEpisodeId`、`selectedSceneId`。
- `imagePrompt`、`imagePromptZh`、`endFramePrompt`、`endFramePromptZh`。
- `videoPrompt`、`videoPromptZh`。
- `imageDataUrl`、`imageHttpUrl`、`endFrameImageUrl`、`endFrameHttpUrl`。
- `imageStatus`、`endFrameStatus`、`videoStatus`、`videoUrl`。
- `needsEndFrame`。
- 首帧、尾帧、图片或视频的进度及错误字段。

---

## 6. AI 拆分方案

沿用：

```ts
callFeatureAPI('script_analysis', systemPrompt, userPrompt)
```

新增：

```text
src/lib/storyboard/storyboard-analysis-service.ts
src/lib/storyboard/storyboard-response-parser.ts
src/lib/storyboard/storyboard-validator.ts
```

每次分析当前项目中的完整单集、单场剧本，不建立跨集、跨场任务队列。任务支持开始、取消、失败重试、网络或应用恢复后继续，以及覆盖前自动快照。

AI 输入包括：

- 当前项目背景。
- 当前剧本完整正文。
- 当前项目角色库及稳定 ID。
- 角色服装、造型和变体列表。
- 当前项目场景库及稳定 ID。
- 拆镜精细度、目标镜头数量、对白保留和时长偏好。

AI 只返回严格 JSON：

```json
{
  "shots": [
    {
      "shotNumber": "1",
      "sourceText": "林夏推门进入咖啡馆。",
      "content": {
        "summary": "林夏进入咖啡馆并观察室内。",
        "scene": "日间咖啡馆入口，室内客人稀少。",
        "action": "林夏推门进入，停步扫视室内。",
        "dialogue": "",
        "shotSize": "中景",
        "durationSeconds": 3,
        "cameraMovement": "跟随",
        "additionalDescription": "保持入口与吧台的空间关系清晰。"
      },
      "references": {
        "characters": ["林夏"],
        "costumes": ["林夏-日常外套"],
        "scenes": ["咖啡馆"]
      },
      "notes": "注意与下一镜人物视线连续。",
      "referenceImageSuggestions": []
    }
  ]
}
```

系统提示必须明确：

1. 不输出集数或场次编号。
2. 不建立多集、多场层级。
3. 不生成图片或视频提示词。
4. 不描述首帧或尾帧。
5. 每个镜头只表达一个主要视觉动作或叙事重点。
6. 对白拆镜要考虑说话者和听者反应。
7. 保持角色、服装、道具、站位和动作连续性。
8. 不得凭空新增剧情和资源。
9. 无法匹配的角色、服装或场景以建议项返回，不能伪造资源 ID。
10. 每个镜头尽可能保留可追溯的源剧本文本。
11. 输出必须符合 JSON Schema。

---

## 7. 导入、去重和剧本同步

一个项目只存在一份当前分镜文档，稳定归属键为：

```text
projectId + sourceScriptPath
```

重新导入同一剧本时不新增集或场层级，而是让用户选择更新、覆盖或创建版本。

### 更新现有分镜

- 保留已人工修改的镜头。
- 根据源文本匹配未修改镜头。
- 新剧本内容生成新镜头建议。
- 被删除的源文本对应镜头进入待确认状态。

### 覆盖并重新拆分

- 创建当前分镜自动快照。
- 使用当前剧本重新执行完整拆分。
- 用户确认后替换当前表格。

### 创建新版本

- 保留当前版本。
- 创建新版本并执行拆分。
- 允许查看、切换和恢复版本。

文档保存 `sourceScriptRevision` 和 `sourceScriptContentHash`。进入分镜页时比较当前剧本；更新和覆盖不得静默丢弃人工修改。

---

## 8. Store 和文件持久化

新增：

```text
src/stores/storyboard-store.ts
```

```ts
interface StoryboardState {
  document: StoryboardDocument | null;
  selectedShotId: string | null;
  analysisJob: StoryboardAnalysisJob | null;
  importDialogOpen: boolean;
  dirty: boolean;
}
```

不设置 `selectedEpisodeId`、`selectedSceneId` 或多个分镜文档列表。

核心操作：

- `importFromScript`
- `analyzeScript`
- `cancelAnalysis`
- `retryAnalysis`
- `replaceShots`
- `addShot`
- `duplicateShot`
- `splitShot`
- `mergeShots`
- `updateShot`
- `deleteShot`
- `reorderShots`
- `setShotReferences`
- `addReferenceImage`
- `removeReferenceImage`
- `confirmShot`
- `createVersion`
- `restoreVersion`
- `saveToWorkspace`

### 双层持久化

项目级状态继续使用：

```ts
createProjectScopedStorage('storyboard')
```

用于恢复当前编辑状态、选中镜头和分析任务。

保存操作将分镜文档写入资源管理器当前打开的工作区文件夹：

```text
storyboard.json
```

可选生成：

```text
storyboard.md
```

JSON 是后续蓝图消费的权威结构化数据；Markdown 仅用于人工查看或导出。参考图只保存稳定 `assetId` 或 `local-image://` 引用，不保存临时 Base64。

---

## 9. 代码复用和清理

可以复用：

- `src/lib/ai/feature-router.ts`。
- `callFeatureAPI('script_analysis', ...)`。
- `src/stores/script-store.ts`。
- 剧本工作区文件读取能力。
- 当前角色库、服装变体和场景库数据。
- `src/lib/project-storage.ts`。
- 本地图片持久化和资产库选择能力。
- 现有分镜表的行编辑、删除和排序交互。

新模块停止使用：

- `StoryboardTablePanel.handleGenerateImage`。
- `handleGenerateAll`。
- `handleOptimizePrompt`。
- `handleOptimizeAll`。
- `generateFreedomImage`。
- `optimizeScenePrompt`。
- 首帧、尾帧上传和删除入口。
- `needsEndFrame`。
- `director-shot-store`。
- 旧导演台视频生成 Hook。
- 九宫格故事板生成和切割逻辑。

先隔离、不立即删除：

```text
src/components/panels/director/**
src/lib/storyboard/storyboard-service.ts
src/lib/storyboard/prompt-builder.ts
src/lib/storyboard/grid-calculator.ts
src/lib/storyboard/image-splitter.ts
```

清理顺序：新分镜脱离 `director-store` → 蓝图读取新 Store 或 `storyboard.json` → 清理旧类型引用 → 删除无效 legacy 代码。

---

## 10. 建议目录结构

```text
src/
├─ components/
│  └─ panels/
│     └─ storyboard/
│        ├─ index.tsx
│        ├─ StoryboardToolbar.tsx
│        ├─ ScriptImportDialog.tsx
│        ├─ StoryboardTable.tsx
│        ├─ StoryboardRow.tsx
│        ├─ StoryboardDetailPanel.tsx
│        ├─ ShotContentEditor.tsx
│        ├─ ReferenceItemsEditor.tsx
│        ├─ ReferenceImageField.tsx
│        └─ AnalysisProgress.tsx
+├─ lib/
│  └─ storyboard/
│     ├─ storyboard-analysis-service.ts
│     ├─ storyboard-response-parser.ts
│     ├─ storyboard-validator.ts
│     ├─ script-importer.ts
│     ├─ storyboard-file-service.ts
│     ├─ storyboard-exporter.ts
│     └─ storyboard-migration.ts
├─ stores/
│  └─ storyboard-store.ts
└─ types/
   └─ storyboard.ts
```

---

## 11. 分阶段实施计划

### 阶段 0：依赖审计

- [ ] 搜索 `SplitScene` 和 `director-store` 的全部引用。
- [ ] 搜索蓝图对旧分镜数据的转换入口。
- [ ] 搜索首帧、尾帧、提示词和视频字段引用。
- [ ] 记录 legacy 文件清单。
- [ ] 建立类型检查、测试和构建基线。

完成标准：明确旧功能安全移除边界，完整测试基线通过。

### 阶段 1：建立新模型和 Store

- [ ] 新增 `src/types/storyboard.ts`。
- [ ] 定义单文档 `StoryboardDocument`、`StoryboardShot` 和 `StoryboardShotContent`。
- [ ] 定义角色、服装、场景参考项和参考图。
- [ ] 新增 `storyboard-store.ts`。
- [ ] 实现 CRUD、排序、拆分、合并和复制。
- [ ] 接入项目级持久化。
- [ ] 增加 Store 单元测试。

完成标准：新模型不包含集、场、首尾帧和提示词字段，新 Store 不依赖 `director-store`。

### 阶段 2：单剧本导入和文件保存

- [ ] 从当前项目导入一份剧本。
- [ ] 保存剧本路径、revision 和内容 hash。
- [ ] 实现更新、覆盖和创建版本。
- [ ] 实现保存 `storyboard.json` 到当前工作区。
- [ ] 可选生成 `storyboard.md`。
- [ ] 增加导入和文件读写测试。

完成标准：一个项目只有一张分镜表，保存文件可被重新读取。

### 阶段 3：AI 完整剧本拆镜

- [ ] 新增分析服务、解析器和校验器。
- [ ] 接入 `script_analysis`。
- [ ] 定义严格 JSON Schema。
- [ ] 实现画面内容字段校验。
- [ ] 实现角色、服装、场景名称匹配。
- [ ] 实现取消、失败重试和任务恢复。
- [ ] 应用 AI 结果前创建快照。
- [ ] 增加异常响应和恢复测试。

完成标准：AI 一次分析当前单集单场剧本，输出不含集、场、首尾帧和提示词，失败不覆盖现有分镜。

### 阶段 4：重做分镜页面

- [ ] 实现空状态和剧本导入入口。
- [ ] 实现顶部工具栏。
- [ ] 移除剧集/场次导航设计。
- [ ] 实现单张分镜表。
- [ ] 实现镜头号和拖动排序。
- [ ] 实现画面内容摘要与详情编辑。
- [ ] 实现角色、服装、场景参考项。
- [ ] 实现备注。
- [ ] 实现参考图选择、上传、删除和排序。
- [ ] 实现新增、复制、拆分、合并和删除。
- [ ] 实现 AI 状态和保存状态。
- [ ] 移除所有首尾帧、生成和提示词 UI。

完成标准：用户可在单页完成导入、AI 拆镜、编辑、审核和保存。

### 阶段 5：版本和剧本变更检测

- [ ] 检测剧本 revision 和内容 hash。
- [ ] 提示源剧本变更。
- [ ] 实现差异查看、更新、覆盖重拆和忽略。
- [ ] 实现版本快照、切换和恢复。

完成标准：人工修改不会被静默覆盖，覆盖重拆前可恢复。

### 阶段 6：蓝图消费新分镜

- [ ] 定义分镜到蓝图的转换接口。
- [ ] 映射镜头号和画面内容。
- [ ] 映射角色、服装和场景参考项。
- [ ] 映射备注和参考图。
- [ ] 保留分镜 ID 作为来源追踪。
- [ ] 更新旧 `director-to-blueprint` 逻辑。
- [ ] 增加转换和幂等性测试。

完成标准：蓝图可直接消费结构化分镜，不要求首帧、尾帧或提示词。

### 阶段 7：旧数据迁移和清理

- [ ] 新增 `storyboard-migration.ts`。
- [ ] 从旧 `SplitScene` 提取场景、动作、对白、景别、时长和镜头运动。
- [ ] 将角色、服装变体和场景映射到 `references`。
- [ ] 迁移备注和可用参考图。
- [ ] 丢弃首尾帧、提示词和视频状态。
- [ ] 切断页面和蓝图对旧 Store 的依赖。
- [ ] 删除无引用 legacy 代码。

完成标准：旧项目重要分镜信息可迁移，新主流程不依赖 `director-store`，完整构建和测试通过。

---

## 12. 测试计划

### 类型和纯函数

- [ ] AI JSON 响应解析。
- [ ] 画面内容字段标准化。
- [ ] 非法字段和空镜头拒绝。
- [ ] 角色名称映射。
- [ ] 服装名称映射。
- [ ] 场景名称映射。
- [ ] 源文本范围映射。
- [ ] 剧本内容 hash。

### Store 和文件

- [ ] 创建单一分镜文档。
- [ ] 新增、更新、复制和删除镜头。
- [ ] 拆分和合并镜头。
- [ ] 拖动排序和镜头号重排。
- [ ] 更新角色、服装、场景和参考图。
- [ ] 项目切换隔离。
- [ ] 项目级状态恢复。
- [ ] `storyboard.json` 写入和读取。
- [ ] 版本创建和恢复。

### AI 流程

- [ ] 完整剧本分析成功。
- [ ] AI 返回 Markdown 代码围栏。
- [ ] AI 返回非 JSON 文本。
- [ ] AI 返回空镜头数组。
- [ ] AI 返回不存在的角色、服装或场景。
- [ ] 分析失败不覆盖已有分镜。
- [ ] 取消、重试和恢复。

### UI 和回归

- [ ] 空状态和导入入口。
- [ ] 不显示集、场导航。
- [ ] 分镜行和详情编辑。
- [ ] 角色、服装、场景和参考图操作。
- [ ] 备注编辑。
- [ ] 拆分、合并、复制、删除和拖动排序。
- [ ] AI 状态和保存状态。
- [ ] 剧本、蓝图、项目切换和应用重启正常。
- [ ] `npm run typecheck`、完整 Vitest 和桌面构建通过。

---

## 13. 旧数据迁移原则

| 旧字段 | 新字段/处理方式 |
|---|---|
| `sceneName` / `sceneLocation` | `content.scene` |
| `actionSummary` | `content.action` / `content.summary` |
| `dialogue` | `content.dialogue` |
| `shotSize` | `content.shotSize` |
| `cameraMovement` | `content.cameraMovement` |
| `duration` | `content.durationSeconds` |
| `characterIds` | `references.characters` |
| `characterVariationMap` | `references.costumes` |
| 场景关联 | `references.scenes` |
| 可用场景/角色图片 | `referenceImages` |
| `sourceEpisodeId` / `sourceEpisodeIndex` | 丢弃，不在新模型建立集层级 |
| `imagePrompt*` / `endFramePrompt*` / `videoPrompt*` | 丢弃 |
| 首帧/尾帧图片 | 不作为帧迁移；已入资产库的图片可选择迁为普通参考图 |
| 图片/视频状态 | 丢弃 |

迁移前必须保留旧数据备份；单条映射失败不得阻塞整个项目加载。

---

## 14. 风险与应对

### 旧 Store 引用范围大

先建立新 Store 和适配器，再切换蓝图，最后删除 legacy 字段。

### AI 输出不稳定

使用严格 JSON Schema、解析器和校验器；无法匹配的参考项进入待确认状态；失败时不覆盖现有数据。

### 重新拆分覆盖人工修改

保存 `origin` 和 `reviewStatus`，覆盖前自动快照，并要求用户确认。

### 单份剧本内容过长

当前业务边界仍是单集单场。若文本超过模型上下文限制，服务层可按文本段落分批分析并在返回前合并镜头，但 UI 和数据模型仍保持一张分镜表，不暴露集或场层级。

### 参考图失效

上传后立即保存到工作区或资产库，Store 和 `storyboard.json` 只保存稳定引用。

---

## 15. 验收标准

1. 每个项目只存在一张对应单集、单场剧本的分镜表。
2. 页面不显示“第 X 集”“第 X 场”或集场导航。
3. 能从当前项目“剧本”模块导入一份剧本。
4. AI 能将剧本拆分为结构化镜头。
5. 每个镜头清楚包含：镜头号、画面内容描述、场景、动作、对白、景别、时长、镜头运动、角色参考项、服装参考项、场景参考项、备注和参考图。
6. 用户可以新增、删除、复制、拆分、合并和排序镜头。
7. 用户可以编辑全部画面内容和参考信息。
8. 重新导入不会创建新的集或场层级。
9. 能检测源剧本变化，且人工修改不会被静默覆盖。
10. 分镜可以保存到资源管理器当前工作区的 `storyboard.json`。
11. 应用重启或项目切换后数据和参考图可恢复。
12. 页面不再包含首帧、尾帧、图片/视频生成和提示词功能。
13. AI 异常不会覆盖现有分镜。
14. 蓝图可以读取结构化分镜数据。
15. 新分镜主流程不依赖 `director-store`。
16. TypeScript 类型检查、完整测试和桌面构建通过。

---

## 16. 优先级和里程碑

### P0：核心可用

- 单项目唯一分镜文档。
- 独立 `storyboard-store`。
- 当前剧本导入。
- AI 完整剧本拆镜。
- 镜头号和画面内容编辑。
- 角色、服装、场景参考项。
- 备注和参考图。
- CRUD、排序和工作区文件保存。
- 移除首尾帧及提示词 UI。

### P1：稳定生产

- AI 取消、重试和恢复。
- 剧本变更检测。
- 分镜版本历史。
- 蓝图读取新分镜。
- 旧数据迁移。

### P2：体验完善

- 拆分和合并交互优化。
- 批量编辑。
- 版本对比。
- 参考项自动匹配确认。
- 搜索和快捷键。
- Legacy 代码最终删除。

---

## 17. 最终交付物

- [ ] 新分镜领域类型。
- [ ] 新分镜 Zustand Store。
- [ ] 单剧本导入服务。
- [ ] AI 分镜拆分、解析和校验服务。
- [ ] 单表式分镜页面。
- [ ] 画面内容详情编辑器。
- [ ] 角色、服装、场景参考项编辑器。
- [ ] 备注和参考图能力。
- [ ] 工作区 JSON 文件保存服务。
- [ ] 剧本变更检测和版本管理。
- [ ] 新分镜到蓝图转换层。
- [ ] 旧数据迁移器和 legacy 清理。
- [ ] 单元、Store、AI 流程和 UI 测试。
- [ ] 更新后的用户文档。
