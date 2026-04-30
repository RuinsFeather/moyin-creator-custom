// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Generation Panel - Left column
 * Character generation controls: style, views, description, reference images
 */

import { useState, useEffect } from "react";
import { useCharacterLibraryStore, type Character } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import type { CharacterIdentityAnchors, CharacterNegativePrompt, PromptLanguage } from "@/types/script";
import { useActiveScriptProject } from "@/stores/script-store";
import { useMediaPanelStore } from "@/stores/media-panel-store";
import { useMediaStore } from "@/stores/media-store";
import { saveImageToLocal } from "@/lib/image-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { 
  Loader2,
  ImagePlus,
  X,
  FileImage,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Copy,
  UploadCloud,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getStyleById, getStylePrompt, type VisualStyleId, DEFAULT_STYLE_ID } from "@/lib/constants/visual-styles";

// Gender presets
const GENDER_PRESETS = [
  { id: "male", label: "男" },
  { id: "female", label: "女" },
  { id: "other", label: "其他" },
] as const;

// Age presets
const AGE_PRESETS = [
  { id: "child", label: "儿童", range: "5-12岁" },
  { id: "teen", label: "青少年", range: "13-18岁" },
  { id: "young-adult", label: "青年", range: "19-30岁" },
  { id: "adult", label: "中年", range: "31-50岁" },
  { id: "senior", label: "老年", range: "50岁以上" },
] as const;

// Sheet elements
const SHEET_ELEMENTS = [
  { id: 'three-view', label: '三视图', prompt: 'front view, side view, back view, turnaround', default: true },
  { id: 'expressions', label: '表情设定', prompt: 'expression sheet, multiple facial expressions, happy, sad, angry, surprised', default: true },
  { id: 'proportions', label: '比例设定', prompt: 'height chart, body proportions, head-to-body ratio reference', default: false },
  { id: 'poses', label: '动作设定', prompt: 'pose sheet, various action poses, standing, sitting, running', default: false },
] as const;

type SheetElementId = typeof SHEET_ELEMENTS[number]['id'];

interface GenerationPanelProps {
  selectedCharacter: Character | null;
  onCharacterCreated?: (id: string) => void;
}

