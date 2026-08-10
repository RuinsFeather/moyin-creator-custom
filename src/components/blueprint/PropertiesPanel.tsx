// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useCallback, useMemo, useState } from 'react';
import { useBlueprintStore } from '@/stores/blueprint-store';
import {
  BLUEPRINT_NODE_PORTS,
  type BlueprintNode,
  type BlueprintNodeData,
  type BlueprintNodeType,
  type BlueprintNodeConfig,
  type TextInputNodeConfig,
  type MediaReferenceNodeConfig,
  type ScriptImportNodeConfig,
  type BlueprintImageGeneratorConfig,
  type OutputNodeConfig,
} from '@/types/blueprint';
import { IMAGE_MODELS, ASPECT_RATIOS, RESOLUTIONS } from './nodes/constants';
import { categorizeError, type ErrorCategory } from '@/lib/blueprint/error-utils';
import { AIAssistPanel } from './AIAssistPanel';

// ── Shared field components ───────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <Field label={label}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary"
      />
    </Field>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <Field label={label}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-none rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary"
      />
    </Field>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-input"
      />
      {label}
    </label>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 border-t border-border pt-2 text-[10px] font-medium text-muted-foreground">
      {children}
    </div>
  );
}

// ── Node type-specific editors ────────────────────────────────────────────

const TextInputEditor = memo(function TextInputEditor({
  nodeId,
  config,
  updateNode,
}: {
  nodeId: string;
  config: TextInputNodeConfig;
  updateNode: (id: string, updates: Partial<BlueprintNodeData>) => void;
}) {
  const extended = config as TextInputNodeConfig & {
    language?: string;
    role?: string;
  };
  const [showAI, setShowAI] = useState(false);

  const handleApplyAIText = useCallback(
    (newText: string) => {
      updateNode(nodeId, {
        config: { ...config, text: newText } as BlueprintNodeConfig,
      });
    },
    [nodeId, config, updateNode],
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">文本内容</span>
        <button
          onClick={() => setShowAI((v) => !v)}
          className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
            showAI
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          title="AI 写作助手"
        >
          ✨ AI 助手
        </button>
      </div>

      {showAI && (
        <div className="mb-2" style={{ height: 320 }}>
          <AIAssistPanel
            currentText={typeof config.text === 'string' ? config.text : ''}
            role={extended.role ?? 'prompt'}
            language={extended.language ?? 'auto'}
            onApplyText={handleApplyAIText}
            onClose={() => setShowAI(false)}
          />
        </div>
      )}

      <TextareaField
        label={showAI ? '' : '文本内容'}
        value={typeof config.text === 'string' ? config.text : ''}
        onChange={(text) =>
          updateNode(nodeId, {
            config: { ...config, text } as BlueprintNodeConfig,
          })
        }
        placeholder="输入提示词、台词或上下文…"
        rows={4}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <SelectField
          label="语言"
          value={extended.language ?? 'auto'}
          onChange={(language) =>
            updateNode(nodeId, {
              config: { ...config, language } as BlueprintNodeConfig,
            })
          }
          options={[
            { value: 'auto', label: '自动检测' },
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
            { value: 'ja', label: '日本語' },
          ]}
        />
        <SelectField
          label="文本类型"
          value={extended.role ?? 'prompt'}
          onChange={(role) =>
            updateNode(nodeId, {
              config: { ...config, role } as BlueprintNodeConfig,
            })
          }
          options={[
            { value: 'prompt', label: '提示词' },
            { value: 'negative', label: '负向提示词' },
            { value: 'dialogue', label: '台词' },
            { value: 'context', label: '上下文' },
          ]}
        />
      </div>
    </>
  );
});

const ImageReferenceEditor = memo(function ImageReferenceEditor({
  nodeId,
  config,
  updateNode,
}: {
  nodeId: string;
  config: MediaReferenceNodeConfig;
  updateNode: (id: string, updates: Partial<BlueprintNodeData>) => void;
}) {
  const count = Array.isArray(config.media) ? config.media.length : 0;
  return (
    <>
      <div className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
        {count > 0 ? `${count} 张参考图片` : '暂无参考图片'}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        在画布节点上拖放图片或点击选择
      </p>
    </>
  );
});

