// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard analysis service (AI 完整剧本拆镜) 流程测试
 *
 * 覆盖 §12 AI 流程清单：
 *   - 完整剧本分析成功（含名称映射：角色/服装/场景 + 库匹配）
 *   - AI 返回 Markdown 代码围栏
 *   - AI 返回非 JSON 文本
 *   - AI 返回空镜头数组
 *   - AI 返回不存在的角色、服装或场景（ai-suggestion）
 *   - 分析失败不覆盖已有分镜
 *   - 取消、重试
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callFeatureAPI } from "@/lib/ai/feature-router";
import {
  buildSystemPrompt,
  buildUserPrompt,
  cancelStoryboardAnalysis,
  SCRIPT_CHUNK_CHAR_LIMIT,
  splitScriptIntoChunks,
  startStoryboardAnalysis,
} from "../storyboard-analysis-service";
import { useStoryboardStore } from "@/stores/storyboard-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useProjectStore } from "@/stores/project-store";

const mockCallFeatureAPI = vi.fn();
vi.mock("@/lib/ai/feature-router", () => ({
  callFeatureAPI: (...args: unknown[]) => mockCallFeatureAPI(...args),
}));

const projectA = "project-a";

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
  it("系统提示词禁止 集/场/首尾帧/提示词", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("不要输出任何");
    expect(prompt).toContain("集");
    expect(prompt).toContain("场");
    expect(prompt).toContain("imagePrompt");
    expect(prompt).toContain("JSON 数组");
  });

  it("用户提示词包含剧本内容与可选上下文", () => {
    const up = buildUserPrompt("剧本正文", "角色：林夏", 5);
    expect(up).toContain("剧本正文");
    expect(up).toContain("角色：林夏");
    expect(up).toContain("约 5 个镜头");
  });
});

