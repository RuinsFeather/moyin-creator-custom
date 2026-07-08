"use client";

import { useState, useCallback, useRef } from "react";
import { Play, Copy, Trash2, Loader2, Search, Download, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { corsFetch } from "@/lib/cors-fetch";
import {
  queryFreedomTaskById,
  saveFreedomTaskResultToMedia,
  probeFreedomImageResponse,
  type FreedomTaskQueryRoute,
  type FreedomTaskQueryResult,
  type FreedomImageProbeResult,
} from "@/lib/freedom/freedom-api";
import { useFreedomTaskStore } from "@/stores/freedom-task-store";
import type { PersistedFreedomTask } from "@/stores/freedom-task-store";
import { useProjectStore } from "@/stores/project-store";

/** 单个字符串字段超过此长度即视为「超长内容」（base64 图片/视频数据等），展示时截断 */
const LONG_STRING_LIMIT = 512;
/** 整体展示文本的最大长度上限，避免 DOM 渲染超大文本导致卡死/撕裂 */
const MAX_DISPLAY_LENGTH = 200_000;

/** 从超长字符串里提取可读摘要（保留首尾片段 + 长度），并标注疑似类型 */
function summarizeLongString(value: string): string {
  const len = value.length;
  let kind = "长文本";
  if (/^data:[^;]+;base64,/.test(value)) kind = "DataURL(base64)";
  else if (/^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 128)) && len > 1024) kind = "疑似 base64 数据";
  const head = value.slice(0, 48).replace(/\s+/g, "");
  return `‹${kind} 已省略 · 长度=${len} · 头部="${head}…"›`;
}

/**
 * 递归清洗响应对象：把超长字符串字段替换为摘要，防止 base64 图片数据撑爆 DOM。
 * 返回适合在 <pre> 中安全展示的字符串。
 */
