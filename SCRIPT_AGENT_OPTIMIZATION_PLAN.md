# 剧本助手 Agent 优化开发计划

> 文档状态：待实施
> 创建日期：2026-08-31
> 适用项目：Moyin Creator
> 目标模块：剧本工作区 / 剧本助手（ScriptAgentPanel）
> 参照对象：VS Code 内置 Agent 聊天窗口（GitHub Copilot Chat）

---

## 1. 背景与结论

对照 VS Code Agent 聊天窗口的能力清单，对“剧本助手”全链路（`ScriptAgentPanel.tsx` / `agent-protocol.ts` / `chat-stream.ts` / `feature-router.ts` / `script-workspace-store.ts`）完成审查。

**结论**：流式输出、会话管理、上下文引用、Diff 确认这些骨架已对齐 VS Code，但有 **4 项 VS Code 标配能力完全缺失**，另有若干体验短板与死代码。

目标链路：

```text
用户输入 → 上下文构建（预算化）→ 流式生成（可中止）→ 富渲染展示 → 编辑确认（diff/撤销）→ 蓝图生产
```

---

## 2. P0 —— VS Code 标配但当前缺失

### 2.1 无法停止生成（最痛）

- `chat-stream.ts` 的 `ChatStreamOptions` 已支持 `signal?: AbortSignal`，但 `ScriptAgentPanel.handleSend` 调用 `callFeatureAPIStream` 时未传入
- UI 无停止按钮，`isAgentThinking` 期间只能干等；也无 Escape 中断
- VS Code 生成时发送按钮变为停止按钮，随时可取消

**实施**：
- `handleSend` 内创建 `AbortController`，signal 透传 `callFeatureAPIStream` → `callChatAPIStream`
- 生成中：发送按钮切换为停止图标；Escape 键中止
- 中止后保留已生成的部分内容，追加“⏹ 已停止”标记，不按错误处理

### 2.2 消息无 Markdown 渲染

- 现状：所有消息 `whitespace-pre-wrap` 纯文本渲染（`ScriptAgentPanel.tsx` 消息区）
- `package.json` 未安装 `react-markdown`，模型输出的标题/列表/代码块全部显示原始符号

**实施**：
- 新增依赖 `react-markdown`（+ `remark-gfm` 表格支持）
- 助手消息走 Markdown 渲染（正文 prose 样式、代码块等宽+复制按钮），用户消息保持纯文本
- 注意 XSS：不用 rehype-raw，禁用原生 HTML

### 2.3 流式期间强制滚动，无法回看

- 现状：`useEffect` 监听最后一条消息 `content`，每个 delta 都 `scrollIntoView`，用户上滚阅读历史会被不断拽回底部
- VS Code 行为：仅当用户已位于底部时才自动滚动

**实施**：
- 消息容器加 `onScroll`，距底 < 40px 视为“贴底”
- 贴底时才自动滚动；用户上滚后不再强制拉回，并显示“↓ 回到最新”悬浮按钮

### 2.4 上下文无预算，存在超限风险

- 现状：`buildAgentContext` 每次把全部工作区文件正文塞进一条 JSON user 消息（上限 `MAX_WORKSPACE_CONTEXT_SIZE = 800K` 字符）
- 项目已有 `model-registry.ts`（contextWindow 查询）与 `script-parser.ts` 的 90% 超限检查（L259-276），但 agent 路径完全未使用
- 换到 32K 上下文模型会直接报错或被上游静默截断

**实施**：
- 按 `model-registry.ts` 查询当前模型 `contextWindow`，换算字符预算（约 ×2.5 token 系数，预留 20% 输出 + 10% 安全边际）
- 分层填充：当前文件全文 + 勾选参考全文优先；其余文件降级为目录摘要（name/path/type）
- 超预算时 UI 提示“上下文已裁剪：N 个文件仅发送摘要”

---

## 3. P1 —— 体验短板

