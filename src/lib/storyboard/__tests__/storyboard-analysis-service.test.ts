// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard analysis service (AI 完整剧本拆镜) 流程测试
 *
 * 覆盖阶段 3 链路：
 *   - 完整剧本分析成功（含名称映射：角色/服装/场景 + 库匹配）
 *   - AI 返回 Markdown 代码围栏
 *   - AI 返回非 JSON 文本
 *   - 非空剧本返回空镜头数组 → 失败（源覆盖审计拦截）
 *   - AI 返回不存在的角色、服装或场景（ai-suggestion）
 *   - 分析失败不覆盖已有分镜
 *   - 取消、重试、定向修复
 *   - 六类语法解析、源单元提取、覆盖审计、事件组分批
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callFeatureAPI } from "@/lib/ai/feature-router";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildBatchUserPrompt,
  cancelStoryboardAnalysis,
  SCRIPT_CHUNK_CHAR_LIMIT,
  splitScriptIntoChunks,
  startStoryboardAnalysis,
  batchSourceUnits,
} from "../storyboard-analysis-service";
import { parseScriptSyntax } from "../script-syntax-parser";
import { extractSourceUnits } from "../storyboard-visual-events";
import { auditSourceCoverage } from "../storyboard-coverage-audit";
import { useStoryboardStore } from "@/stores/storyboard-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useProjectStore } from "@/stores/project-store";

const mockCallFeatureAPI = vi.fn();
vi.mock("@/lib/ai/feature-router", () => ({
  callFeatureAPI: (...args: unknown[]) => mockCallFeatureAPI(...args),
}));

const projectA = "project-a";

/** 从批次用户提示中提取本批源单元 ID（形如 `- [id] (kind) text`）。 */
function unitIdsIn(prompt: string): string[] {
  const ids: string[] = [];
  const re = /- \[([^\]]+)\] \(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) ids.push(m[1]);
  return ids;
}

/** 构造一份覆盖提示词内全部源单元的镜头响应。 */
function responseCovering(userPrompt: string): string {
  const ids = unitIdsIn(userPrompt);
  return JSON.stringify([
    {
      content: {
        scene: "咖啡馆",
        action: "推门进入",
        dialogue: "你好",
        shotSize: "中景",
        cameraMovement: "固定",
        durationSeconds: 3,
      },
      references: { characters: ["林夏"], costumes: ["黑色西装"], scenes: ["咖啡馆"] },
      sourceUnitIds: ids,
      sourceRanges: [],
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ activeProjectId: projectA });
  useStoryboardStore.setState({
    document: null,
    selectedShotId: null,
    selectedShotIds: [],
    analysisJob: null,
    importDialogOpen: false,
    dirty: false,
  });
  useCharacterLibraryStore.setState({ characters: [] });
  useSceneStore.setState({ scenes: [] });
});

function seedDocument() {
  useStoryboardStore.getState().initDocument({ title: "食堂初遇" });
}

