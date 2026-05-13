<p align="center">
  <img src="build/icon.png" width="120" alt="魔因漫创 Logo" />
</p>
<h1 align="center">魔因漫创 Moyin Creator</h1>

<p align="center">
  <strong>🎬 AI 影视生产级工具 · 剧本到成片全流程批量化</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License" /></a>
  <a href="https://github.com/MemeCalculate/moyin-creator/releases"><img src="https://img.shields.io/github/v/release/MemeCalculate/moyin-creator" alt="Release" /></a>
  <a href="https://github.com/MemeCalculate/moyin-creator/stargazers"><img src="https://img.shields.io/github/stars/MemeCalculate/moyin-creator" alt="Stars" /></a>
</p>

<p align="center">
  <strong>🇨🇳 中文</strong> | <a href="README_EN.md">🇬🇧 English</a>
</p>

<p align="center">
  <a href="docs/WORKFLOW_GUIDE.md"><strong>📖 工作流教程</strong></a> •
  <a href="#功能特性">功能特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#技术架构">技术架构</a> •
  <a href="#许可证">许可证</a> •
  <a href="#贡献">贡献</a>
</p>

---

![1771428968476_3nkjdd](https://github.com/user-attachments/assets/582ee70f-f0dc-433b-9d5c-2ddb8f463450)

## 简介

**魔因漫创** 是一款面向 AI 影视创作者的桌面端生产工具，覆盖从剧本到成片的完整创作链路：

> **📝 剧本 → 🎭 角色 → 🌄 场景 → 🎬 导演 → ⭐ S级 → 📤 导出**

每一步的产出自动流入下一步，支持多种主流 AI 大模型（DeepSeek、GLM、Gemini、Kimi、Qwen、MiniMax 等），适合短剧、动漫番剧、预告片等场景的批量化生产。

基础设置教程：https://www.bilibili.com/video/BV1FsZDBHExJ/?vd_source=802462c0708e775ce81f95b2e486f175

## 功能特性

### 📝 剧本解析

- 智能拆解剧本为场景、分镜、对白
- 自动识别角色、场景、情绪、镜头语言
- 支持多集/多幕剧本结构
- AI 剧本校准：集标题、角色关系、场景描述自动优化
- 预告片模式：自动筛选关键镜头生成高光集锦
- 项目元数据提取（演员表、阵营、命名实体）

### 🎭 角色一致性系统

- AI 角色图生成（文字描述 → 角色形象）
- **多视角联合生成**：正面、侧面、背面、四分之三角度一次出图
- **换装系统**：同一角色多套服装/状态变体，保持面部一致
- **年龄阶段**：支持同角色不同年龄段变体
- 角色圣经管理（性别、年龄、性格、技能、外貌、关系等）
- 参考图绑定，负向提示词排除
- 角色库支持嵌套文件夹组织，可跨项目共享

### 🌄 场景生成

- AI 场景图生成（描述 → 视觉化）
- 多视角联合图生成
- 场景描述到视觉提示词的自动转换
- 场景校准与自动标签
- 场景库管理，支持跨项目共享

### 🎞️ 分镜表

- 专业表格式分镜编辑器
- 逐镜头属性编辑：景别、时长、场景/角色选择器
- 首帧图 + 尾帧图生成
- 提示词编辑与优化
- 参考图选择与上传

### 🎬 导演板块

- 剧本文本或分镜图输入，AI 自动拆分场景
- 逐镜头专业摄影参数：
  - 景别（特写、中景、全景、远景）
  - 灯光控制（风格、方向、色温）
  - 景深、机位运动、运动速度
  - 情绪标签、音效标签、氛围效果
- 多场景合并为连贯叙事视频
- 视频生成进度追踪

### ⭐ S级板块 — 多模态叙事视频

- 复用导演板块的分镜数据，分组合并生成叙事视频
- 支持 @Image / @Video / @Audio 多模态引用
- 智能提示词构建：动作 + 镜头语言 + 对白唇形同步三层融合
- 首帧图网格拼接（N×N 策略）
- 自动分组与手动分组
- 组级别提示词校准与参考管理

### 🎨 自由创作工作台

三个独立工作室，支持脱离剧本流程的自由创作：

- **图片工作室**：文生图，支持模型选择、宽高比、负向提示词、参考图（最多 10 张）
- **视频工作室**：视频生成，支持多种上传角色（单图、首帧、尾帧、参考），时长与宽高比设置，实时进度反馈
- **影院工作室**：高级多模态视频合成，摄影机控制，多参考素材组合

### 📦 资产管理

- **视觉风格库**：预设风格浏览 + 自定义风格创建编辑
- **道具库**：可复用道具素材管理
- **火山引擎素材资产**：V4 签名上传，素材组关联，持久化存储
- **素材库**：图片/视频/音频分类管理，嵌套文件夹，搜索过滤

### 📤 导出

- 时间线可视化预览
- 生成进度统计（图片/视频完成度）
- 导出到文件夹 / 单文件导出 / 批量导出
- 支持剧本流程和导演流程两种工作流导出

### 🤖 多供应商 AI 调度

- 基于功能的智能路由：每项 AI 能力可独立绑定供应商和模型
- 支持多个 API Key 轮询负载均衡
- 双约束批处理引擎（输入/输出 token 限制）
- 故障隔离：失败批次不影响其他任务
- 指数退避自动重试
- 模型限制三层查找：持久缓存 → 静态注册表 → 保守默认值
- 从 API 错误中自动学习模型参数限制

### ⚙️ 设置与调试

- API 供应商配置（添加/编辑/删除）
- API Key 管理（掩码显示、多 Key 轮询）
- 功能绑定：将 AI 能力映射到指定供应商和模型
- 跨项目资源共享控制
- API 调试面板：请求构造与响应检查


## 快速开始

### 环境要求

- **Node.js** >= 18
- **npm** >= 9

### 安装运行

```bash
# 克隆仓库
git clone https://github.com/MemeCalculate/moyin-creator.git
cd moyin-creator

# 安装依赖
npm install

# 启动开发模式
npm run dev
```

### 配置 API Key

启动后，进入 **设置 → API 配置**，填入你的 AI 服务商 API Key 即可开始使用。

### 构建

```bash
# 编译 + 打包 Windows 安装程序
npm run build

# 仅编译（不打包）
npx electron-vite build
```

## 技术架构

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 30 |
| 前端框架 | React 18 + TypeScript |
| 构建工具 | electron-vite (Vite 5) |
| 状态管理 | Zustand 5 |
| UI 组件 | Radix UI + Tailwind CSS 4 |
| AI 核心 | `@opencut/ai-core`（提示词编译、角色圣经、任务轮询） |

### 项目结构

```
moyin-creator/
├── electron/              # Electron 主进程 + Preload
│   ├── main.ts            # 主进程（存储管理、文件系统、协议处理）
│   └── preload.ts         # 安全桥接层
├── src/
│   ├── components/        # React UI 组件
│   │   ├── panels/        # 主面板（剧本、角色、场景、分镜、导演）
│   │   └── ui/            # 基础 UI 组件库
│   ├── stores/            # Zustand 全局状态
│   ├── lib/               # 工具库（AI 调度、图片管理、路由）
│   ├── packages/          # 内部包
│   │   └── ai-core/       # AI 核心引擎
│   └── types/             # TypeScript 类型定义
├── build/                 # 构建资源（图标）
└── scripts/               # 工具脚本
```

## 许可证

本项目采用 **双重许可** 模式：

### 开源使用 — AGPL-3.0

本项目以 [GNU AGPL-3.0](LICENSE) 许可证开源。你可以自由使用、修改和分发，但修改后的代码必须以相同许可证开源。

### 商业使用

如果你需要闭源使用或集成到商业产品中，请联系我们获取 [商业许可](COMMERCIAL_LICENSE.md)。

## 贡献

欢迎贡献！请阅读 [贡献指南](CONTRIBUTING.md) 了解详情。

## 联系

- 📧 Email: [memecalculate@gmail.com](mailto:memecalculate@gmail.com)
- 🐙 GitHub: [https://github.com/MemeCalculate/moyin-creator](https://github.com/MemeCalculate/moyin-creator)


---

<p align="center">Made with ❤️ by <a href="https://github.com/MemeCalculate">MemeCalculate</a></p>

















