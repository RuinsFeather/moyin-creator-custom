// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Visual event extraction (视觉事件提取)
 *
 * 从剧本 token 列表中提取源单元（SourceUnit），并把复合动作按视觉事件链
 * 拆分候选（建立/发起/显现/作用/结果/反应）。拆分是启发式的：确定性提取
 * 可追溯的子事件，语义不确定的边界交给模型细分。
 *
 * 规则：
 *   - 场次标题形成硬边界，不生成镜头（required=false 仅作边界）
 *   - 注释只作约束，不生成成片内容（required=false）
 *   - 动作、转场、字幕、对白生成必需源单元（required=true）
 *   - 一个 `△` 动作块可拆为多个视觉事件，但最小保持整块作为一个事件兜底
 */
import type { ParsedScript, ParsedToken, ScriptToken } from './script-syntax-parser';
import type { SourceUnit, VisualEvent, VisualEventPhase } from './storyboard-source-contract';

/** 事件链阶段关键词（用于启发式拆分复合动作） */
const PHASE_KEYWORDS: Array<{ phase: VisualEventPhase; words: string[] }> = [
  { phase: '建立', words: ['出现', '建立', '登场', '映入', '展现', '显现出', '交代'] },
  { phase: '发起', words: ['冲向', '举起', '挥', '扑', '发动', '施', '念出', '拔', '冲', '攻'] },
  { phase: '显现', words: ['冒出', '浮现', '升起', '钻出', '破土', '冲出', '弥漫', '涌出'] },
  { phase: '作用', words: ['击中', '命中', '打到', '撞上', '吞没', '淹没', '点燃', '覆盖'] },
  { phase: '结果', words: ['倒地', '碎', '散落', '消失', '倒下', '化为', '变成', '熄灭'] },
  { phase: '反应', words: ['惊', '愣', '瞪', '看向', '后退', '僵', '颤', '屏住', '释然'] },
];

/** 将单一视觉事件阶段映射到启发式置信度（0 表示无匹配） */
function detectPhase(content: string): { phase: VisualEventPhase; score: number } {
  let current: { phase: VisualEventPhase; score: number } | null = null;
  for (const kw of PHASE_KEYWORDS) {
    for (const w of kw.words) {
      if (content.includes(w)) {
        const score = w.length; // 长关键词优先
        if (!current || score > current.score) {
          current = { phase: kw.phase, score };
        }
      }
    }
  }
  return current || { phase: '建立', score: 0 };
}

/**
 * 将 token 列表转换为源单元列表。
 * 动作块可能拆出多个视觉事件，其余 token 各对应一个源单元。
 */
export function extractSourceUnits(parsed: ParsedScript): SourceUnit[] {
  const units: SourceUnit[] = [];
  const firstSceneIndex = parsed.tokens.findIndex((pt) => pt.token.type === 'scene');

  for (let index = 0; index < parsed.tokens.length; index++) {
    const pt = parsed.tokens[index];
    const token = pt.token;
    // 标准 Markdown 剧本常在首个场次前包含标题、大纲、人物小传和集号。
    // 它们是生成上下文，不是需要逐项生成镜头的正文。
    if (firstSceneIndex >= 0 && index < firstSceneIndex && token.type !== 'scene') {
      continue;
    }
    switch (token.type) {
      case 'scene':
        // 场次：硬边界，不生成镜头（sceneId 通过 currentSceneId 跟踪）
        break;
      case 'action': {
        const events = splitActionIntoEvents(pt);
        for (const ev of events) {
          units.push({
            id: ev.id,
            kind: 'visual-event',
            sourceRange: ev.sourceRange,
            sceneId: currentSceneId(parsed, pt),
            required: true,
            content: ev.content,
          });
        }
        break;
      }
      case 'dialogue':
        units.push({
          id: pt.id,
          kind: 'dialogue',
          sourceRange: pt.sourceRange,
          sceneId: currentSceneId(parsed, pt),
          required: true,
          content: token.content,
        });
        break;
      case 'transition':
        units.push({
          id: pt.id,
          kind: 'transition',
          sourceRange: pt.sourceRange,
          sceneId: currentSceneId(parsed, pt),
          required: true,
          content: token.content,
        });
        break;
      case 'subtitle':
        units.push({
          id: pt.id,
          kind: 'subtitle',
          sourceRange: pt.sourceRange,
          sceneId: currentSceneId(parsed, pt),
          required: true,
          content: token.content,
        });
        break;
      case 'comment':
        units.push({
          id: pt.id,
          kind: 'comment',
          sourceRange: pt.sourceRange,
          sceneId: currentSceneId(parsed, pt),
          required: false,
          content: token.content,
        });
        break;
      case 'parenthetical':
        // 括号提示并入所属动作/对白，不单独成源单元（归属已由 owner 表达）
        break;
      case 'unknown':
        units.push({
          id: pt.id,
          kind: 'unknown',
          sourceRange: pt.sourceRange,
          sceneId: currentSceneId(parsed, pt),
          required: true,
          content: token.content,
        });
        break;
    }
  }

  return units;
}

/** 查找 token 之前最近的场次 token 的 id */
function currentSceneId(parsed: ParsedScript, pt: ParsedToken): string | null {
  let sceneId: string | null = null;
  for (const t of parsed.tokens) {
    if (t === pt) break;
    if (t.token.type === 'scene') sceneId = t.id;
  }
  return sceneId;
}

/** 将单个动作块拆分为视觉事件（至少一个） */
function splitActionIntoEvents(pt: ParsedToken<ScriptToken>): VisualEvent[] {
  const token = pt.token as Extract<ScriptToken, { type: 'action' }>;
  const content = token.content;
  const events: VisualEvent[] = [];

  // 按常见分隔（句号、分号、省略号）切分候选片段
  const segments = content
    .split(/[。；;！!？?…]{1,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length <= 1) {
    events.push({
      id: `${pt.id}_ev0`,
      phase: detectPhase(content).phase,
      content,
      sourceRange: pt.sourceRange,
      sceneId: null,
    });
    return events;
  }

  let cursor = 0;
  segments.forEach((seg, idx) => {
    const segStart = content.indexOf(seg, cursor);
    const start = pt.sourceRange.start + segStart;
    const end = start + seg.length;
    cursor = segStart + seg.length;
    events.push({
      id: `${pt.id}_ev${idx}`,
      phase: detectPhase(seg).phase,
      content: seg,
      sourceRange: { start, end },
      sceneId: null,
    });
  });

  return events;
}

/** 供外部直接调用：将视觉事件 sceneId 回填（内部用） */
export function setEventSceneId(event: VisualEvent, sceneId: string | null): VisualEvent {
  return { ...event, sceneId };
}