function makeCharacter(id: string, name: string) {
  return {
    id,
    name,
    description: "",
    visualTraits: "",
    views: [],
    variations: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeScene(id: string, name: string) {
  return {
    id,
    name,
    location: "",
    time: "",
    atmosphere: "",
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("buildSystemPrompt / buildUserPrompt", () => {
  it("系统提示词禁止 集/场/首尾帧/提示词，且不设固定镜头配额", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("不要输出任何");
    expect(prompt).toContain("集");
    expect(prompt).toContain("场");
    expect(prompt).toContain("imagePrompt");
    expect(prompt).toContain("JSON 数组");
    // 阶段 3：不设固定数量
    expect(prompt).toContain("不设固定配额");
    expect(prompt).not.toContain("最多输出 8 个镜头");
    // 视觉事件链规则
    expect(prompt).toContain("建立");
    expect(prompt).toContain("sourceUnitIds");
  });

  it("用户提示词包含剧本内容与可选上下文", () => {
    const up = buildUserPrompt("剧本正文", "角色：林夏", 5);
    expect(up).toContain("剧本正文");
    expect(up).toContain("角色：林夏");
    expect(up).toContain("约 5 个镜头");
  });
});

describe("startStoryboardAnalysis（阶段 3 AI 流程）", () => {
  it("完整分析成功：应用镜头并匹配库内名称", async () => {
    seedDocument();
    useCharacterLibraryStore.setState({ characters: [makeCharacter("c1", "林夏")] } as any);
    useSceneStore.setState({ scenes: [makeScene("s1", "咖啡馆")] } as any);

    mockCallFeatureAPI.mockImplementation((_f: unknown, _s: string, userPrompt: string) =>
      Promise.resolve(responseCovering(userPrompt)),
    );

    const result = await startStoryboardAnalysis("△ 林夏推门进入咖啡馆。", { maxRetries: 0 });
    expect(result.ok).toBe(true);
    expect(result.shotCount).toBe(1);

    const doc = useStoryboardStore.getState().document!;
    expect(doc.status).toBe("review");
    expect(doc.shots).toHaveLength(1);
    const shot = doc.shots[0];
    expect(shot.origin).toBe("ai");
    expect(shot.shotNumber).toBe("1");

    // 角色命中库 → library
    expect(shot.references.characters[0]).toMatchObject({ name: "林夏", source: "library" });
    // 场景命中库 → library
    expect(shot.references.scenes[0]).toMatchObject({ name: "咖啡馆", source: "library" });
    // 服装无库 → ai-suggestion
    expect(shot.references.costumes[0]).toMatchObject({ name: "黑色西装", source: "ai-suggestion" });

    const job = useStoryboardStore.getState().analysisJob;
    expect(job?.status).toBe("succeeded");
    expect(job?.progress).toBe(100);
  });

  it("处理 AI 返回 Markdown 代码围栏", async () => {
    seedDocument();
    mockCallFeatureAPI.mockImplementation((_f: unknown, _s: string, userPrompt: string) => {
      const ids = unitIdsIn(userPrompt);
      return Promise.resolve(
        "```json\n" +
          JSON.stringify([
            {
              content: { scene: "室内", action: "走", dialogue: "", shotSize: "近景", cameraMovement: "固定" },
              sourceUnitIds: ids,
            },
          ]) +
          "\n```",
      );
    });
    const result = await startStoryboardAnalysis("△ 走。", { maxRetries: 0 });
    expect(result.ok).toBe(true);
    expect(useStoryboardStore.getState().document!.shots).toHaveLength(1);
  });

  it("AI 返回非 JSON 文本时失败且不覆盖已有分镜", async () => {
    seedDocument();
    // 先有一个人工镜头
    useStoryboardStore.getState().addShot();
    const before = useStoryboardStore.getState().document!.shots;
    expect(before).toHaveLength(1);

    mockCallFeatureAPI.mockResolvedValue("抱歉，无法完成。");
    const result = await startStoryboardAnalysis("△ 走。", { maxRetries: 0 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();

    // 不覆盖：仍旧保留原镜头
    const after = useStoryboardStore.getState().document!.shots;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    const job = useStoryboardStore.getState().analysisJob;
    expect(job?.status).toBe("failed");
  });

  it("非空剧本返回空镜头数组时失败（源覆盖审计拦截）", async () => {
    seedDocument();
    mockCallFeatureAPI.mockResolvedValue("[]");
    const result = await startStoryboardAnalysis("△ 走。", { maxRetries: 0 });
    // 非空可拍摄输入不得返回空结果 → 审计失败，修复耗尽仍失败
    expect(result.ok).toBe(false);
    expect(result.error).toContain("覆盖审计失败");
    expect(useStoryboardStore.getState().document!.shots).toHaveLength(0);
    const job = useStoryboardStore.getState().analysisJob;
    expect(job?.status).toBe("failed");
  });

  it("AI 返回不存在的角色、服装、场景 → 标记为 ai-suggestion", async () => {
    seedDocument();
    useCharacterLibraryStore.setState({ characters: [] } as any);
    useSceneStore.setState({ scenes: [] } as any);
    mockCallFeatureAPI.mockImplementation((_f: unknown, _s: string, userPrompt: string) => {
      const ids = unitIdsIn(userPrompt);
      return Promise.resolve(
        JSON.stringify([
          {
            content: { scene: "未知场景", action: "走", dialogue: "", shotSize: "中景", cameraMovement: "固定" },
            references: { characters: ["路人"], costumes: ["红裙"], scenes: ["沙漠"] },
            sourceUnitIds: ids,
          },
        ]),
      );
    });
    const result = await startStoryboardAnalysis("△ 走。", { maxRetries: 0 });
    expect(result.ok).toBe(true);
    const shot = useStoryboardStore.getState().document!.shots[0];
    expect(shot.references.characters[0].source).toBe("ai-suggestion");
    expect(shot.references.costumes[0].source).toBe("ai-suggestion");
    expect(shot.references.scenes[0].source).toBe("ai-suggestion");
  });

  it("解析失败后按 maxRetries 重试，最终成功", async () => {
    seedDocument();
    mockCallFeatureAPI
      .mockResolvedValueOnce("not json")
      .mockImplementationOnce((_f: unknown, _s: string, userPrompt: string) =>
        Promise.resolve(responseCovering(userPrompt)),
      );
    const result = await startStoryboardAnalysis("△ 走。", { maxRetries: 1 });
    expect(result.ok).toBe(true);
    expect(result.shotCount).toBe(1);
    expect(mockCallFeatureAPI).toHaveBeenCalledTimes(2);
  });

  it("遗漏末尾事件时定向修复补齐，最终成功", async () => {
    seedDocument();
    // 脚本含两个动作单元 → 首批响应只覆盖第一个（漏掉末尾单元）
    mockCallFeatureAPI.mockImplementationOnce((_f: unknown, _s: string, userPrompt: string) => {
      const ids = unitIdsIn(userPrompt);
      return Promise.resolve(
        JSON.stringify([
          {
            content: { scene: "室内", action: "起立", dialogue: "", shotSize: "中景", cameraMovement: "固定" },
            sourceUnitIds: ids.slice(0, 1),
          },
        ]),
      );
    })
      // 修复调用：补齐缺失单元
      .mockImplementationOnce((_f: unknown, _s: string, userPrompt: string) => {
        const ids = unitIdsIn(userPrompt);
        return Promise.resolve(
          JSON.stringify([
            {
              content: { scene: "室内", action: "走到门口", dialogue: "", shotSize: "近景", cameraMovement: "固定" },
              sourceUnitIds: ids,
            },
          ]),
        );
      });

    const result = await startStoryboardAnalysis("△ 他起立。\n△ 他走到门口。", { maxRetries: 0 });
    expect(result.ok).toBe(true);
    expect(result.shotCount).toBe(2);
    expect(mockCallFeatureAPI).toHaveBeenCalledTimes(2);
  });

  it("取消时返回失败并恢复快照", async () => {
    seedDocument();
    useStoryboardStore.getState().addShot();
    const beforeId = useStoryboardStore.getState().document!.shots[0].id;

    // 用 deferred 挂起 AI 调用：在调用真正返回前取消。
    let resolveCall: (v: string) => void = () => {};
    const pending = new Promise<string>((r) => {
      resolveCall = r;
    });
    mockCallFeatureAPI.mockReturnValue(pending as Promise<string>);

    const promise = startStoryboardAnalysis("△ 走。", { maxRetries: 0 });

    // 等 analysisJob 出现拿到 jobId 后取消
    await vi.waitFor(() => {
      expect(useStoryboardStore.getState().analysisJob?.id).toBeTruthy();
    });
    const jobId = useStoryboardStore.getState().analysisJob!.id;
    cancelStoryboardAnalysis(jobId);
    resolveCall("[]");

    const result = await promise;
    // 取消 → 失败
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    const job = useStoryboardStore.getState().analysisJob;
    expect(job?.status).toBe("cancelled");

    // 不覆盖已有分镜
    const doc = useStoryboardStore.getState().document!;
    const kept = doc.shots.find((s) => s.id === beforeId);
    expect(kept).toBeTruthy();
    expect(doc.shots).toHaveLength(1);
  });
});

// ---------- splitScriptIntoChunks（§14 风险：单份剧本内容过长） ----------
describe("splitScriptIntoChunks", () => {
  it("空内容返回空数组", () => {
    expect(splitScriptIntoChunks("")).toEqual([]);
    expect(splitScriptIntoChunks("   \n\n ")).toEqual([]);
  });

  it("短内容（≤limit）返回单块", () => {
    const content = "第一段。\n\n第二段。";
    expect(splitScriptIntoChunks(content, 1000)).toEqual([content.trim()]);
  });

  it("按空行分段并保持段落完整，不超 limit", () => {
    const para = (n: number) => `第${n}段：` + "字".repeat(200);
    const content = [para(1), para(2), para(3), para(4)].join("\n\n");
    const chunks = splitScriptIntoChunks(content, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(500);
    }
    // 段落不被打断：每一段整体出现在某一个块中
    for (let n = 1; n <= 4; n++) {
      expect(chunks.some((c) => c.includes(para(n)))).toBe(true);
    }
    // 合并所有块，内容完整保留
    expect(chunks.join("\n\n").replace(/\s+/g, "")).toBe(content.replace(/\s+/g, ""));
  });

  it("单个超长段落硬切", () => {
    const longPara = "长段：" + "字".repeat(1000);
    const chunks = splitScriptIntoChunks(longPara, 300);
    expect(chunks.length).toBe(Math.ceil(1003 / 300)); // 段首 3 字符 + 1000 字
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(300);
    }
    expect(chunks.join("")).toBe(longPara);
  });

  it("混合场景：普通段落 + 超长段落", () => {
    const a = "短段甲。";
    const b = "超长段：" + "字".repeat(600);
    const c = "短段乙。";
    const content = [a, b, c].join("\n\n");
    const chunks = splitScriptIntoChunks(content, 200);
    // 短段甲作为独立块，超长段被硬切成 4 块（604/200 向上取整），短段乙独立
    expect(chunks.length).toBe(6);
    expect(chunks[0]).toBe(a);
    expect(chunks[1]).toBe(b.slice(0, 200));
    expect(chunks[5]).toBe(c);
    expect(chunks.join("")).toBe(a + b + c);
  });
});

// ---------- 多场次分批 + 预算缩批（阶段 3 事件组分批） ----------
describe("事件组分批分析", () => {
  it("多场次剧本按场次硬边界分批，AI 逐批调用", async () => {
    seedDocument();
    const script = [
      "## 场次：白天 / 内 / 咖啡馆",
      "△ 林夏推门进入。",
      "## 场次：夜晚 / 外 / 街道",
      "△ 林夏奔跑。",
    ].join("\n");

    mockCallFeatureAPI.mockImplementation((_f: unknown, _s: string, userPrompt: string) =>
      Promise.resolve(responseCovering(userPrompt)),
    );

    const result = await startStoryboardAnalysis(script, { maxRetries: 0 });
    expect(result.ok).toBe(true);
    // 两场 → 两批 → 两次 AI 调用
    expect(mockCallFeatureAPI).toHaveBeenCalledTimes(2);
    expect(result.shotCount).toBe(2);

    const shots = useStoryboardStore.getState().document!.shots;
    expect(shots.map((s) => s.shotNumber)).toEqual(["1", "2"]);
    expect(shots.map((s) => s.order)).toEqual([0, 1]);
  });

  it("第二批对白返回单元内相对范围时可规范化并通过审计", async () => {
    seedDocument();
    const script = [
      "# 标题",
      "**大纲：**",
      "这是故事简介。",
      "## 场次：日 / 外 / 郊外",
      "△ 洛蓝抬手。",
      "**洛蓝**（画外音）：",
      "探魂术",
      "## 场次：日 / 内 / 意识海",
      "△ 红袍人影转身。",
      "**红袍人影**（英语，多重混响）：",
      "Bring down the vault（毁掉宝库）",
    ].join("\r\n");

    mockCallFeatureAPI.mockImplementation((_f: unknown, _s: string, userPrompt: string) => {
      const ids = unitIdsIn(userPrompt);
      const dialogueMatch = userPrompt.match(/- \[([^\]]+)\] \(dialogue\)/);
      return Promise.resolve(JSON.stringify([
        {
          content: {
            scene: "剧本场景",
            action: "角色说出台词",
            dialogue: "原文对白",
            shotSize: "中景",
            cameraMovement: "固定",
          },
          sourceUnitIds: ids,
          dialogueSlices: dialogueMatch
            ? [{ unitId: dialogueMatch[1], start: 0, end: 3 }]
            : [],
        },
      ]));
    });

    const result = await startStoryboardAnalysis(script, { maxRetries: 0 });
    expect(result.ok).toBe(true);
    expect(mockCallFeatureAPI).toHaveBeenCalledTimes(2);
    expect(result.shotCount).toBe(2);
  });

  it("单场单元数超过上限时预算缩批，合并后镜头号连续", async () => {
    seedDocument();
    // 构造 15 个动作单元（超过 MAX_UNITS_PER_BATCH=12）
    const actions = Array.from({ length: 15 }, (_, i) => `△ 动作${i + 1}。`).join("\n");
    mockCallFeatureAPI.mockImplementation((_f: unknown, _s: string, userPrompt: string) =>
      Promise.resolve(responseCovering(userPrompt)),
    );

    const result = await startStoryboardAnalysis(actions, { maxRetries: 0 });
    expect(result.ok).toBe(true);
    // 15 单元 → 12 + 3 两批
    expect(mockCallFeatureAPI).toHaveBeenCalledTimes(2);

    const shots = useStoryboardStore.getState().document!.shots;
    expect(shots).toHaveLength(2);
    expect(shots.map((s) => s.shotNumber)).toEqual(["1", "2"]);
    expect(shots.map((s) => s.order)).toEqual([0, 1]);
  });

  it("分批分析中途取消：不覆盖已有分镜", async () => {
    seedDocument();
    useStoryboardStore.getState().addShot(); // 已有一个人工镜头
    const beforeId = useStoryboardStore.getState().document!.shots[0].id;

    const script = [
      "## 场次：白天 / 内 / 咖啡馆",
      "△ 林夏推门进入。",
      "## 场次：夜晚 / 外 / 街道",
      "△ 林夏奔跑。",
    ].join("\n");

    let resolveCall: (v: string) => void = () => {};
    const pending = new Promise<string>((r) => {
      resolveCall = r;
    });
    // 第一批挂起，等待取消后 resolve
    mockCallFeatureAPI.mockReturnValue(pending as Promise<string>);

    const promise = startStoryboardAnalysis(script, { maxRetries: 0 });
    await vi.waitFor(() => {
      expect(useStoryboardStore.getState().analysisJob?.id).toBeTruthy();
    });
    const jobId = useStoryboardStore.getState().analysisJob!.id;
    cancelStoryboardAnalysis(jobId);
    resolveCall("[]");

    const result = await promise;
    expect(result.ok).toBe(false);
    // 原有镜头保留
    const doc = useStoryboardStore.getState().document!;
    expect(doc.shots).toHaveLength(1);
    expect(doc.shots[0].id).toBe(beforeId);
  });
});

// ---------- 六类语法解析 + 源单元提取 + 覆盖审计（阶段 3） ----------
describe("六类语法解析与覆盖审计", () => {
  it("解析场次/动作/对白/转场/字幕/注释六类语法", () => {
    const script = [
      "## 场次：白天 / 内 / 咖啡馆",
      "△ 林夏推门进入。",
      "**林夏**：",
      "你好。",
      "（微笑）",
      "【转场：切至下一场】",
      "【字幕：三小时后】",
      "<!-- 注意节奏 -->",
    ].join("\n");

    const parsed = parseScriptSyntax(script);
    expect(parsed.sceneCount).toBe(1);

    const types = parsed.tokens.map((t) => t.token.type);
    expect(types).toContain("scene");
    expect(types).toContain("action");
    expect(types).toContain("dialogue");
    expect(types).toContain("parenthetical");
    expect(types).toContain("transition");
    expect(types).toContain("subtitle");
    expect(types).toContain("comment");
  });

  it("识别加粗角色名后的括号提示，并保留 CRLF 原文偏移", () => {
    const script = [
      "## 场次：日 / 外 / 郊外",
      "△ 洛蓝抬手。",
      "**洛蓝**（画外音，低声）：",
      "探魂术",
    ].join("\r\n");
    const parsed = parseScriptSyntax(script);
    const dialogue = parsed.tokens.find((t) => t.token.type === "dialogue");

    expect(dialogue?.token).toMatchObject({
      type: "dialogue",
      character: "洛蓝",
      cue: "画外音，低声",
      content: "探魂术",
    });
    expect(script.slice(dialogue!.sourceRange.start, dialogue!.sourceRange.end)).toBe(
      "**洛蓝**（画外音，低声）：\r\n探魂术",
    );
  });

  it("首个场次前的标题、大纲和人物小传不生成必需源单元", () => {
    const script = [
      "# 《东方交换生日记》",
      "**大纲：**",
      "东方交换生调查黑巫师踪迹。",
      "**人物小传：**",
      "- 洛蓝：东方交换生。",
      "## 第十四集",
      "## 场次：日 / 外 / 霍格莫德村郊外",
      "△ 洛蓝抬手。",
    ].join("\n");
    const units = extractSourceUnits(parseScriptSyntax(script));

    expect(units.filter((u) => u.required)).toHaveLength(1);
    expect(units[0]).toMatchObject({ kind: "visual-event", content: "洛蓝抬手。" });
  });

  it("HTML 创作注释进入批次约束但不要求生成独立镜头", () => {
    const script = [
      "## 场次：日 / 外 / 郊外",
      "△ 洛蓝抬手。",
      "<!-- 画面中仅出现洛蓝手部动作 -->",
    ].join("\n");
    const units = extractSourceUnits(parseScriptSyntax(script));
    const batches = batchSourceUnits(units);
    const prompt = buildBatchUserPrompt(batches[0].units, script);

    expect(prompt).toContain("本批创作约束");
    expect(prompt).toContain("画面中仅出现洛蓝手部动作");
    expect(unitIdsIn(prompt)).toHaveLength(1);
  });

  it("允许同一复杂动作源单元由多个镜头共同覆盖", () => {
    const script = "△ 洛蓝举杖，闪电出现并击中黑巫师。";
    const units = extractSourceUnits(parseScriptSyntax(script));
    const unitId = units[0].id;
    const drafts = ["举杖", "闪电显现"].map((action) => ({
      content: {
        summary: "",
        scene: "营地",
        action,
        dialogue: "",
        shotSize: "中景",
        cameraMovement: "固定",
      },
      sourceUnitIds: [unitId],
      dialogueSlices: [],
      sourceRanges: [],
    }));

    const audit = auditSourceCoverage(drafts, {
      units,
      batchRange: { start: 0, end: script.length },
    });
    expect(audit.valid).toBe(true);
  });

  it("提取源单元：动作/对白/转场/字幕为必需，注释为非必需，场次不成单元", () => {
    const script = [
      "## 场次：白天 / 内 / 咖啡馆",
      "△ 林夏推门进入。",
      "**林夏**：",
      "你好。",
      "【转场：切至下一场】",
      "【字幕：三小时后】",
      "<!-- 注意节奏 -->",
    ].join("\n");

    const parsed = parseScriptSyntax(script);
    const units = extractSourceUnits(parsed);

    // 场次不生成源单元（SourceUnit 无 scene 种类）
    expect(units.length).toBe(5);
    // 必需单元：action + dialogue + transition + subtitle
    const required = units.filter((u) => u.required);
    expect(required.map((u) => u.kind).sort()).toEqual(
      ["dialogue", "subtitle", "transition", "visual-event"].sort(),
    );
    // 注释为非必需
    const comment = units.find((u) => u.kind === "comment");
    expect(comment).toBeTruthy();
    expect(comment!.required).toBe(false);
  });

  it("覆盖审计：非空输入空镜头 → 失败", () => {
    const script = "△ 走。";
    const parsed = parseScriptSyntax(script);
    const units = extractSourceUnits(parsed);
    const audit = auditSourceCoverage([], { units, batchRange: { start: 0, end: 10 } });
    expect(audit.valid).toBe(false);
    expect(audit.issues[0].type).toBe("empty_result");
  });

  it("覆盖审计：漏掉末尾必需单元 → uncovered_unit", () => {
    const script = "△ 起立。\n△ 走到门口。";
    const parsed = parseScriptSyntax(script);
    const units = extractSourceUnits(parsed);
    const required = units.filter((u) => u.required);

    const drafts = [
      {
        content: { summary: "", scene: "室内", action: "起立", dialogue: "", shotSize: "中景", cameraMovement: "固定" },
        sourceUnitIds: [required[0].id],
        dialogueSlices: [],
        sourceRanges: [],
      },
    ];
    const audit = auditSourceCoverage(drafts, {
      units,
      batchRange: { start: 0, end: script.length },
    });
    expect(audit.valid).toBe(false);
    expect(audit.missingUnitIds).toEqual([required[1].id]);
  });

  it("覆盖审计：未知源 ID → unknown_id", () => {
    const script = "△ 走。";
    const parsed = parseScriptSyntax(script);
    const units = extractSourceUnits(parsed);
    const drafts = [
      {
        content: { summary: "", scene: "室内", action: "走", dialogue: "", shotSize: "中景", cameraMovement: "固定" },
        sourceUnitIds: ["nonexistent"],
        dialogueSlices: [],
        sourceRanges: [],
      },
    ];
    const audit = auditSourceCoverage(drafts, {
      units,
      batchRange: { start: 0, end: script.length },
    });
    expect(audit.valid).toBe(false);
    expect(audit.issues.some((i) => i.type === "unknown_id")).toBe(true);
  });

  it("batchSourceUnits：跨场不合并，超上限缩批", () => {
    const script = [
      "## 场次：白天 / 内 / 咖啡馆",
      ...Array.from({ length: 3 }, (_, i) => `△ 动作${i + 1}。`),
      "## 场次：夜晚 / 外 / 街道",
      ...Array.from({ length: 2 }, (_, i) => `△ 街道动作${i + 1}。`),
    ].join("\n");
    const parsed = parseScriptSyntax(script);
    const units = extractSourceUnits(parsed);
    const batches = batchSourceUnits(units);
    // 两场 → 至少两批
    expect(batches.length).toBe(2);
    // 第一批 3 个单元，第二批 2 个单元
    expect(batches[0].units).toHaveLength(3);
    expect(batches[1].units).toHaveLength(2);
    // 不跨场：批内 sceneId 一致
    for (const b of batches) {
      const sceneIds = new Set(b.units.map((u) => u.sceneId));
      expect(sceneIds.size).toBe(1);
    }
  });
});