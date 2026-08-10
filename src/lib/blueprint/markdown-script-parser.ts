// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Markdown Script Parser
 *
 * Parses Markdown-formatted scripts into structured shot data for blueprint
 * conversion. Supports common Chinese screenplay formatting conventions:
 * - Chapter/section headings (# ## ###)
 * - Scene markers (## 场景, ## Scene, etc.)
 * - Character dialogue (**角色名**：台词)
 * - Camera/shot descriptions in brackets 【景别】【镜头运动】
 * - Action descriptions in plain paragraphs
 *
 * This parser is intentionally simple and deterministic — it does NOT call
 * any AI API. For complex structure extraction, the Agent panel should be
 * used instead, and the results fed back as structured shots.
 */

import type { Shot } from '@/types/script';
import { generateUUID } from '@/lib/utils';

// ── Parsed structures ────────────────────────────────────────────────────

/** A parsed scene from the Markdown script. */
export interface ParsedScene {
  id: string;
  heading: string;
  level: number; // heading level (1-6)
  content: string;
  startLine: number;
  endLine: number;
}

/** A parsed dialogue line. */
export interface ParsedDialogue {
  characterName: string;
  text: string;
  line: number;
}

/** A parsed camera/shot instruction. */
export interface ParsedShotInstruction {
  type: 'shot-size' | 'camera-movement' | 'duration' | 'technique';
  value: string;
  line: number;
}

/** Result of parsing a Markdown script. */
export interface MarkdownParseResult {
  scenes: ParsedScene[];
  characters: string[]; // unique character names found
  totalLines: number;
}

// ── Patterns ─────────────────────────────────────────────────────────────

// Scene heading patterns (## 场景1：..., ## Scene 1:..., ### 第一幕, etc.)
const SCENE_HEADING_RE =
  /^#{1,3}\s+((?:场景|场|Scene|SCENE|第[一二三四五六七八九十\d]+[幕场章]).*)$/i;

// Generic section heading that may represent a scene
const SECTION_HEADING_RE = /^#{1,3}\s+(.+)$/;

// Character dialogue: **角色名**：台词 or **角色名**: 台词
// Also supports 【角色名】：台词 pattern
const DIALOGUE_RE =
  /^\s*(?:\*\*(.+?)\*\*|【(.+?)】)\s*[:：]\s*(.+)$/;

// Camera instruction in brackets: 【景别：近景】, 【镜头运动：推】, 【时长：3s】
const SHOT_INSTRUCTION_RE = /【([^】]+?)[：:]\s*([^】]+)】/g;

// Shot size keywords
const SHOT_SIZE_KEYWORDS: Record<string, string> = {
  '远景': 'Wide Shot',
  '全景': 'Wide Shot',
  '中景': 'Medium Shot',
  '中近景': 'Medium Close-up',
  '近景': 'Close-up',
  '特写': 'Close-up',
  '大特写': 'Extreme Close-up',
  'ECU': 'Extreme Close-up',
  'wide': 'Wide Shot',
  'medium': 'Medium Shot',
  'close-up': 'Close-up',
  'closeup': 'Close-up',
};

// Camera movement keywords
const CAMERA_MOVEMENT_KEYWORDS: Record<string, string> = {
  '推': 'Dolly In',
  '拉': 'Dolly Out',
  '摇': 'Pan',
  '移': 'Tracking',
  '跟': 'Tracking',
  '升': 'Crane Up',
  '降': 'Crane Down',
  '固定': 'Static',
  '手持': 'Handheld',
  '航拍': 'Aerial',
  'dolly in': 'Dolly In',
  'dolly out': 'Dolly Out',
  'pan': 'Pan',
  'tilt': 'Tilt',
  'tracking': 'Tracking',
  'static': 'Static',
  'handheld': 'Handheld',
};

// ── Parser ───────────────────────────────────────────────────────────────

/**
 * Parse a Markdown script into structured scenes and metadata.
 *
 * @param markdown - The raw Markdown text of the script.
 * @returns Parsed scenes, character list, and line count.
 */
export function parseMarkdownScript(markdown: string): MarkdownParseResult {
  const lines = markdown.split('\n');
  const scenes: ParsedScene[] = [];
  const characterSet = new Set<string>();

  let currentScene: ParsedScene | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for scene heading
    const sceneMatch = line.match(SCENE_HEADING_RE);
    if (sceneMatch) {
      // Close previous scene
      if (currentScene) {
        currentScene.endLine = lineNum - 1;
        scenes.push(currentScene);
      }
      const rawHeading = sceneMatch[1].trim();
      // Strip the keyword prefix (场景1, Scene 2, 第一幕) if followed by descriptive text
      const colonIdx = rawHeading.search(/[：:]/);
      const heading = colonIdx >= 0 ? rawHeading.slice(colonIdx + 1).trim() : rawHeading;
      currentScene = {
        id: generateUUID(),
        heading: heading || `场景 ${scenes.length + 1}`,
        level: (line.match(/^(#+)/)?.[1].length ?? 2),
        content: '',
        startLine: lineNum,
        endLine: lineNum,
      };
      continue;
    }

    // Check for generic section heading (may be a scene if no explicit scene markers)
    const sectionMatch = line.match(SECTION_HEADING_RE);
    if (sectionMatch && !currentScene && scenes.length === 0) {
      // First heading without explicit scene marker — treat as scene
      currentScene = {
        id: generateUUID(),
        heading: sectionMatch[1].trim(),
        level: (line.match(/^(#+)/)?.[1].length ?? 2),
        content: '',
        startLine: lineNum,
        endLine: lineNum,
      };
      continue;
    }

    // Extract character names from dialogue
    const dialogueMatch = line.match(DIALOGUE_RE);
    if (dialogueMatch) {
      const name = (dialogueMatch[1] || dialogueMatch[2]).trim();
      if (name) {
        characterSet.add(name);
      }
    }

    // Accumulate content for current scene
    if (currentScene) {
      currentScene.content += line + '\n';
      currentScene.endLine = lineNum;
    }
  }

  // Close last scene
  if (currentScene) {
    currentScene.endLine = lines.length;
    scenes.push(currentScene);
  }

  // If no scenes were found, create a single scene from the entire content
  if (scenes.length === 0 && markdown.trim()) {
    scenes.push({
      id: generateUUID(),
      heading: '剧本',
      level: 1,
      content: markdown,
      startLine: 1,
      endLine: lines.length,
    });
  }

  return {
    scenes,
    characters: [...characterSet],
    totalLines: lines.length,
  };
}

/**
 * Extract dialogue lines from a scene's content.
 */
export function extractDialogue(content: string): ParsedDialogue[] {
  const lines = content.split('\n');
  const dialogues: ParsedDialogue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(DIALOGUE_RE);
    if (match) {
      dialogues.push({
        characterName: (match[1] || match[2]).trim(),
        text: match[3].trim(),
        line: i + 1,
      });
    }
  }

  return dialogues;
}

/**
 * Extract camera/shot instructions from text content.
 */
export function extractShotInstructions(text: string): ParsedShotInstruction[] {
  const instructions: ParsedShotInstruction[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  SHOT_INSTRUCTION_RE.lastIndex = 0;
  while ((match = SHOT_INSTRUCTION_RE.exec(text)) !== null) {
    const key = match[1].trim();
    const value = match[2].trim();

    // Classify based on the key (category label) first, then fall back to
    // keyword matching against the value.
    if (
      key.includes('景别') ||
      key.includes('shot') ||
      key.toLowerCase().includes('size')
    ) {
      instructions.push({ type: 'shot-size', value: SHOT_SIZE_KEYWORDS[value] || value, line: 0 });
    } else if (
      key.includes('镜头') ||
      key.includes('camera') ||
      key.toLowerCase().includes('movement')
    ) {
      instructions.push({ type: 'camera-movement', value: CAMERA_MOVEMENT_KEYWORDS[value] || value, line: 0 });
    } else if (key.includes('时长') || key.toLowerCase().includes('duration')) {
      instructions.push({ type: 'duration', value, line: 0 });
    } else if (key.includes('技法') || key.toLowerCase().includes('technique')) {
      instructions.push({ type: 'technique', value, line: 0 });
    } else {
      // Fallback: try matching value against all keyword maps
      if (Object.keys(SHOT_SIZE_KEYWORDS).some((k) => value.includes(k))) {
        instructions.push({ type: 'shot-size', value: SHOT_SIZE_KEYWORDS[value] || value, line: 0 });
      } else if (Object.keys(CAMERA_MOVEMENT_KEYWORDS).some((k) => value.includes(k))) {
        instructions.push({ type: 'camera-movement', value: CAMERA_MOVEMENT_KEYWORDS[value] || value, line: 0 });
      }
    }
  }

  return instructions;
}

/**
 * Convert parsed scenes into Shot objects for blueprint conversion.
 *
 * Each scene generates one or more shots based on dialogue turns and
 * action descriptions. Scenes without dialogue generate a single shot
 * with the full scene content as the action summary.
 *
 * @param parseResult - The result of parsing a Markdown script.
 * @param episodeId - Optional episode ID for multi-episode scripts.
 * @returns Array of Shot objects ready for blueprint conversion.
 */
export function scenesToShots(
  parseResult: MarkdownParseResult,
  episodeId?: string,
): Shot[] {
  const shots: Shot[] = [];
  let shotIndex = 0;

  for (const scene of parseResult.scenes) {
    const dialogues = extractDialogue(scene.content);
    const instructions = extractShotInstructions(scene.content);

    // Extract shot-level metadata from bracket instructions
    const shotSize = instructions.find((i) => i.type === 'shot-size')?.value;
    const cameraMovement = instructions.find((i) => i.type === 'camera-movement')?.value;

    if (dialogues.length === 0) {
      // No dialogue — one shot for the entire scene
      const shot = createShotFromScene(
        scene,
        shotIndex,
        episodeId,
        scene.content.trim(),
        shotSize,
        cameraMovement,
      );
      shots.push(shot);
      shotIndex++;
    } else {
      // Group content by dialogue turns
      const contentLines = scene.content.split('\n');
      let currentBlock: string[] = [];
      let currentCharacter: string | null = null;

      const flushBlock = () => {
        const actionText = currentBlock
          .filter((l) => !l.match(DIALOGUE_RE))
          .join('\n')
          .trim();

        const shot = createShotFromScene(
          scene,
          shotIndex,
          episodeId,
          actionText || `${currentCharacter} 的镜头`,
          shotSize,
          cameraMovement,
          currentCharacter ? [currentCharacter] : undefined,
          currentCharacter ? currentBlock.find((l) => l.match(DIALOGUE_RE))?.match(DIALOGUE_RE)?.[3]?.trim() : undefined,
        );
        shots.push(shot);
        shotIndex++;
        currentBlock = [];
      };

      for (const line of contentLines) {
        const dialogueMatch = line.match(DIALOGUE_RE);
        if (dialogueMatch) {
          // Flush previous block if character changes
          if (currentBlock.length > 0) {
            flushBlock();
          }
          currentCharacter = (dialogueMatch[1] || dialogueMatch[2]).trim();
        }
        currentBlock.push(line);
      }

      // Flush last block
      if (currentBlock.length > 0) {
        flushBlock();
      }
    }
  }

  return shots;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function createShotFromScene(
  scene: ParsedScene,
  index: number,
  episodeId: string | undefined,
  actionSummary: string,
  shotSize?: string,
  cameraMovement?: string,
  characterNames?: string[],
  dialogue?: string,
): Shot {
  return {
    id: generateUUID(),
    index,
    episodeId,
    sceneRefId: scene.id,
    actionSummary: actionSummary.slice(0, 500), // cap length
    visualDescription: actionSummary.slice(0, 1000),
    shotSize,
    cameraMovement,
    characterNames,
    characterIds: [],
    characterVariations: {},
    dialogue,
    imageStatus: 'idle',
    imageProgress: 0,
    videoStatus: 'idle',
    videoProgress: 0,
  };
}