| # | 问题 | 现状与实施要点 |
|---|------|----------------|
| 5 | **复制 / 重新生成按钮** | 消息气泡无任何操作。实施：hover 显示 Copy（`navigator.clipboard`）/ 重新生成（取该条对应的 user 消息重发） |
| 6 | **思考过程被丢弃** | `parseSSEDelta` 已解析 `reasoning_content` 并回调 `onText(_, {type:'reasoning'})`，Panel 只处理 text。实施：消息内可折叠的“思考过程”区（默认收起），流式期间逐字追加 |
| 7 | **选区/光标上下文是假的** | `buildAgentContext` 注释声称提供 "Selected text / cursor position"，实际未读取编辑器选区；“续写—基于光标位置”“改写—优化选中的段落”是空头支票。实施：从编辑器组件取 selection/range 写入 context；无选区时“改写”按钮置灰或改为“全文改写” |
| 8 | **Diff 算法朴素** | `DiffViewer` 按 index 逐行对比，头部插入一行 → 全红全绿。实施：换 LCS/Myers 算法（自实现 ~60 行或引入 `diff` 库）；多编辑块增加“全部应用”批量按钮 |
| 9 | **分镜建议是死代码** | store 有 `addStoryboardSuggestion`、UI 有 `SuggestionCard`，全仓库无调用方；“分镜建议”快捷按钮只是把四个字填进输入框。实施：要么在 agent 协议中增加分镜建议块并接线，要么删除组件与 store action（与 `STORYBOARD_REFACTOR_PLAN.md` 的拆镜重构对齐，倾向后者由分镜表模块承接） |
| 10 | **会话内无模型切换** | 固定走 `script_analysis` 功能绑定。实施：头部下拉列出该功能绑定的 `models` 数组，选择后 `modelOverride` 传入 |

---

## 4. P2 —— 进阶能力（差异化）

- **Agent 新建文件**：协议目前要求 `filePath 必须来自上下文中列出的文件 path`，Agent 不能新建文件。可增加 `<<<CREATE>>>` 块或放开新路径白名单（限工作区内、校验 `isSafeRelativePath`）
- **图片参考**：参考文件仅收文本扩展名（md/txt/json/csv/yaml）；应用已有 `image_understanding`（Gemini）能力，可让剧本场景配图进上下文
- **应用编辑后无撤销**：`applyAgentEdit` 直接 `writeFile` 落盘，无 VS Code 式 checkpoint/回滚。实施：应用前保存快照到消息 diff 对象，支持“撤销本次写入”
- **会话搜索**：历史聊天仅下拉列表，无关键词搜索
- **建议 chips**：回复结束后提供“继续优化 / 生成分镜 / 导入蓝图”等后续动作建议

---

## 5. 顺带发现的 bug

1. `applyAgentEdit` 状态顺序耦合脆弱：`writeFile`（落盘）→ `applyDiff`（置 `isDirty: true`）→ `markFileSaved`（置回 false），任一步失败留下不一致状态
2. 生成中点“清空当前聊天”无确认；清空后流式回调仍写旧消息 ID（`updateAgentMessage` 静默 no-op，用户看到消息凭空消失）。实施：`isAgentThinking` 时禁用清空或先中止生成

---

## 6. 实施顺序

```text
第一批（高频痛点）: ①停止生成+AbortSignal ②Markdown渲染 ③智能滚动 ④上下文预算裁剪
第二批（补齐体验）: ⑤复制/重新生成 ⑥选区/光标上下文 ⑦LCS diff ⑧分镜建议接线或移除
第三批（差异化）  : 新建文件、图片参考、checkpoint 撤销、会话搜索、模型切换
```

### 验收标准

- 每批完成后：`npm run typecheck` 通过、`npm run test` 全绿（当前基线 40 文件 / 586 测试）
- 第一批新增测试：中止传播（signal 到 fetch）、上下文预算裁剪（超限文件降级摘要）
- 第二批新增测试：LCS diff 用例（头部插入仅 1 增行）、选区上下文构建
- 手工验收：长回复期间上滚不跳、点停止立即停、Markdown 正常渲染

---

## 7. 涉及文件清单

| 文件 | 改动 |
|------|------|
| `src/components/script-workspace/ScriptAgentPanel.tsx` | P0 全部 + P1 ⑤⑥⑦ UI |
| `src/lib/ai/feature-router.ts` | `callFeatureAPIStream` 透传 signal |
| `src/lib/ai/chat-stream.ts` | （已支持 signal，复核 retry 期间的中止语义） |
| `src/lib/script-workspace/agent-protocol.ts` | P2 新建文件协议 / 分镜建议块（可选） |
| `src/stores/script-workspace-store.ts` | 快照撤销、清空守卫、模型选择 |
| `package.json` | 新增 `react-markdown`、`remark-gfm`（+ 可选 `diff`） |
