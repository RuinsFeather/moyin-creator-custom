// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useCallback, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BlueprintNode, BlueprintNodeData, TextInputNodeConfig } from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import {
  NodeCard,
  NodeLabel,
  NodeSection,
  NodeTextarea,
  NodeSelect,
  getNodeStatusColor,
} from './NodeUI';
import { AIAssistPanel } from '../AIAssistPanel';

/** Supported language modes for prompt text. */
const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'auto', label: '自动检测' },
];

/** Text role presets — affects how downstream generators interpret the text. */
const TEXT_ROLE_OPTIONS = [
  { value: 'prompt', label: '提示词' },
  { value: 'negative', label: '负向提示词' },
  { value: 'dialogue', label: '台词' },
  { value: 'context', label: '上下文' },
];

/** Extended config with language and role fields. */
interface TextInputExtendedConfig extends TextInputNodeConfig {
  language?: string;
  role?: string;
}

function TextInputNodeComponent({ id, data, selected }: NodeProps<BlueprintNode>) {
  const nodeData = data as BlueprintNodeData;
  const config = (nodeData.config ?? { text: '' }) as TextInputExtendedConfig;
  const execution = nodeData.execution;
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const updateNode = useBlueprintStore((s) => s.updateNode);
  const [showAI, setShowAI] = useState(false);

  const statusColor = getNodeStatusColor(execution?.status);

  const patchConfig = useCallback(
    (patch: Partial<TextInputExtendedConfig>) => {
      const next = { ...config, ...patch } as TextInputExtendedConfig;
      updateNode(id, { config: next as BlueprintNodeData['config'] });
    },
    [id, config, updateNode],
  );

  const handleTextChange = useCallback(
    (text: string) => patchConfig({ text }),
    [patchConfig],
  );

  const handleLanguageChange = useCallback(
    (language: string) => patchConfig({ language }),
    [patchConfig],
  );

  const handleRoleChange = useCallback(
    (role: string) => patchConfig({ role }),
    [patchConfig],
  );

  const charCount = typeof config.text === 'string' ? config.text.length : 0;

  const handleApplyAIText = useCallback(
    (newText: string) => {
      patchConfig({ text: newText });
    },
    [patchConfig],
  );

  return (
    <NodeCard selected={selected} statusColor={statusColor}>
      <NodeLabel icon="📝" label={nodeData.label}>
        {charCount > 0 && (
          <span className="ml-auto text-[9px] tabular-nums text-muted-foreground">
            {charCount}
          </span>
        )}
        {/* AI Assist toggle button (§11.4) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowAI((v) => !v);
          }}
          className={`ml-1 rounded px-1 py-0.5 text-[9px] transition-colors ${
            showAI
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          title="AI 写作助手"
        >
          ✨
        </button>
      </NodeLabel>

      <NodeSection>
        <NodeTextarea
          value={typeof config.text === 'string' ? config.text : ''}
          onChange={handleTextChange}
          placeholder="输入提示词、台词或上下文…"
          rows={3}
        />
      </NodeSection>

      <NodeSection className="flex gap-1.5">
        <div className="flex-1">
          <label className="mb-0.5 block text-[9px] text-muted-foreground">语言</label>
          <NodeSelect
            value={(config as TextInputNodeConfig & { language?: string }).language ?? 'auto'}
            onChange={handleLanguageChange}
            options={LANGUAGE_OPTIONS}
          />
        </div>
        <div className="flex-1">
          <label className="mb-0.5 block text-[9px] text-muted-foreground">类型</label>
          <NodeSelect
            value={(config as TextInputNodeConfig & { role?: string }).role ?? 'prompt'}
            onChange={handleRoleChange}
            options={TEXT_ROLE_OPTIONS}
          />
        </div>
      </NodeSection>

      <Handle
        type="source"
        position={Position.Right}
        id="text"
        className="!bg-info"
      />

      {/* AI Assist Panel — positioned absolutely below the node card (§11.4) */}
      {showAI && (
        <div
          className="absolute left-0 top-full z-50 mt-1"
          style={{ width: 280, height: 360 }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <AIAssistPanel
            currentText={typeof config.text === 'string' ? config.text : ''}
            role={config.role ?? 'prompt'}
            language={config.language ?? 'auto'}
            onApplyText={handleApplyAIText}
            onClose={() => setShowAI(false)}
          />
        </div>
      )}
    </NodeCard>
  );
}

/** Memoized text input node — only re-renders when data or selection changes. */
export const TextInputNode = memo(TextInputNodeComponent);