export function GenerationPanel({ selectedCharacter, onCharacterCreated }: GenerationPanelProps) {
  const { 
    addCharacter, 
    updateCharacter,
    addCharacterView,
    selectCharacter,
    generationStatus,
    generatingCharacterId,
    currentFolderId,
  } = useCharacterLibraryStore();
  const { activeProjectId } = useProjectStore();
  const scriptProject = useActiveScriptProject();
  
  const { pendingCharacterData, setPendingCharacterData } = useMediaPanelStore();
  const { addMediaFromUrl, getOrCreateCategoryFolder } = useMediaStore();
  
  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [gender, setGender] = useState<string>("");
  const [age, setAge] = useState<string>("");
  const [personality, setPersonality] = useState("");
  // Extended character fields (from script panel)
  const [role, setRole] = useState("");
  const [traits, setTraits] = useState("");
  const [skills, setSkills] = useState("");
  const [keyActions, setKeyActions] = useState("");
  const [appearance, setAppearance] = useState("");
  const [relationships, setRelationships] = useState(""); // 人物关系
  const [tags, setTags] = useState<string[]>([]);  // 角色标签
  const [notes, setNotes] = useState("");           // 角色备注
  // === 专业角色设计字段（世界级大师生成）===
  const [visualPromptEn, setVisualPromptEn] = useState(""); // 英文视觉提示词
  const [visualPromptZh, setVisualPromptZh] = useState(""); // 中文视觉提示词
  // === 6层身份锚点 ===
  const [identityAnchors, setIdentityAnchors] = useState<CharacterIdentityAnchors | undefined>();
  const [charNegativePrompt, setCharNegativePrompt] = useState<CharacterNegativePrompt | undefined>();
  // === 提示词语言偏好 ===
  const [promptLanguage, setPromptLanguage] = useState<PromptLanguage>('zh');
  // === 年代信息（从剧本元数据传递）===
  const [storyYear, setStoryYear] = useState<number | undefined>();
  const [era, setEra] = useState<string | undefined>();
  // === 集作用域（从 pending 数据透传）===
  const [sourceEpisodeId, setSourceEpisodeId] = useState<string | undefined>();
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [isDraggingDesignImage, setIsDraggingDesignImage] = useState(false);
  const [styleId, setStyleId] = useState<string>(DEFAULT_STYLE_ID);
  const [selectedElements, setSelectedElements] = useState<SheetElementId[]>(
    SHEET_ELEMENTS.filter(e => e.default).map(e => e.id)
  );
  
  // AI 校准信息折叠区状态：有数据时默认展开
  const [calibrationExpanded, setCalibrationExpanded] = useState(true);
  const [isManuallyModified, setIsManuallyModified] = useState(false);

  const isGenerating = generationStatus === 'generating';
  
  // 检查是否有 AI 校准数据
  const hasCalibrationData = !!(identityAnchors || charNegativePrompt || visualPromptEn || visualPromptZh);

  // 注意：左边栏始终用于新建角色，不响应中间角色库的选择
  // 右边栏用于查看/编辑已有角色的详情

  // Handle pending data from script panel
  useEffect(() => {
    if (pendingCharacterData) {
      setName(pendingCharacterData.name || "");
      
      // 映射性别："男" -> "male", "女" -> "female"
      const genderMap: Record<string, string> = {
        '男': 'male', '男性': 'male', 'male': 'male', 'Male': 'male',
        '女': 'female', '女性': 'female', 'female': 'female', 'Female': 'female',
      };
      const mappedGender = genderMap[pendingCharacterData.gender || ''] || '';
      setGender(mappedGender);
      
      // 映射年龄：根据数字范围自动选择年龄段
      const ageStr = pendingCharacterData.age || '';
      let mappedAge = '';
      if (ageStr.includes('5') && ageStr.includes('12') || ageStr.includes('儿童')) {
        mappedAge = 'child';
      } else if (ageStr.includes('13') || ageStr.includes('18') || ageStr.includes('青少年')) {
        mappedAge = 'teen';
      } else if (ageStr.includes('19') || ageStr.includes('20') || ageStr.includes('25') || ageStr.includes('30') || ageStr.includes('青年')) {
        mappedAge = 'young-adult';
      } else if (ageStr.includes('35') || ageStr.includes('40') || ageStr.includes('45') || ageStr.includes('50') || ageStr.includes('中年')) {
        mappedAge = 'adult';
      } else if (ageStr.includes('55') || ageStr.includes('60') || ageStr.includes('70') || ageStr.includes('老年')) {
        mappedAge = 'senior';
      } else if (ageStr.match(/\d+.*\d+/)) {
        // 跨年龄段如 "25-50岁"，选择中年
        mappedAge = 'adult';
      }
      setAge(mappedAge);
      
      setPersonality(pendingCharacterData.personality || "");
      
      // Store extended fields independently
      setRole(pendingCharacterData.role || "");
      setTraits(pendingCharacterData.traits || "");
      setSkills(pendingCharacterData.skills || "");
      setKeyActions(pendingCharacterData.keyActions || "");
      setAppearance(pendingCharacterData.appearance || "");
      setRelationships(pendingCharacterData.relationships || "");
      
      // Also build description for display/generation prompt
      const descParts: string[] = [];
      if (pendingCharacterData.role) descParts.push(`【身份/背景】\n${pendingCharacterData.role}`);
      if (pendingCharacterData.traits) descParts.push(`【核心特质】\n${pendingCharacterData.traits}`);
      if (pendingCharacterData.skills) descParts.push(`【技能/能力】\n${pendingCharacterData.skills}`);
      if (pendingCharacterData.keyActions) descParts.push(`【关键事迹】\n${pendingCharacterData.keyActions}`);
      if (pendingCharacterData.appearance) descParts.push(`【外貌特征】\n${pendingCharacterData.appearance}`);
      if (pendingCharacterData.relationships) descParts.push(`【人物关系】\n${pendingCharacterData.relationships}`);
      if (descParts.length > 0) {
        setDescription(descParts.join("\n\n"));
      }

      // 处理标签和备注
      if (pendingCharacterData.tags) {
        setTags(pendingCharacterData.tags);
      }
      if (pendingCharacterData.notes) {
        setNotes(pendingCharacterData.notes);
      }
      
      // === 处理提示词语言偏好 ===
      if (pendingCharacterData.promptLanguage) {
        setPromptLanguage(pendingCharacterData.promptLanguage);
      }
      // === 处理专业视觉提示词（世界级大师生成）===
      if (pendingCharacterData.visualPromptEn) {
        setVisualPromptEn(pendingCharacterData.visualPromptEn);
      }
      if (pendingCharacterData.visualPromptZh) {
        setVisualPromptZh(pendingCharacterData.visualPromptZh);
      }
      
      // === 处理6层身份锚点 ===
      if (pendingCharacterData.identityAnchors) {
        setIdentityAnchors(pendingCharacterData.identityAnchors);
      }
      if (pendingCharacterData.negativePrompt) {
        setCharNegativePrompt(pendingCharacterData.negativePrompt);
      }
      
      // === 处理年代信息 ===
      if (pendingCharacterData.storyYear) {
        setStoryYear(pendingCharacterData.storyYear);
      }
      if (pendingCharacterData.era) {
        setEra(pendingCharacterData.era);
      }
      // === 集作用域透传 ===
      setSourceEpisodeId(pendingCharacterData.sourceEpisodeId);

      if (pendingCharacterData.styleId) {
        const validStyle = getStyleById(pendingCharacterData.styleId);
        if (validStyle) {
          setStyleId(validStyle.id);
        }
      }
      
      // TODO: 处理多阶段角色变体
      // 如果有 stageInfo 或 consistencyElements，应该：
      // 1. 在角色描述中提示用户这是多阶段角色
      // 2. 生成角色后自动为其添加 variations
      // 注：这部分逻辑应该在 handleCreateAndGenerate 后执行

      setPendingCharacterData(null);
    }
  }, [pendingCharacterData, setPendingCharacterData]);

  const toggleElement = (elementId: SheetElementId) => {
    setSelectedElements(prev => 
      prev.includes(elementId) 
        ? prev.filter(e => e !== elementId)
        : [...prev, elementId]
    );
  };

  const addDesignImages = async (files: FileList | File[]) => {
    if (!files) return;

    const newImages: string[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      if (referenceImages.length + newImages.length >= 3) break;
      try {
        const base64 = await fileToBase64(file);
        newImages.push(base64);
      } catch (err) {
        console.error("Failed to convert image:", err);
      }
    }

    if (newImages.length > 0) {
      setReferenceImages([...referenceImages, ...newImages].slice(0, 3));
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    await addDesignImages(files || []);
    e.target.value = "";
  };

  const handleDesignImageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingDesignImage(false);
    await addDesignImages(e.dataTransfer.files);
  };

  const removeImage = (index: number) => {
    setReferenceImages(referenceImages.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setGender("");
    setAge("");
    setPersonality("");
    setRole("");
    setTraits("");
    setSkills("");
    setKeyActions("");
    setAppearance("");
    setRelationships("");
    setTags([]);
    setNotes("");
    // === 重置专业视觉提示词 ===
    setVisualPromptEn("");
    setVisualPromptZh("");
    // === 重置6层身份锚点 ===
    setIdentityAnchors(undefined);
    setCharNegativePrompt(undefined);
    // === 重置年代信息 ===
    setStoryYear(undefined);
    setEra(undefined);
    // === 重置集作用域 ===
    setSourceEpisodeId(undefined);
    setReferenceImages([]);
    setStyleId(DEFAULT_STYLE_ID);
    setSelectedElements(SHEET_ELEMENTS.filter(e => e.default).map(e => e.id));
    // === 重置 AI 校准状态 ===
    setCalibrationExpanded(false);
    setIsManuallyModified(false);
  };

  // 创建新角色（始终新建，不会覆盖已有角色）
  const handleCreateAndGenerate = async () => {
    if (!name.trim()) {
      toast.error("请输入角色名称");
      return;
    }
    if (!description.trim()) {
      toast.error("请输入角色描述");
      return;
    }
    // 始终创建新角色
    const targetId = addCharacter({
      name: name.trim(),
      description: description.trim(),
      visualTraits: "",
      gender: gender || undefined,
      age: age || undefined,
      personality: personality.trim() || undefined,
      role: role.trim() || undefined,
      traits: traits.trim() || undefined,
      skills: skills.trim() || undefined,
      keyActions: keyActions.trim() || undefined,
      appearance: appearance.trim() || undefined,
      relationships: relationships.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      notes: notes.trim() || undefined,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      styleId: styleId === "random" ? undefined : styleId,
      views: [],
      folderId: currentFolderId,
      projectId: activeProjectId || undefined,
      // === 6层身份锚点（角色一致性）===
      identityAnchors: identityAnchors,
      negativePrompt: charNegativePrompt,
      // === 集作用域 ===
      linkedEpisodeId: sourceEpisodeId,
    });
    selectCharacter(targetId);
    onCharacterCreated?.(targetId);
    if (referenceImages.length > 0) {
      toast.loading("正在保存人物设定图...", { id: 'saving-character-design' });
      try {
        const localPath = await saveImageToLocal(
          referenceImages[0],
          'characters',
          `${name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_${Date.now()}.png`
        );
        addCharacterView(targetId, { viewType: 'front', imageUrl: localPath });

        const aiFolderId = getOrCreateCategoryFolder('ai-image');
        addMediaFromUrl({
          url: localPath,
          name: `角色-${name || '未命名'}-设定图`,
          type: 'image',
          source: 'ai-image',
          folderId: aiFolderId,
          projectId: activeProjectId || undefined,
        });
        toast.success("角色已创建，人物设定图已保存", { id: 'saving-character-design' });
      } catch (error) {
        console.error('Failed to save character design image:', error);
        toast.error("角色已创建，但设定图保存失败", { id: 'saving-character-design' });
      }
    } else {
      toast.success("角色已创建，可在详情页的“生成图像”中生成设定图");
    }

    resetForm();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-3 pb-2 border-b shrink-0">
        <h3 className="font-medium text-sm">角色创作台</h3>
      </div>
      
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3 space-y-4">
          {/* Character name */}
          <div className="space-y-2">
            <Label className="text-xs">角色名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：小明、机器猫"
              disabled={isGenerating}
            />
          </div>

          {/* Gender and Age */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-xs">性别</Label>
              <Select value={gender} onValueChange={setGender} disabled={isGenerating}>
                <SelectTrigger>
                  <SelectValue placeholder="选择" />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_PRESETS.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">年龄段</Label>
              <Select value={age} onValueChange={setAge} disabled={isGenerating}>
                <SelectTrigger>
                  <SelectValue placeholder="选择" />
                </SelectTrigger>
                <SelectContent>
                  {AGE_PRESETS.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Personality */}
          <div className="space-y-2">
            <Label className="text-xs">性格特征</Label>
            <Input
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="开朗、勇敢..."
              disabled={isGenerating}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label className="text-xs">角色描述</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="详细描述角色外观..."
              className="min-h-[80px] text-sm resize-none"
              disabled={isGenerating}
            />
          </div>

          {/* AI 校准信息折叠区 */}
          {hasCalibrationData && (
            <div className="border rounded-lg overflow-hidden">
              {/* 折叠区头部 */}
              <button
                type="button"
                className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                onClick={() => setCalibrationExpanded(!calibrationExpanded)}
                disabled={isGenerating}
              >
                <div className="flex items-center gap-2">
                  {calibrationExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-xs font-medium">AI 校准信息</span>
                </div>
                <div className="flex items-center gap-1">
                  {isManuallyModified ? (
                    <>
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      <span className="text-[10px] text-amber-500">已修改</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      <span className="text-[10px] text-green-500">已校准</span>
                    </>
                  )}
                </div>
              </button>
              
              {/* 折叠区内容 */}
              {calibrationExpanded && (
                <div className="border-t p-2 space-y-3 bg-muted/20">
                  {/* 6层身份锚点 */}
                  {identityAnchors && (
                    <div className="space-y-2">
                      <Label className="text-[10px] text-muted-foreground">① 骨相层</Label>
                      <div className="grid grid-cols-3 gap-1">
                        <Input
                          value={identityAnchors.faceShape || ''}
                          onChange={(e) => {
                            setIdentityAnchors({ ...identityAnchors, faceShape: e.target.value || undefined });
                            setIsManuallyModified(true);
                          }}
                          placeholder="脸型"
                          className="h-7 text-[10px]"
                          disabled={isGenerating}
                        />
                        <Input
                          value={identityAnchors.jawline || ''}
                          onChange={(e) => {
                            setIdentityAnchors({ ...identityAnchors, jawline: e.target.value || undefined });
                            setIsManuallyModified(true);
                          }}
                          placeholder="下颂"
                          className="h-7 text-[10px]"
                          disabled={isGenerating}
                        />
                        <Input
                          value={identityAnchors.cheekbones || ''}
                          onChange={(e) => {
                            setIdentityAnchors({ ...identityAnchors, cheekbones: e.target.value || undefined });
                            setIsManuallyModified(true);
                          }}
                          placeholder="颚骨"
                          className="h-7 text-[10px]"
                          disabled={isGenerating}
                        />
                      </div>
                      
                      <Label className="text-[10px] text-muted-foreground">② 五官层</Label>
                      <div className="grid grid-cols-2 gap-1">
                        <Input
                          value={identityAnchors.eyeShape || ''}
                          onChange={(e) => {
                            setIdentityAnchors({ ...identityAnchors, eyeShape: e.target.value || undefined });
                            setIsManuallyModified(true);
                          }}
                          placeholder="眼型"
                          className="h-7 text-[10px]"
                          disabled={isGenerating}
                        />
                        <Input
                          value={identityAnchors.noseShape || ''}
                          onChange={(e) => {
                            setIdentityAnchors({ ...identityAnchors, noseShape: e.target.value || undefined });
                            setIsManuallyModified(true);
                          }}
                          placeholder="鼻型"
                          className="h-7 text-[10px]"
                          disabled={isGenerating}
                        />
                        <Input
                          value={identityAnchors.lipShape || ''}
                          onChange={(e) => {
                            setIdentityAnchors({ ...identityAnchors, lipShape: e.target.value || undefined });
                            setIsManuallyModified(true);
                          }}
                          placeholder="唇型"
                          className="h-7 text-[10px]"
                          disabled={isGenerating}
                        />
                        <Input
                          value={identityAnchors.eyeDetails || ''}
                          onChange={(e) => {
                            setIdentityAnchors({ ...identityAnchors, eyeDetails: e.target.value || undefined });
                            setIsManuallyModified(true);
                          }}
                          placeholder="眼部细节"
                          className="h-7 text-[10px]"
                          disabled={isGenerating}
                        />
                      </div>
                      
                      <Label className="text-[10px] text-muted-foreground">③ 辨识标记层（最强锚点）</Label>
                      <Input
                        value={identityAnchors.uniqueMarks?.join(', ') || ''}
                        onChange={(e) => {
                          const marks = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setIdentityAnchors({ ...identityAnchors, uniqueMarks: marks.length > 0 ? marks : [] });
                          setIsManuallyModified(true);
                        }}
                        placeholder="特征标记，用逗号分隔"
                        className="h-7 text-[10px]"
                        disabled={isGenerating}
                      />
                      
                      <Label className="text-[10px] text-muted-foreground">④ 色彩锚点层（Hex色值）</Label>
                      <div className="grid grid-cols-4 gap-1">
                        <div className="flex items-center gap-1">
                          <input
                            type="color"
                            value={identityAnchors.colorAnchors?.iris || '#000000'}
                            onChange={(e) => {
                              setIdentityAnchors({
                                ...identityAnchors,
                                colorAnchors: { ...identityAnchors.colorAnchors, iris: e.target.value }
                              });
                              setIsManuallyModified(true);
                            }}
                            className="w-6 h-6 rounded cursor-pointer"
                            disabled={isGenerating}
                          />
                          <span className="text-[9px] text-muted-foreground">瞳</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="color"
                            value={identityAnchors.colorAnchors?.hair || '#000000'}
                            onChange={(e) => {
                              setIdentityAnchors({
                                ...identityAnchors,
                                colorAnchors: { ...identityAnchors.colorAnchors, hair: e.target.value }
                              });
                              setIsManuallyModified(true);
                            }}
                            className="w-6 h-6 rounded cursor-pointer"
                            disabled={isGenerating}
                          />
                          <span className="text-[9px] text-muted-foreground">发</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="color"
                            value={identityAnchors.colorAnchors?.skin || '#000000'}
                            onChange={(e) => {
                              setIdentityAnchors({
                                ...identityAnchors,
                                colorAnchors: { ...identityAnchors.colorAnchors, skin: e.target.value }
                              });
                              setIsManuallyModified(true);
                            }}
                            className="w-6 h-6 rounded cursor-pointer"
                            disabled={isGenerating}
                          />
                          <span className="text-[9px] text-muted-foreground">肤</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="color"
                            value={identityAnchors.colorAnchors?.lips || '#000000'}
                            onChange={(e) => {
                              setIdentityAnchors({
                                ...identityAnchors,
                                colorAnchors: { ...identityAnchors.colorAnchors, lips: e.target.value }
                              });
                              setIsManuallyModified(true);
                            }}
                            className="w-6 h-6 rounded cursor-pointer"
                            disabled={isGenerating}
                          />
                          <span className="text-[9px] text-muted-foreground">唇</span>
                        </div>
                      </div>
                      
                      <Label className="text-[10px] text-muted-foreground">⑤ 皮肤纹理层</Label>
                      <Input
                        value={identityAnchors.skinTexture || ''}
                        onChange={(e) => {
                          setIdentityAnchors({ ...identityAnchors, skinTexture: e.target.value || undefined });
                          setIsManuallyModified(true);
                        }}
                        placeholder="皮肤纹理描述"
                        className="h-7 text-[10px]"
                        disabled={isGenerating}
                      />
                      
                      <Label className="text-[10px] text-muted-foreground">⑥ 发型锚点层</Label>
                      <div className="grid grid-cols-2 gap-1">
                        <Input
                          value={identityAnchors.hairStyle || ''}
                          onChange={(e) => {
                            setIdentityAnchors({ ...identityAnchors, hairStyle: e.target.value || undefined });
                            setIsManuallyModified(true);
                          }}
                          placeholder="发型"
                          className="h-7 text-[10px]"
                          disabled={isGenerating}
                        />
                        <Input
                          value={identityAnchors.hairlineDetails || ''}
                          onChange={(e) => {
                            setIdentityAnchors({ ...identityAnchors, hairlineDetails: e.target.value || undefined });
                            setIsManuallyModified(true);
                          }}
                          placeholder="发际线细节"
                          className="h-7 text-[10px]"
                          disabled={isGenerating}
                        />
                      </div>
                    </div>
                  )}
                  
                  {/* 负面提示词 */}
                  {charNegativePrompt && (
                    <div className="space-y-2 pt-2 border-t">
                      <Label className="text-[10px] text-muted-foreground">负面提示词</Label>
                      <Input
                        value={charNegativePrompt.avoid?.join(', ') || ''}
                        onChange={(e) => {
                          const avoidList = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setCharNegativePrompt({ ...charNegativePrompt, avoid: avoidList });
                          setIsManuallyModified(true);
                        }}
                        placeholder="避免元素，用逗号分隔"
                        className="h-7 text-[10px]"
                        disabled={isGenerating}
                      />
                      <Input
                        value={charNegativePrompt.styleExclusions?.join(', ') || ''}
                        onChange={(e) => {
                          const exclusions = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setCharNegativePrompt({ ...charNegativePrompt, styleExclusions: exclusions.length > 0 ? exclusions : undefined });
                          setIsManuallyModified(true);
                        }}
                        placeholder="风格排除，用逗号分隔"
                        className="h-7 text-[10px]"
                        disabled={isGenerating}
                      />
                    </div>
                  )}
                  
                  {/* 专业视觉提示词：根据语言偏好只展示一种，编辑后直接用于生成 */}
                  {(() => {
                    const effectiveLang = promptLanguage || scriptProject?.promptLanguage || 'zh';
                    const showZh = effectiveLang === 'zh' || effectiveLang === 'zh+en';
                    const activePrompt = showZh ? visualPromptZh : visualPromptEn;
                    const setActivePrompt = showZh ? setVisualPromptZh : setVisualPromptEn;
                    const langLabel = showZh ? '中文' : '英文';
                    if (!activePrompt) return null;
                    return (
                      <div className="space-y-2 pt-2 border-t">
                        <Label className="text-[10px] text-muted-foreground">
                          视觉提示词（{langLabel}，修改后直接用于生成）
                        </Label>
                        <Textarea
                          value={activePrompt}
                          onChange={(e) => {
                            setActivePrompt(e.target.value);
                            setIsManuallyModified(true);
                          }}
                          placeholder={`${langLabel}提示词`}
                          className="min-h-[120px] text-xs resize-y"
                          disabled={isGenerating}
                        />
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Character design image upload */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">人物设定图</Label>
              <span className="text-xs text-muted-foreground">{referenceImages.length}/3</span>
            </div>
            <div
              className={cn(
                "rounded-lg border-2 border-dashed p-3 transition-colors",
                isDraggingDesignImage ? "border-primary bg-primary/5" : "border-muted-foreground/25",
                isGenerating && "opacity-50 pointer-events-none"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingDesignImage(true);
              }}
              onDragLeave={() => setIsDraggingDesignImage(false)}
              onDrop={handleDesignImageDrop}
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <UploadCloud className="h-4 w-4" />
                <span>拖拽上传人物设定图，或点击下方上传。第一张将作为角色主设定图。</span>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {referenceImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={img}
                    alt={`人物设定图 ${i + 1}`}
                    className="w-14 h-14 object-cover rounded-md border"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {referenceImages.length < 3 && (
                <>
                  <input
                    id="gen-panel-ref-image"
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageChange}
                  />
                  <div
                    className="w-14 h-14 border-2 border-dashed rounded-md flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors gap-1 cursor-pointer"
                    onClick={() => document.getElementById('gen-panel-ref-image')?.click()}
                  >
                    <ImagePlus className="h-4 w-4" />
                    <span className="text-[10px]">上传</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Action button - inside scroll area */}
          <div className="pt-2 pb-4 space-y-2">
            <Button 
              onClick={handleCreateAndGenerate} 
              className="w-full"
              disabled={isGenerating || !name.trim() || !description.trim()}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <FileImage className="h-4 w-4 mr-2" />
                  创建此角色
                </>
              )}
            </Button>
            
            {/* 复制角色数据按钮 */}
            <Button 
              variant="outline"
              onClick={() => {
                // 构建角色数据文本
                const lines: string[] = [];
                
                // 基本信息
                lines.push(`角色名称: ${name || '(未填写)'}`);
                const genderLabel = GENDER_PRESETS.find(g => g.id === gender)?.label;
                if (genderLabel) lines.push(`性别: ${genderLabel}`);
                const ageLabel = AGE_PRESETS.find(a => a.id === age)?.label;
                if (ageLabel) lines.push(`年龄段: ${ageLabel}`);
                if (personality) lines.push(`性格特征: ${personality}`);
                
                // 角色描述
                if (description) {
                  lines.push('');
                  lines.push(`角色描述:`);
                  lines.push(description);
                }
                
                // AI 校准信息
                if (hasCalibrationData) {
                  lines.push('');
                  lines.push(`AI 校准信息: ${isManuallyModified ? '已修改' : '已校准'}`);
                  
                  // 6层身份锚点
                  if (identityAnchors) {
                    lines.push('');
                    lines.push('--- 6层身份锚点 ---');
                    
                    // ① 骨相层
                    const boneFeatures = [identityAnchors.faceShape, identityAnchors.jawline, identityAnchors.cheekbones].filter(Boolean);
                    if (boneFeatures.length > 0) {
                      lines.push(`① 骨相层: ${boneFeatures.join(', ')}`);
                    }
                    
                    // ② 五官层
                    const facialFeatures = [identityAnchors.eyeShape, identityAnchors.eyeDetails, identityAnchors.noseShape, identityAnchors.lipShape].filter(Boolean);
                    if (facialFeatures.length > 0) {
                      lines.push(`② 五官层: ${facialFeatures.join(', ')}`);
                    }
                    
                    // ③ 辨识标记层
                    if (identityAnchors.uniqueMarks && identityAnchors.uniqueMarks.length > 0) {
                      lines.push(`③ 辨识标记层: ${identityAnchors.uniqueMarks.join(', ')}`);
                    }
                    
                    // ④ 色彩锚点层
                    if (identityAnchors.colorAnchors) {
                      const colors: string[] = [];
                      if (identityAnchors.colorAnchors.iris) colors.push(`瞳色:${identityAnchors.colorAnchors.iris}`);
                      if (identityAnchors.colorAnchors.hair) colors.push(`发色:${identityAnchors.colorAnchors.hair}`);
                      if (identityAnchors.colorAnchors.skin) colors.push(`肤色:${identityAnchors.colorAnchors.skin}`);
                      if (identityAnchors.colorAnchors.lips) colors.push(`唇色:${identityAnchors.colorAnchors.lips}`);
                      if (colors.length > 0) {
                        lines.push(`④ 色彩锚点层: ${colors.join(', ')}`);
                      }
                    }
                    
                    // ⑤ 皮肤纹理层
                    if (identityAnchors.skinTexture) {
                      lines.push(`⑤ 皮肤纹理层: ${identityAnchors.skinTexture}`);
                    }
                    
                    // ⑥ 发型锚点层
                    const hairFeatures = [identityAnchors.hairStyle, identityAnchors.hairlineDetails].filter(Boolean);
                    if (hairFeatures.length > 0) {
                      lines.push(`⑥ 发型锚点层: ${hairFeatures.join(', ')}`);
                    }
                  }
                  
                  // 负面提示词
                  if (charNegativePrompt) {
                    lines.push('');
                    lines.push('--- 负面提示词 ---');
                    if (charNegativePrompt.avoid && charNegativePrompt.avoid.length > 0) {
                      lines.push(`避免: ${charNegativePrompt.avoid.join(', ')}`);
                    }
                    if (charNegativePrompt.styleExclusions && charNegativePrompt.styleExclusions.length > 0) {
                      lines.push(`风格排除: ${charNegativePrompt.styleExclusions.join(', ')}`);
                    }
                  }
                  
                  // 专业视觉提示词
                  if (visualPromptEn || visualPromptZh) {
                    lines.push('');
                    lines.push('--- 专业视觉提示词 ---');
                    if (visualPromptEn) lines.push(`EN: ${visualPromptEn}`);
                    if (visualPromptZh) lines.push(`ZH: ${visualPromptZh}`);
                  }
                }
                
                // 年代信息
                if (storyYear || era) {
                  lines.push('');
                  lines.push('--- 年代信息 ---');
                  if (storyYear) lines.push(`故事年份: ${storyYear}年`);
                  if (era) lines.push(`时代背景: ${era}`);
                }
                
                // 视觉风格
                const stylePreset = getStyleById(styleId);
                const styleLabel = stylePreset?.name || styleId;
                lines.push('');
                lines.push(`视觉风格: ${styleLabel}`);
                if (stylePreset?.prompt) {
                  lines.push(`风格提示词: ${stylePreset.prompt.substring(0, 100)}...`);
                }
                
                // 参考图片
                if (referenceImages.length > 0) {
                  lines.push(`参考图片: ${referenceImages.length} 张`);
                }
                
                // 生成内容
                const selectedSheetElements = selectedElements.map(id => SHEET_ELEMENTS.find(e => e.id === id)).filter(Boolean);
                if (selectedSheetElements.length > 0) {
                  const labels = selectedSheetElements.map(e => e?.label).join(', ');
                  const prompts = selectedSheetElements.map(e => e?.prompt).join(', ');
                  lines.push(`生成内容: ${labels}`);
                  lines.push(`内容提示词: ${prompts}`);
                }
                
                const text = lines.join('\n');
                navigator.clipboard.writeText(text);
                toast.success('角色数据已复制到剪贴板');
              }}
              className="w-full"
              disabled={isGenerating}
            >
              <Copy className="h-4 w-4 mr-2" />
              复制角色数据
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper functions
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * 从6层身份锚点构建提示词
 * 
 * @param anchors - 6层身份锚点
 * @param hasReferenceImages - 是否有参考图
 * @returns 构建的提示词字符串
 * 
 * 参考图优先级逻辑：
 * - 有参考图时：只使用最强锚点（uniqueMarks + colorAnchors），其他特征由参考图引导
 * - 无参考图时：使用完整的6层特征锁定
 */
function buildPromptFromAnchors(
  anchors: CharacterIdentityAnchors | undefined,
  hasReferenceImages: boolean,
  promptLanguage?: PromptLanguage
): string {
  if (!anchors) return '';

  // 根据锚点值内容自动检测语言（中文锚点值 → 中文连接词）
  const isZh = promptLanguage === 'zh' || /[\u4e00-\u9fff]/.test(anchors.faceShape || anchors.eyeShape || '');

  const parts: string[] = [];

  if (hasReferenceImages) {
    // === 有参考图：只使用最强锚点 ===
    if (anchors.uniqueMarks && anchors.uniqueMarks.length > 0) {
      parts.push(isZh ? `辨识标记：${anchors.uniqueMarks.join('、')}` : `distinctive marks: ${anchors.uniqueMarks.join(', ')}`);
    }

    if (anchors.colorAnchors) {
      const colors: string[] = [];
      if (anchors.colorAnchors.iris) colors.push(isZh ? `瞳色${anchors.colorAnchors.iris}` : `iris color ${anchors.colorAnchors.iris}`);
      if (anchors.colorAnchors.hair) colors.push(isZh ? `发色${anchors.colorAnchors.hair}` : `hair color ${anchors.colorAnchors.hair}`);
      if (anchors.colorAnchors.skin) colors.push(isZh ? `肤色${anchors.colorAnchors.skin}` : `skin tone ${anchors.colorAnchors.skin}`);
      if (colors.length > 0) {
        parts.push(colors.join(isZh ? '，' : ', '));
      }
    }
  } else {
    // === 无参考图：完整6层特征锁定 ===

    // ① 骨相层
    const boneFeatures: string[] = [];
    if (anchors.faceShape) boneFeatures.push(isZh ? `${anchors.faceShape}脸` : `${anchors.faceShape} face`);
    if (anchors.jawline) boneFeatures.push(isZh ? `${anchors.jawline}下颌` : `${anchors.jawline} jawline`);
    if (anchors.cheekbones) boneFeatures.push(isZh ? `${anchors.cheekbones}颧骨` : `${anchors.cheekbones} cheekbones`);
    if (boneFeatures.length > 0) {
      parts.push(boneFeatures.join(isZh ? '，' : ', '));
    }

    // ② 五官层
    const facialFeatures: string[] = [];
    if (anchors.eyeShape) facialFeatures.push(isZh ? `${anchors.eyeShape}眼` : `${anchors.eyeShape} eyes`);
    if (anchors.eyeDetails) facialFeatures.push(anchors.eyeDetails);
    if (anchors.noseShape) facialFeatures.push(anchors.noseShape);
    if (anchors.lipShape) facialFeatures.push(anchors.lipShape);
    if (facialFeatures.length > 0) {
      parts.push(facialFeatures.join(isZh ? '，' : ', '));
    }

    // ③ 辨识标记层
    if (anchors.uniqueMarks && anchors.uniqueMarks.length > 0) {
      parts.push(isZh ? `辨识标记：${anchors.uniqueMarks.join('、')}` : `distinctive marks: ${anchors.uniqueMarks.join(', ')}`);
    }

    // ④ 色彩锚点层
    if (anchors.colorAnchors) {
      const colors: string[] = [];
      if (anchors.colorAnchors.iris) colors.push(isZh ? `瞳色${anchors.colorAnchors.iris}` : `iris ${anchors.colorAnchors.iris}`);
      if (anchors.colorAnchors.hair) colors.push(isZh ? `发色${anchors.colorAnchors.hair}` : `hair ${anchors.colorAnchors.hair}`);
      if (anchors.colorAnchors.skin) colors.push(isZh ? `肤色${anchors.colorAnchors.skin}` : `skin ${anchors.colorAnchors.skin}`);
      if (anchors.colorAnchors.lips) colors.push(isZh ? `唇色${anchors.colorAnchors.lips}` : `lips ${anchors.colorAnchors.lips}`);
      if (colors.length > 0) {
        parts.push(isZh ? `色彩锚点：${colors.join('，')}` : `color anchors: ${colors.join(', ')}`);
      }
    }

    // ⑤ 皮肤纹理层
    if (anchors.skinTexture) {
      parts.push(isZh ? `皮肤纹理：${anchors.skinTexture}` : `skin texture: ${anchors.skinTexture}`);
    }

    // ⑥ 发型锚点层
    const hairFeatures: string[] = [];
    if (anchors.hairStyle) hairFeatures.push(anchors.hairStyle);
    if (anchors.hairlineDetails) hairFeatures.push(anchors.hairlineDetails);
    if (hairFeatures.length > 0) {
      parts.push(isZh ? `发型：${hairFeatures.join('，')}` : `hair: ${hairFeatures.join(', ')}`);
    }
  }

  return parts.join(isZh ? '，' : ', ');
}

/**
 * 构建角色设定图提示词
 * 
 * 优先级：
 * 1. 根据 promptLanguage 选择主提示词：zh→visualPromptZh, en→visualPromptEn, zh+en→两者合并
 * 2. 有参考图 + 有锚点：简化描述 + 最强锚点
 * 3. 无参考图 + 有锚点：完整6层锁定
 * 4. 有视觉提示词：使用AI大师生成的提示词
 * 5. 只有description：使用基础描述
 * 6. 年代信息：加入服装风格锚点
 */
function buildCharacterSheetPrompt(
  description: string, 
  name: string, 
  selectedElements: SheetElementId[],
  styleId?: string,
  visualPromptEn?: string,
  visualPromptZh?: string,
  promptLanguage?: PromptLanguage,
  identityAnchors?: CharacterIdentityAnchors,
  hasReferenceImages?: boolean,
  storyYear?: number,
  era?: string
): string {
  const stylePreset = styleId && styleId !== 'random' 
    ? getStyleById(styleId) 
    : null;
  // 修复：自定义风格 prompt 为空时用风格名称兜底，而不是回退到 anime
  const styleTokens = stylePreset
    ? (stylePreset.prompt || `${stylePreset.name} style, professional quality`)
    : 'anime style, professional quality';
  const isRealistic = stylePreset?.category === 'real';
  
  // 根据语言偏好选择主视觉提示词
  const lang = promptLanguage || 'zh';

  // 构建年代服装提示词（根据语言偏好）
  let eraPrompt = '';
  if (storyYear) {
    if (lang === 'zh') {
      if (storyYear >= 2020) eraPrompt = `${storyYear}年代当代中国时尚，现代休闲风`;
      else if (storyYear >= 2010) eraPrompt = `${storyYear}年代中国时尚，韩风影响`;
      else if (storyYear >= 2000) eraPrompt = `2000年代初期中国时尚，千禧年服饰`;
      else if (storyYear >= 1990) eraPrompt = `1990年代中国时尚，转型期服饰`;
      else if (storyYear >= 1980) eraPrompt = `1980年代中国时尚，改革开放时期服饰`;
      else eraPrompt = `${storyYear}年代中国服饰风格`;
    } else {
      if (storyYear >= 2020) eraPrompt = `${storyYear}s contemporary Chinese fashion, modern casual style`;
      else if (storyYear >= 2010) eraPrompt = `${storyYear}s Chinese fashion, Korean-influenced style`;
      else if (storyYear >= 2000) eraPrompt = `early 2000s Chinese fashion, millennium era clothing style`;
      else if (storyYear >= 1990) eraPrompt = `1990s Chinese fashion, transitional era clothing`;
      else if (storyYear >= 1980) eraPrompt = `1980s Chinese fashion, reform era clothing style`;
      else eraPrompt = `${storyYear}s era-appropriate Chinese clothing`;
    }
  } else if (era) {
    eraPrompt = lang === 'zh' ? `${era}时期服饰风格` : `${era} era clothing style`;
  }
  let primaryVisualPrompt: string | undefined;
  if (lang === 'zh' || lang === 'zh+en') {
    // 中文优先（zh+en 只是让用户同时看到两种，生成时用中文）
    primaryVisualPrompt = visualPromptZh || visualPromptEn;
  } else {
    // en：英文优先
    primaryVisualPrompt = visualPromptEn || visualPromptZh;
  }
  
  // 构建角色描述：根据有无参考图决定使用完整锚点还是简化锚点
  let characterDescription = '';
  
  // 构建身份锚点提示词
  const anchorPrompt = buildPromptFromAnchors(identityAnchors, hasReferenceImages || false, promptLanguage);
  
  if (hasReferenceImages) {
    // 有参考图：简化描述，让参考图引导主要特征
    const basicDesc = primaryVisualPrompt ? primaryVisualPrompt.split(/[,，]/).slice(0, 3).join(',') : description.substring(0, 100);
    characterDescription = anchorPrompt 
      ? `${basicDesc}, ${anchorPrompt}` 
      : basicDesc;
  } else if (anchorPrompt) {
    // 无参考图 + 有锚点：完整6层锁定
    const baseDesc = primaryVisualPrompt || description;
    characterDescription = `${baseDesc}, ${anchorPrompt}`;
  } else if (primaryVisualPrompt) {
    // 使用AI大师提示词（已根据语言偏好选择）
    characterDescription = primaryVisualPrompt;
  } else {
    // 只有基础描述
    characterDescription = description;
  }
  
  // 加入年代服装提示词
  if (eraPrompt) {
    characterDescription = `${characterDescription}, ${eraPrompt}`;
  }

  const isZh = lang === 'zh';

  const basePrompt = isRealistic
    ? (isZh
        ? `专业角色参考图，"${name}"，${characterDescription}，真人写实`
        : `professional character reference for "${name}", ${characterDescription}, real person`)
    : (isZh
        ? `专业角色设计参考图，"${name}"，${characterDescription}`
        : `professional character design sheet for "${name}", ${characterDescription}`);
  
  // 使用 SHEET_ELEMENTS 定义的 prompt，如果是真人风格则转换成写实/摄影表述
  const contentParts = selectedElements
    .map(id => {
      const element = SHEET_ELEMENTS.find(e => e.id === id);
      if (!element) return null;
      if (isRealistic) {
        switch (id) {
          case 'three-view': return 'multiple photographic angles: front portrait, side profile, full body shot';
          case 'expressions': return 'collage of different facial expressions: smiling, frowning, angry, surprised';
          case 'proportions': return 'full body photography, standing straight';
          case 'poses': return 'various action poses, action photography collage';
          default: return element.prompt;
        }
      }
      return element.prompt;
    })
    .filter(Boolean);
  
  const contentPrompt = contentParts.join(', ');
  
  // 统一强化纯白背景，避免背景颜色被风格词带偏
  const whiteBackgroundPrompt = "pure solid white background, isolated character on white background, absolutely no background scenery";
  
  if (isRealistic) {
    return isZh
      ? `${basePrompt}, ${contentPrompt}, 摄影角色参考图版式, 拼贴格式, ${whiteBackgroundPrompt}, ${styleTokens}, 电影级灯光, 高细节皮肤纹理, 照片写实`
      : `${basePrompt}, ${contentPrompt}, photographic character reference layout, collage format, ${whiteBackgroundPrompt}, ${styleTokens}, cinematic lighting, highly detailed skin texture, photorealistic`;
  } else {
    return isZh
      ? `${basePrompt}, ${contentPrompt}, 角色参考图版式, ${whiteBackgroundPrompt}, ${styleTokens}, 精细插画`
      : `${basePrompt}, ${contentPrompt}, character reference sheet layout, ${whiteBackgroundPrompt}, ${styleTokens}, detailed illustration`;
  }
}

// Note: generateCharacterImage and imageUrlToBase64 are now imported from @/lib/ai/image-generator