const ScriptImportEditor = memo(function ScriptImportEditor({
  nodeId,
  config,
  updateNode,
}: {
  nodeId: string;
  config: ScriptImportNodeConfig;
  updateNode: (id: string, updates: Partial<BlueprintNodeData>) => void;
}) {
  return (
    <>
      <SelectField
        label="导入模式"
        value={config.mode}
        onChange={(mode) =>
          updateNode(nodeId, {
            config: {
              ...config,
              mode: mode as ScriptImportNodeConfig['mode'],
            } as BlueprintNodeConfig,
          })
        }
        options={[{ value: 'snapshot', label: '快照模式' }]}
      />
      <div className="mt-1 rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
        {config.selectedShotIds.length > 0
          ? `已选 ${config.selectedShotIds.length} 个分镜`
          : '尚未选择分镜'}
      </div>
    </>
  );
});

const ImageGeneratorEditor = memo(function ImageGeneratorEditor({
  nodeId,
  config,
  updateNode,
}: {
  nodeId: string;
  config: BlueprintImageGeneratorConfig;
  updateNode: (id: string, updates: Partial<BlueprintNodeData>) => void;
}) {
  const patch = useCallback(
    (patch: Partial<BlueprintImageGeneratorConfig>) => {
      updateNode(nodeId, {
        config: { ...config, ...patch } as BlueprintNodeConfig,
      });
    },
    [nodeId, config, updateNode],
  );

  return (
    <>
      <TextareaField
        label="提示词"
        value={config.prompt ?? ''}
        onChange={(prompt) => patch({ prompt })}
        placeholder="输入生成提示词…"
        rows={3}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <SelectField
          label="模型"
          value={config.model ?? ''}
          onChange={(model) => patch({ model })}
          options={[{ value: '', label: '默认' }, ...IMAGE_MODELS]}
        />
        <SelectField
          label="宽高比"
          value={config.aspectRatio ?? '1:1'}
          onChange={(aspectRatio) => patch({ aspectRatio })}
          options={ASPECT_RATIOS}
        />
      </div>
      <SelectField
        label="分辨率"
        value={config.resolution ?? ''}
        onChange={(resolution) => patch({ resolution })}
        options={[{ value: '', label: '跟随比例' }, ...RESOLUTIONS]}
      />
      <TextareaField
        label="负向提示词"
        value={config.negativePrompt ?? ''}
        onChange={(negativePrompt) => patch({ negativePrompt })}
        placeholder="不想出现的内容…"
        rows={2}
      />
      <SectionHeader>参考图</SectionHeader>
      <div className="mt-1 rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
        {config.referenceImageRefs && config.referenceImageRefs.length > 0
          ? `${config.referenceImageRefs.length} 张参考图已关联`
          : '通过连线或画布节点添加参考图'}
      </div>
    </>
  );
});

const VideoGeneratorEditor = memo(function VideoGeneratorEditor({
  nodeId,
  config,
}: {
  nodeId: string;
  config: BlueprintNodeConfig;
  updateNode: (id: string, updates: Partial<BlueprintNodeData>) => void;
}) {
  return (
    <div className="rounded border border-dashed border-muted-foreground/40 bg-muted/20 p-3 text-center text-xs text-muted-foreground">
      <span className="text-lg">🎥</span>
      <p className="mt-1">视频生成将在 MVP-B 阶段实现</p>
    </div>
  );
});

const OutputEditor = memo(function OutputEditor({
  nodeId,
  config,
  updateNode,
}: {
  nodeId: string;
  config: OutputNodeConfig;
  updateNode: (id: string, updates: Partial<BlueprintNodeData>) => void;
}) {
  const types = config.acceptedTypes ?? ['image'];

  const toggle = useCallback(
    (type: 'image' | 'video' | 'audio') => {
      const next = types.includes(type)
        ? types.filter((t) => t !== type)
        : [...types, type];
      if (next.length === 0) return;
      updateNode(nodeId, {
        config: { ...config, acceptedTypes: next } as BlueprintNodeConfig,
      });
    },
    [nodeId, config, types, updateNode],
  );

  return (
    <>
      <SectionHeader>接收类型</SectionHeader>
      <div className="mt-1 space-y-1">
        {(['image', 'video', 'audio'] as const).map((type) => (
          <CheckboxField
            key={type}
            label={type === 'image' ? '🖼️ 图片' : type === 'video' ? '🎬 视频' : '🔊 音频'}
            checked={types.includes(type)}
            onChange={() => toggle(type)}
          />
        ))}
      </div>
    </>
  );
});

// Port type label map
const DATA_TYPE_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  context: '上下文',
};

// ── Port list display ─────────────────────────────────────────────────────