function sanitizeResponseForDisplay(raw: unknown): string {
  const walk = (node: any): any => {
    if (typeof node === "string") {
      return node.length > LONG_STRING_LIMIT ? summarizeLongString(node) : node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  };

  let text: string;
  if (typeof raw === "string") {
    // 纯文本响应：先尝试解析为 JSON，成功则走对象清洗，失败则按纯文本处理
    try {
      text = JSON.stringify(walk(JSON.parse(raw)), null, 2);
    } catch {
      text =
        raw.length > LONG_STRING_LIMIT * 4 ? summarizeLongString(raw) : raw;
    }
  } else {
    try {
      text = JSON.stringify(walk(raw), null, 2);
    } catch {
      text = String(raw);
    }
  }

  if (text.length > MAX_DISPLAY_LENGTH) {
    text =
      text.slice(0, MAX_DISPLAY_LENGTH) +
      `\n\n…（响应过长，已截断，仅展示前 ${MAX_DISPLAY_LENGTH} 字符）`;
  }
  return text;
}

/**
 * Debug 面板：直接使用 JSON 请求体调用模型 API 进行测试。
 * 替代原来的"帮助"外链，方便开发者在应用内快速调试接口。
 */
export function DebugPanel() {
  const [url, setUrl] = useState("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
  const [method, setMethod] = useState("POST");
  const [headers, setHeaders] = useState(
    JSON.stringify({ "Content-Type": "application/json", "Authorization": "Bearer " }, null, 2)
  );
  const [body, setBody] = useState(
    JSON.stringify(
      {
        model: "doubao-seedance-1-0-pro-250528",
        content: [{ type: "text", text: "一只猫在草地上奔跑" }],
      },
      null,
      2
    )
  );
  const [response, setResponse] = useState("");
  const [rawResponse, setRawResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = useCallback(async () => {
    // 验证 JSON
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = JSON.parse(headers);
    } catch {
      toast.error("Headers 不是有效的 JSON");
      return;
    }

    let parsedBody: string | undefined;
    if (method !== "GET" && method !== "HEAD" && body.trim()) {
      try {
        // 验证是合法 JSON
        JSON.parse(body);
        parsedBody = body;
      } catch {
        toast.error("Body 不是有效的 JSON");
        return;
      }
    }

    setLoading(true);
    setResponse("");
    setRawResponse("");
    setStatusCode(null);
    setElapsed(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const startTime = Date.now();

    try {
      const resp = await corsFetch(url, {
        method,
        headers: parsedHeaders,
        body: parsedBody,
        signal: controller.signal,
      });

      setStatusCode(resp.status);
      const text = await resp.text();
      setElapsed(Date.now() - startTime);

      // 保留完整原始文本供「复制」使用；展示用经过脱敏/截断处理，
      // 避免 Gemini 生图等返回的超长 base64 数据撑爆 DOM 导致窗口撕裂。
      setRawResponse(text);
      setResponse(sanitizeResponseForDisplay(text));
    } catch (err: any) {
      setElapsed(Date.now() - startTime);
      if (err?.name === "AbortError") {
        setResponse("请求已取消");
      } else {
        setResponse(`错误: ${err?.message || err}`);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [url, method, headers, body]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleCopyResponse = useCallback(() => {
    // 复制完整原始响应（含被省略展示的 base64），展示区仅为防撕裂的精简版
    const toCopy = rawResponse || response;
    if (toCopy) {
      navigator.clipboard.writeText(toCopy);
      toast.success("已复制响应内容");
    }
  }, [rawResponse, response]);

  const handleClear = useCallback(() => {
    setResponse("");
    setRawResponse("");
    setStatusCode(null);
    setElapsed(null);
  }, []);

  // ==================== 任务查询模式 ====================
  const [mode, setMode] = useState<"request" | "task">("request");
  const [taskId, setTaskId] = useState("");
  const [taskModel, setTaskModel] = useState("");
  const [taskRoute, setTaskRoute] = useState<FreedomTaskQueryRoute>("auto");
  const [taskPollUrl, setTaskPollUrl] = useState("");
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskResult, setTaskResult] = useState<FreedomTaskQueryResult | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const taskAbortRef = useRef<AbortController | null>(null);

  // ── 图片同步生成探针（手动查询结果）──
  const [probeModel, setProbeModel] = useState("");
  const [probePrompt, setProbePrompt] = useState("");
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeSaving, setProbeSaving] = useState(false);
  const [probeResult, setProbeResult] = useState<FreedomImageProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const probeAbortRef = useRef<AbortController | null>(null);

  // 历史待查询任务（从持久化任务队列读取，便于一键回填 ID）
  const pendingTasks = useFreedomTaskStore((s) => s.tasks);

  const handleQueryTask = useCallback(async () => {
    if (!taskId.trim() && !taskPollUrl.trim()) {
      toast.error("请填写任务 ID 或完整查询地址");
      return;
    }
    setTaskLoading(true);
    setTaskResult(null);
    setTaskError(null);
    const controller = new AbortController();
    taskAbortRef.current = controller;
    try {
      const result = await queryFreedomTaskById({
        taskId: taskId.trim(),
        route: taskRoute,
        model: taskModel.trim() || undefined,
        pollUrl: taskPollUrl.trim() || undefined,
        signal: controller.signal,
      });
      setTaskResult(result);
      if (result.status === "succeeded" && result.resultUrl) {
        toast.success("任务已完成，已提取到结果链接");
      } else if (result.status === "processing") {
        toast.info("任务仍在生成中，请稍后再查询");
      } else if (result.status === "failed") {
        toast.error(result.error || "任务查询失败或任务本身失败");
      } else {
        toast.info("已返回响应，但未识别到明确状态");
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setTaskError("查询已取消");
      } else {
        setTaskError(err?.message || String(err));
        toast.error(err?.message || "查询失败");
      }
    } finally {
      setTaskLoading(false);
      taskAbortRef.current = null;
    }
  }, [taskId, taskRoute, taskModel, taskPollUrl]);

  const handleCancelTask = useCallback(() => {
    taskAbortRef.current?.abort();
  }, []);

  const handleSaveTaskResult = useCallback(async () => {
    if (!taskResult?.resultUrl || !taskResult.mediaType) return;
    setTaskSaving(true);
    try {
      const mediaId = await saveFreedomTaskResultToMedia({
        url: taskResult.resultUrl,
        mediaType: taskResult.mediaType,
        prompt: taskModel.trim() ? `调试查询 ${taskModel.trim()}` : "调试任务查询",
        projectId: useProjectStore.getState().activeProjectId,
      });
      if (mediaId) {
        toast.success("已保存到素材库");
      } else {
        toast.error("保存失败：未返回媒体 ID");
      }
    } catch (err: any) {
      toast.error(`保存失败：${err?.message || err}`);
    } finally {
      setTaskSaving(false);
    }
  }, [taskResult, taskModel]);

  const handleUseTask = useCallback((t: { serverTaskId?: string; model?: string; pollUrl?: string }) => {
    if (t.serverTaskId) setTaskId(t.serverTaskId);
    if (t.model) setTaskModel(t.model);
    if (t.pollUrl) setTaskPollUrl(t.pollUrl);
    setTaskRoute("auto");
  }, []);

  // ── 图片探针：真实发一次生图请求，展示未经提取的原始响应 + 提取诊断 ──
  const handleProbeImage = useCallback(async () => {
    setProbeLoading(true);
    setProbeResult(null);
    setProbeError(null);
    const controller = new AbortController();
    probeAbortRef.current = controller;
    try {
      const result = await probeFreedomImageResponse({
        model: probeModel.trim() || undefined,
        prompt: probePrompt.trim() || undefined,
        signal: controller.signal,
      });
      setProbeResult(result);
      if (result.extractedUrl) {
        toast.success(`已提取到图片（命中 ${result.matchedExtractor}）`);
      } else if (result.error) {
        toast.warning("上游已返回，但当前逻辑未能提取图片，请查看原始响应结构");
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setProbeError("探测已取消");
      } else {
        setProbeError(err?.message || String(err));
        toast.error(err?.message || "探测失败");
      }
    } finally {
      setProbeLoading(false);
      probeAbortRef.current = null;
    }
  }, [probeModel, probePrompt]);

  const handleCancelProbe = useCallback(() => {
    probeAbortRef.current?.abort();
  }, []);

  const handleSaveProbeResult = useCallback(async () => {
    if (!probeResult?.extractedUrl) return;
    setProbeSaving(true);
    try {
      const mediaId = await saveFreedomTaskResultToMedia({
        url: probeResult.extractedUrl,
        mediaType: "image",
        prompt: probeModel.trim() ? `探针 ${probeModel.trim()}` : "图片探针",
        projectId: useProjectStore.getState().activeProjectId,
      });
      if (mediaId) {
        toast.success("已保存到素材库");
      } else {
        toast.error("保存失败：未返回媒体 ID");
      }
    } catch (err: any) {
      toast.error(`保存失败：${err?.message || err}`);
    } finally {
      setProbeSaving(false);
    }
  }, [probeResult, probeModel]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold">API Debug 调试面板</h2>
          <p className="text-xs text-muted-foreground">
            {mode === "request" ? "直接发送 JSON 请求调用模型接口进行测试" : "用任务 ID 查询生成结果并可一键保存到素材库"}
          </p>
        </div>
        <div className="flex items-center rounded-md border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("request")}
            className={`px-3 py-1 rounded transition-colors ${
              mode === "request" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            原始请求
          </button>
          <button
            type="button"
            onClick={() => setMode("task")}
            className={`px-3 py-1 rounded transition-colors ${
              mode === "task" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            任务查询
          </button>
        </div>
      </div>

      {mode === "task" ? (
        <TaskQuerySection
          taskId={taskId}
          setTaskId={setTaskId}
          taskModel={taskModel}
          setTaskModel={setTaskModel}
          taskRoute={taskRoute}
          setTaskRoute={setTaskRoute}
          taskPollUrl={taskPollUrl}
          setTaskPollUrl={setTaskPollUrl}
          taskLoading={taskLoading}
          taskSaving={taskSaving}
          taskResult={taskResult}
          taskError={taskError}
          pendingTasks={pendingTasks}
          onQuery={handleQueryTask}
          onCancel={handleCancelTask}
          onSave={handleSaveTaskResult}
          onUseTask={handleUseTask}
          probeModel={probeModel}
          setProbeModel={setProbeModel}
          probePrompt={probePrompt}
          setProbePrompt={setProbePrompt}
          probeLoading={probeLoading}
          probeSaving={probeSaving}
          probeResult={probeResult}
          probeError={probeError}
          onProbe={handleProbeImage}
          onCancelProbe={handleCancelProbe}
          onSaveProbe={handleSaveProbeResult}
        />
      ) : (
      <div className="flex-1 flex min-h-0">
        {/* Left: Request */}
        <div className="w-1/2 border-r flex flex-col min-h-0">
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {/* URL + Method */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">请求地址</Label>
                <div className="flex gap-2">
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-xs font-mono"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 font-mono text-xs h-9"
                  />
                </div>
              </div>

              {/* Headers */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Headers (JSON)</Label>
                <textarea
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  className="w-full h-28 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                  spellCheck={false}
                />
              </div>

              {/* Body */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Body (JSON)</Label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full h-56 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                  spellCheck={false}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  onClick={handleSend}
                  disabled={loading || !url.trim()}
                  className="flex-1 h-9"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-1.5" />
                  )}
                  {loading ? "请求中…" : "发送请求"}
                </Button>
                {loading && (
                  <Button variant="outline" onClick={handleCancel} className="h-9">
                    取消
                  </Button>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* Right: Response */}
        <div className="w-1/2 flex flex-col min-h-0">
          <div className="border-b px-4 py-2 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium">响应</span>
              {statusCode !== null && (
                <span
                  className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                    statusCode >= 200 && statusCode < 300
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : statusCode >= 400
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                  }`}
                >
                  {statusCode}
                </span>
              )}
              {elapsed !== null && (
                <span className="text-[11px] text-muted-foreground">{elapsed}ms</span>
              )}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCopyResponse} title="复制">
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleClear} title="清空">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words overflow-x-auto max-w-full text-foreground/90">
              {response || (loading ? "等待响应…" : "点击「发送请求」查看结果")}
            </pre>
          </ScrollArea>
        </div>
      </div>
      )}
    </div>
  );
}

// ==================== 任务查询子面板 ====================

interface TaskQuerySectionProps {
  taskId: string;
  setTaskId: (v: string) => void;
  taskModel: string;
  setTaskModel: (v: string) => void;
  taskRoute: FreedomTaskQueryRoute;
  setTaskRoute: (v: FreedomTaskQueryRoute) => void;
  taskPollUrl: string;
  setTaskPollUrl: (v: string) => void;
  taskLoading: boolean;
  taskSaving: boolean;
  taskResult: FreedomTaskQueryResult | null;
  taskError: string | null;
  pendingTasks: PersistedFreedomTask[];
  onQuery: () => void;
  onCancel: () => void;
  onSave: () => void;
  onUseTask: (t: { serverTaskId?: string; model?: string; pollUrl?: string }) => void;
  // 图片探针（手动查询结果）
  probeModel: string;
  setProbeModel: (v: string) => void;
  probePrompt: string;
  setProbePrompt: (v: string) => void;
  probeLoading: boolean;
  probeSaving: boolean;
  probeResult: FreedomImageProbeResult | null;
  probeError: string | null;
  onProbe: () => void;
  onCancelProbe: () => void;
  onSaveProbe: () => void;
}

const STATUS_BADGE: Record<FreedomTaskQueryResult["status"], { label: string; cls: string }> = {
  succeeded: { label: "已完成", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  processing: { label: "生成中", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  failed: { label: "失败", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  unknown: { label: "未知", cls: "bg-muted text-muted-foreground" },
};

function TaskQuerySection(props: TaskQuerySectionProps) {
  const {
    taskId, setTaskId, taskModel, setTaskModel, taskRoute, setTaskRoute,
    taskPollUrl, setTaskPollUrl, taskLoading, taskSaving, taskResult, taskError,
    pendingTasks, onQuery, onCancel, onSave, onUseTask,
    probeModel, setProbeModel, probePrompt, setProbePrompt,
    probeLoading, probeSaving, probeResult, probeError,
    onProbe, onCancelProbe, onSaveProbe,
  } = props;

  const rawText = taskResult
    ? sanitizeResponseForDisplay(taskResult.raw)
    : "";

  // 仅展示带有服务端任务 ID / pollUrl 的历史任务，便于一键回填
  const queryableTasks = pendingTasks
    .filter((t) => t.serverTaskId || t.pollUrl)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 20);

  return (
    <div className="flex-1 flex min-h-0">
      {/* Left: 查询表单 */}
      <div className="w-1/2 border-r flex flex-col min-h-0">
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Task ID */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">任务 ID</Label>
              <Input
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                placeholder="上游返回的 task id / job id"
                className="font-mono text-xs h-9"
              />
            </div>

            {/* Route + Model */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label className="text-xs font-medium">路由类型</Label>
                <select
                  value={taskRoute}
                  onChange={(e) => setTaskRoute(e.target.value as FreedomTaskQueryRoute)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="auto">自动（按模型判断）</option>
                  <option value="volc">volc（火山方舟）</option>
                  <option value="unified">unified（统一端点）</option>
                  <option value="openai_official">openai_official</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">模型 ID（可选）</Label>
                <Input
                  value={taskModel}
                  onChange={(e) => setTaskModel(e.target.value)}
                  placeholder="用于解析配置/路由"
                  className="font-mono text-xs h-9"
                />
              </div>
            </div>

            {/* 显式 pollUrl */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">完整查询地址（可选，优先级最高）</Label>
              <Input
                value={taskPollUrl}
                onChange={(e) => setTaskPollUrl(e.target.value)}
                placeholder="https://... 直接指定则忽略上面的自动拼装"
                className="font-mono text-xs h-9"
              />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                默认使用「自由板块-视频」绑定的 API 配置（baseUrl + Key）自动拼装查询地址。
                若自动拼装不对，可在此填入完整地址。
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={onQuery}
                disabled={taskLoading || (!taskId.trim() && !taskPollUrl.trim())}
                className="flex-1 h-9"
              >
                {taskLoading ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-1.5" />
                )}
                {taskLoading ? "查询中…" : "查询任务"}
              </Button>
              {taskLoading && (
                <Button variant="outline" onClick={onCancel} className="h-9">
                  取消
                </Button>
              )}
            </div>

            {/* 历史任务快速回填 */}
            {queryableTasks.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  最近任务（点击回填）
                </Label>
                <div className="space-y-1">
                  {queryableTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onUseTask({ serverTaskId: t.serverTaskId, model: t.model, pollUrl: t.pollUrl })}
                      className="w-full text-left rounded-md border px-2 py-1.5 text-[11px] hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono truncate">{t.serverTaskId || t.pollUrl}</span>
                        <span className="shrink-0 text-muted-foreground">{t.type} · {t.status}</span>
                      </div>
                      <div className="truncate text-muted-foreground">{t.model || "—"}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── 图片同步生成探针（手动查询结果）── */}
            <div className="space-y-3 pt-3 border-t">
              <div className="space-y-1">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Search className="h-3.5 w-3.5" />
                  图片手动查询结果（生图探针）
                </Label>
                <p className="text-[11px] text-amber-600 dark:text-amber-500 leading-relaxed">
                  ⚠️ 会用「自由板块-图片」绑定的配置真实发起一次生图请求（可能扣费），
                  用于抓取上游「未经提取」的原始响应结构，定位「已扣费但提取失败」的问题。
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">模型 ID（留空则用默认绑定模型）</Label>
                <Input
                  value={probeModel}
                  onChange={(e) => setProbeModel(e.target.value)}
                  placeholder="例如 gpt-image-2 / gemini-3.1-flash-image"
                  className="font-mono text-xs h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">提示词（留空则用内置测试提示词）</Label>
                <textarea
                  value={probePrompt}
                  onChange={(e) => setProbePrompt(e.target.value)}
                  placeholder="A cute corgi puppy sitting on green grass..."
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-none"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={onProbe}
                  disabled={probeLoading}
                  variant="secondary"
                  className="flex-1 h-9"
                >
                  {probeLoading ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4 mr-1.5" />
                  )}
                  {probeLoading ? "探测中…" : "发起探测 / 查询结果"}
                </Button>
                {probeLoading && (
                  <Button variant="outline" onClick={onCancelProbe} className="h-9">
                    取消
                  </Button>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Right: 查询结果 */}
      <div className="w-1/2 flex flex-col min-h-0">
        <div className="border-b px-4 py-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium">查询结果</span>
            {taskResult && (
              <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${STATUS_BADGE[taskResult.status].cls}`}>
                {STATUS_BADGE[taskResult.status].label}
              </span>
            )}
            {taskResult && (
              <span className="text-[11px] text-muted-foreground">HTTP {taskResult.httpStatus} · {taskResult.route}</span>
            )}
          </div>
          {taskResult?.resultUrl && taskResult.mediaType && (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={onSave}
              disabled={taskSaving}
            >
              {taskSaving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1" />
              )}
              保存到素材库
            </Button>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-3">
            {taskError && (
              <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-900/50 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                {taskError}
              </div>
            )}

            {taskResult?.resultUrl && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">
                  结果链接（{taskResult.mediaType === "video" ? "视频" : "图片"}）
                </Label>
                <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] font-mono break-all">
                  {taskResult.resultUrl}
                </div>
                {taskResult.mediaType === "image" ? (
                  <img
                    src={taskResult.resultUrl}
                    alt="result"
                    className="max-h-48 rounded-md border object-contain"
                  />
                ) : (
                  <video
                    src={taskResult.resultUrl}
                    controls
                    className="max-h-48 w-full rounded-md border bg-black"
                  />
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-medium">原始响应</Label>
              <pre className="text-xs font-mono whitespace-pre-wrap break-words overflow-x-auto max-w-full text-foreground/90 rounded-md border bg-muted/30 p-3">
                {rawText || (taskLoading ? "查询中…" : "点击「查询任务」查看结果")}
              </pre>
            </div>

            {/* ── 图片探针结果 ── */}
            {(probeResult || probeError || probeLoading) && (
              <div className="space-y-2 pt-3 border-t">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium flex items-center gap-1">
                    <Search className="h-3.5 w-3.5" />
                    探针结果
                  </Label>
                  {probeResult?.extractedUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={onSaveProbe}
                      disabled={probeSaving}
                    >
                      {probeSaving ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5 mr-1" />
                      )}
                      保存到素材库
                    </Button>
                  )}
                </div>

                {probeError && (
                  <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-900/50 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                    {probeError}
                  </div>
                )}

                {probeResult && (
                  <>
                    {/* 诊断信息 */}
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className="rounded-md border bg-muted/40 px-2 py-1">
                        <span className="text-muted-foreground">路由</span>{" "}
                        <span className="font-mono">{probeResult.route}</span>
                      </div>
                      <div className="rounded-md border bg-muted/40 px-2 py-1">
                        <span className="text-muted-foreground">HTTP</span>{" "}
                        <span className="font-mono">{probeResult.httpStatus}</span>
                      </div>
                      <div className="col-span-2 rounded-md border bg-muted/40 px-2 py-1 break-all">
                        <span className="text-muted-foreground">端点</span>{" "}
                        <span className="font-mono">{probeResult.endpoint}</span>
                      </div>
                      <div className="col-span-2 rounded-md border bg-muted/40 px-2 py-1">
                        <span className="text-muted-foreground">提取结果</span>{" "}
                        {probeResult.extractedUrl ? (
                          <span className="font-mono text-green-600 dark:text-green-400">
                            成功（命中 {probeResult.matchedExtractor}）
                          </span>
                        ) : (
                          <span className="font-mono text-red-600 dark:text-red-400">
                            未提取到图片
                          </span>
                        )}
                      </div>
                    </div>

                    {probeResult.error && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/50 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                        {probeResult.error}
                      </div>
                    )}

                    {probeResult.extractedUrl && (
                      <div className="space-y-1.5">
                        <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] font-mono break-all">
                          {probeResult.extractedUrl.startsWith("data:")
                            ? `${probeResult.extractedUrl.slice(0, 80)}…（base64）`
                            : probeResult.extractedUrl}
                        </div>
                        <img
                          src={probeResult.extractedUrl}
                          alt="probe-result"
                          className="max-h-48 rounded-md border object-contain"
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-medium text-muted-foreground">
                        请求体
                      </Label>
                      <pre className="text-[11px] font-mono whitespace-pre-wrap break-words overflow-x-auto max-w-full text-foreground/80 rounded-md border bg-muted/30 p-2.5">
                        {sanitizeResponseForDisplay(probeResult.requestBody)}
                      </pre>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-medium text-muted-foreground">
                        上游原始响应（未提取）
                      </Label>
                      <pre className="text-[11px] font-mono whitespace-pre-wrap break-words overflow-x-auto max-w-full text-foreground/90 rounded-md border bg-muted/30 p-2.5">
                        {sanitizeResponseForDisplay(probeResult.raw)}
                      </pre>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
