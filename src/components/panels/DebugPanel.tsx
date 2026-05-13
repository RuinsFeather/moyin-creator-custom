"use client";

import { useState, useCallback, useRef } from "react";
import { Play, Copy, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { corsFetch } from "@/lib/cors-fetch";

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

      // 尝试格式化 JSON
      try {
        const json = JSON.parse(text);
        setResponse(JSON.stringify(json, null, 2));
      } catch {
        setResponse(text);
      }
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
    if (response) {
      navigator.clipboard.writeText(response);
      toast.success("已复制响应内容");
    }
  }, [response]);

  const handleClear = useCallback(() => {
    setResponse("");
    setStatusCode(null);
    setElapsed(null);
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold">API Debug 调试面板</h2>
          <p className="text-xs text-muted-foreground">直接发送 JSON 请求调用模型接口进行测试</p>
        </div>
      </div>

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
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all text-foreground/90">
              {response || (loading ? "等待响应…" : "点击「发送请求」查看结果")}
            </pre>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