function PortList({ nodeType }: { nodeType: BlueprintNodeType }) {
  const ports = BLUEPRINT_NODE_PORTS[nodeType];
  if (!ports) return null;

  return (
    <>
      <SectionHeader>端口</SectionHeader>
      <div className="mt-1 space-y-0.5">
        {ports.map((port) => (
          <div
            key={port.id}
            className="flex items-center justify-between rounded px-1 py-0.5 text-[10px]"
          >
            <span className="text-foreground">
              {port.direction === 'input' ? '←' : '→'} {port.id}
              {port.required && <span className="ml-0.5 text-destructive">*</span>}
            </span>
            <span className="text-muted-foreground">
              {port.dataTypes.map((dt) => DATA_TYPE_LABELS[dt] ?? dt).join(' | ')}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Delete confirmation ───────────────────────────────────────────────────

function DeleteNodeButton({
  nodeId,
  nodeLabel,
}: {
  nodeId: string;
  nodeLabel: string;
}) {
  const removeNode = useBlueprintStore((s) => s.removeNode);
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const [confirming, setConfirming] = useState(false);

  const handleDelete = useCallback(() => {
    removeNode(nodeId);
    selectNode(null);
  }, [nodeId, removeNode, selectNode]);

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-destructive">确认删除 "{nodeLabel}"？</span>
        <button
          onClick={handleDelete}
          className="rounded bg-destructive px-2 py-0.5 text-[10px] text-destructive-foreground"
        >
          删除
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
        >
          取消
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded px-1.5 py-0.5 text-[10px] text-destructive transition-colors hover:bg-destructive/10"
      title="删除此节点"
    >
      🗑️
    </button>
  );
}

// ── Node-specific config editor selector ──────────────────────────────────

function NodeTypeEditor({
  nodeId,
  nodeType,
  config,
  updateNode,
}: {
  nodeId: string;
  nodeType: BlueprintNodeType;
  config: BlueprintNodeConfig;
  updateNode: (id: string, updates: Partial<BlueprintNodeData>) => void;
}) {
  switch (nodeType) {
    case 'text-input':
      return (
        <TextInputEditor
          nodeId={nodeId}
          config={config as TextInputNodeConfig}
          updateNode={updateNode}
        />
      );
    case 'image-reference':
      return (
        <ImageReferenceEditor
          nodeId={nodeId}
          config={config as MediaReferenceNodeConfig}
          updateNode={updateNode}
        />
      );
    case 'script-import':
      return (
        <ScriptImportEditor
          nodeId={nodeId}
          config={config as ScriptImportNodeConfig}
          updateNode={updateNode}
        />
      );
    case 'image-generator':
      return (
        <ImageGeneratorEditor
          nodeId={nodeId}
          config={config as BlueprintImageGeneratorConfig}
          updateNode={updateNode}
        />
      );
    case 'video-generator':
      return (
        <VideoGeneratorEditor
          nodeId={nodeId}
          config={config}
          updateNode={updateNode}
        />
      );
    case 'output':
      return (
        <OutputEditor
          nodeId={nodeId}
          config={config as OutputNodeConfig}
          updateNode={updateNode}
        />
      );
    default:
      return (
        <div className="text-xs text-muted-foreground">
          暂无 {nodeType} 的配置界面
        </div>
      );
  }
}

// ── Main Properties Panel ─────────────────────────────────────────────────

export function PropertiesPanel() {
  const selectedNodeId = useBlueprintStore((s) => s.selectedNodeId);
  const activeBlueprintId = useBlueprintStore((s) => s.activeBlueprintId);
  const blueprints = useBlueprintStore((s) => s.blueprints);
  const updateNode = useBlueprintStore((s) => s.updateNode);
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const selectEdge = useBlueprintStore((s) => s.selectEdge);

  const activeBlueprint = useMemo(
    () => blueprints.find((b) => b.id === activeBlueprintId) ?? null,
    [blueprints, activeBlueprintId],
  );

  const selectedNode = useMemo(() => {
    if (!activeBlueprint || !selectedNodeId) return null;
    return activeBlueprint.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [activeBlueprint, selectedNodeId]);

  const handleLabelChange = useCallback(
    (label: string) => {
      if (selectedNodeId) {
        updateNode(selectedNodeId, { label });
      }
    },
    [selectedNodeId, updateNode],
  );

  // ── No selection ──────────────────────────────────────────────────
  if (!selectedNode) {
    return (
      <div className="flex h-full flex-col border-l border-border bg-panel">
        <div className="flex h-9 items-center border-b border-border px-3">
          <span className="text-xs font-medium text-foreground">属性</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center text-xs text-muted-foreground">
            <p className="text-lg">📋</p>
            <p className="mt-1">选择一个节点查看属性</p>
            <p className="mt-0.5 text-[10px]">或从左侧工具栏添加新节点</p>
          </div>
        </div>
      </div>
    );
  }

  const nodeData = selectedNode.data;
  const nodeType = nodeData.nodeType;
  const execution = nodeData.execution;

  return (
    <div className="flex h-full w-64 flex-col border-l border-border bg-panel">
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-medium text-foreground">属性</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              selectNode(null);
              selectEdge(null);
            }}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="取消选择"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Node identity */}
        <div className="flex items-center gap-2 text-sm">
          <span>{NODE_TYPE_EMOJI[nodeType] ?? '⬡'}</span>
          <span className="text-[10px] font-medium uppercase text-muted-foreground">
            {nodeType}
          </span>
        </div>

        {/* Label */}
        <Field label="名称">
          <input
            type="text"
            value={nodeData.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            className="w-full rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary"
          />
        </Field>

        {/* Execution status */}
        {execution && (
          <>
            <SectionHeader>执行状态</SectionHeader>
            <div className="space-y-0.5 text-[10px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">状态</span>
                <span className={STATUS_TEXT_COLOR[execution.status] ?? 'text-foreground'}>
                  {STATUS_LABELS[execution.status] ?? execution.status}
                </span>
              </div>
              {typeof execution.progress === 'number' && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">进度</span>
                  <span className="text-foreground">
                    {Math.round(execution.progress * 100)}%
                  </span>
                </div>
              )}
              {execution.error && (
                <EnhancedErrorDisplay error={execution.error} />
              )}
              {execution.output && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">输出</span>
                  <span className="text-success">✓ 已完成</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Node-specific config */}
        <SectionHeader>配置</SectionHeader>
        <NodeTypeEditor
          nodeId={selectedNode.id}
          nodeType={nodeType}
          config={nodeData.config}
          updateNode={updateNode}
        />

        {/* Port info */}
        <PortList nodeType={nodeType} />

        {/* Danger zone */}
        <SectionHeader>操作</SectionHeader>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            ID: {selectedNode.id.slice(0, 8)}…
          </span>
          <DeleteNodeButton nodeId={selectedNode.id} nodeLabel={nodeData.label} />
        </div>
      </div>
    </div>
  );
}

const NODE_TYPE_EMOJI: Record<string, string> = {
  'text-input': '📝',
  'image-reference': '🖼️',
  'video-reference': '🎬',
  'script-import': '📜',
  'image-generator': '🎨',
  'video-generator': '🎥',
  output: '📦',
};

const STATUS_LABELS: Record<string, string> = {
  idle: '空闲',
  queued: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  stale: '已过期',
  blocked: '被阻断',
};

const STATUS_TEXT_COLOR: Record<string, string> = {
  completed: 'text-success',
  running: 'text-info',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground',
  stale: 'text-warning',
  blocked: 'text-muted-foreground/60',
  queued: 'text-info/60',
};

// ── Enhanced Error Display (§11.3) ────────────────────────────────────────

const ERROR_CATEGORY_BADGE: Record<ErrorCategory, string> = {
  network: 'bg-info/15 text-info border-info/30',
  auth: 'bg-warning/15 text-warning border-warning/30',
  validation: 'bg-warning/15 text-warning border-warning/30',
  api: 'bg-destructive/15 text-destructive border-destructive/30',
  cancelled: 'bg-muted text-muted-foreground border-muted-foreground/30',
  blocked: 'bg-muted text-muted-foreground border-muted-foreground/30',
  unknown: 'bg-destructive/15 text-destructive border-destructive/30',
};

const ERROR_CATEGORY_LABEL: Record<ErrorCategory, string> = {
  network: '可恢复',
  auth: '需配置',
  validation: '参数错误',
  api: '服务错误',
  cancelled: '已取消',
  blocked: '上游阻断',
  unknown: '错误',
};

function EnhancedErrorDisplay({ error }: { error: string }) {
  const info = categorizeError(error);
  return (
    <div className="mt-1 space-y-1 rounded border border-destructive/30 bg-destructive/5 p-1.5 text-[10px]">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded border px-1 py-0.5 text-[9px] font-medium ${ERROR_CATEGORY_BADGE[info.category]}`}
        >
          {ERROR_CATEGORY_LABEL[info.category]}
        </span>
        <span className="text-destructive">{info.message}</span>
      </div>
      <div className="text-[9px] text-muted-foreground">
        {info.recoveryIcon} {info.recoveryAction}
      </div>
    </div>
  );
}