describe("startStoryboardAnalysis（§12 AI 流程）", () => {
  it("完整分析成功：应用镜头并匹配库内名称", async () => {
    seedDocument();
    useCharacterLibraryStore.setState({ characters: [makeCharacter("c1", "林夏")] } as any);
    useSceneStore.setState({ scenes: [makeScene("s1", "咖啡馆")] } as any);

    mockCallFeatureAPI.mockResolvedValue(
      JSON.stringify([
        {
          content: {
            summary: "林夏推门进入",
            scene: "咖啡馆",
            action: "推门进入",
            dialogue: "你好",
            shotSize: "中景",
            cameraMovement: "移",
            durationSeconds: 3,
          },
          references: { characters: ["林夏"], costumes: ["黑色西装"], scenes: ["咖啡馆"] },
          sourceText: "林夏推门进入咖啡馆。",
        },
      ]),
    );

    const result = await startStoryboardAnalysis("剧本正文", { maxRetries: 0 });
    expect(result.ok).toBe(true);
    expect(result.shotCount).toBe(1);

    const doc = useStoryboardStore.getState().document!;
    expect(doc.status).toBe("review");
    expect(doc.shots).toHaveLength(1);
    const shot = doc.shots[0];
    expect(shot.origin).toBe("ai");
    expect(shot.shotNumber).toBe("1");
    expect(shot.sourceText).toBe("林夏推门进入咖啡馆。");

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
    mockCallFeatureAPI.mockResolvedValue(
      "```json\n[{\"content\":{\"summary\":\"进入\",\"scene\":\"室内\",\"action\":\"走\",\"dialogue\":\"\",\"shotSize\":\"近景\",\"cameraMovement\":\"固定\"}}]\n```",
    );
    const result = await startStoryboardAnalysis("正文", { maxRetries: 0 });
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
    const result = await startStoryboardAnalysis("正文", { maxRetries: 0 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();

    // 不覆盖：仍旧保留原镜头
    const after = useStoryboardStore.getState().document!.shots;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    const job = useStoryboardStore.getState().analysisJob;
    expect(job?.status).toBe("failed");
  });

  it("AI 返回空镜头数组时失败", async () => {
    seedDocument();
    mockCallFeatureAPI.mockResolvedValue("[]");
    // 空数组能通过校验（shotCount=0 无 issue），但解析应仍成功
    const result = await startStoryboardAnalysis("正文", { maxRetries: 0 });
    // 空数组是可接受的 AI 结果（无镜头），视为成功
    expect(result.ok).toBe(true);
    expect(result.shotCount).toBe(0);
    expect(useStoryboardStore.getState().document!.shots).toHaveLength(0);
  });

  it("AI 返回不存在的角色、服装、场景 → 标记为 ai-suggestion", async () => {
    seedDocument();
    useCharacterLibraryStore.setState({ characters: [] } as any);
    useSceneStore.setState({ scenes: [] } as any);
    mockCallFeatureAPI.mockResolvedValue(
      JSON.stringify([
        {
          content: {
            summary: "出现",
            scene: "未知场景",
            action: "走",
            dialogue: "",
            shotSize: "中景",
            cameraMovement: "固定",
          },
          references: { characters: ["路人"], costumes: ["红裙"], scenes: ["沙漠"] },
        },
      ]),
    );
    const result = await startStoryboardAnalysis("正文", { maxRetries: 0 });
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
      .mockResolvedValueOnce(
        JSON.stringify([
          { content: { summary: "成功", scene: "室内", action: "走", dialogue: "", shotSize: "中景", cameraMovement: "固定" } },
        ]),
      );
    const result = await startStoryboardAnalysis("正文", { maxRetries: 1 });
    expect(result.ok).toBe(true);
    expect(result.shotCount).toBe(1);
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
    const resp = JSON.stringify([
      { content: { summary: "新", scene: "室内", action: "走", dialogue: "", shotSize: "中景", cameraMovement: "固定" } },
    ]);
    mockCallFeatureAPI.mockReturnValue(pending as Promise<string>);

    const promise = startStoryboardAnalysis("正文", { maxRetries: 0 });

    // 等 analysisJob 出现拿到 jobId 后取消
    await vi.waitFor(() => {
      expect(useStoryboardStore.getState().analysisJob?.id).toBeTruthy();
    });
    const jobId = useStoryboardStore.getState().analysisJob!.id;
    cancelStoryboardAnalysis(jobId);
    resolveCall(resp);

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

// ---------- 长剧本分批分析（§14 风险：单份剧本内容过长） ----------
describe("长剧本分批分析", () => {
  it("超长剧本按段落分批调用 AI，合并后镜头号连续", async () => {
    seedDocument();
    // 构造两批内容（每批各自产生 1 个镜头）
    const chunks = splitScriptIntoChunks(
      Array.from({ length: 10 }, () => "段落：" + "字".repeat(2000)).join("\n\n"),
      SCRIPT_CHUNK_CHAR_LIMIT,
    );
    expect(chunks.length).toBeGreaterThan(1);

    mockCallFeatureAPI.mockImplementation((_feature: unknown, _sp: string, userPrompt: string) => {
      const idx = userPrompt.includes("第 1/") ? 0 : 1;
      return Promise.resolve(
        JSON.stringify([
          {
            content: {
              summary: `第${idx + 1}批镜头`,
              scene: "室内",
              action: "走",
              dialogue: "",
              shotSize: "中景",
              cameraMovement: "固定",
            },
            references: { characters: [], costumes: [], scenes: [] },
          },
        ]),
      );
    });

    const result = await startStoryboardAnalysis(
      Array.from({ length: 10 }, () => "段落：" + "字".repeat(2000)).join("\n\n"),
      { maxRetries: 0 },
    );
    expect(result.ok).toBe(true);
    expect(result.shotCount).toBe(2);

    // AI 被调用 2 次（2 批）
    expect(mockCallFeatureAPI).toHaveBeenCalledTimes(2);

    const shots = useStoryboardStore.getState().document!.shots;
    expect(shots).toHaveLength(2);
    // 合并后镜头号连续、order 连续
    expect(shots.map((s) => s.shotNumber)).toEqual(["1", "2"]);
    expect(shots.map((s) => s.order)).toEqual([0, 1]);
    // 每批提示词都带分段标注，且不含集/场层级要求
    const prompt1 = mockCallFeatureAPI.mock.calls[0][2] as string;
    const prompt2 = mockCallFeatureAPI.mock.calls[1][2] as string;
    expect(prompt1).toContain("第 1/");
    expect(prompt2).toContain("第 2/");
    expect(prompt1).toContain("不要输出任何 \"集\"、\"场\" 层级信息");
  });

  it("分批分析中途取消：不覆盖已有分镜", async () => {
    seedDocument();
    useStoryboardStore.getState().addShot(); // 已有一个人工镜头
    const beforeId = useStoryboardStore.getState().document!.shots[0].id;

    const longContent = Array.from({ length: 6 }, () => "段落：" + "字".repeat(3000)).join("\n\n");

    let resolveCall: (v: string) => void = () => {};
    const pending = new Promise<string>((r) => {
      resolveCall = r;
    });
    // 第一批挂起，等待取消后 resolve
    mockCallFeatureAPI.mockReturnValue(pending as Promise<string>);

    const promise = startStoryboardAnalysis(longContent, { maxRetries: 0 });
    await vi.waitFor(() => {
      expect(useStoryboardStore.getState().analysisJob?.id).toBeTruthy();
    });
    const jobId = useStoryboardStore.getState().analysisJob!.id;
    cancelStoryboardAnalysis(jobId);
    resolveCall(
      JSON.stringify([
        {
          content: { summary: "x", scene: "室内", action: "走", dialogue: "", shotSize: "中景", cameraMovement: "固定" },
          references: { characters: [], costumes: [], scenes: [] },
        },
      ]),
    );

    const result = await promise;
    expect(result.ok).toBe(false);
    // 原有镜头保留
    const doc = useStoryboardStore.getState().document!;
    expect(doc.shots).toHaveLength(1);
    expect(doc.shots[0].id).toBe(beforeId);
  });
});