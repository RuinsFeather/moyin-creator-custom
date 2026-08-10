// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * ReferenceImageField — 镜头参考图（只用于信息整理，不触发生成）
 * 支持从角色/场景库引用，或上传本地图片。
 */
import { useRef } from "react";
import { useStoryboardStore } from "@/stores/storyboard-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import type { StoryboardShot } from "@/types/storyboard";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  shot: StoryboardShot;
}

export function ReferenceImageField({ shot }: Props) {
  const addReferenceImage = useStoryboardStore((s) => s.addReferenceImage);
  const removeReferenceImage = useStoryboardStore((s) => s.removeReferenceImage);
  const characters = useCharacterLibraryStore((s) => s.characters);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      addReferenceImage(shot.id, {
        sourceType: "upload",
        localUrl: dataUrl,
        thumbnailUrl: dataUrl,
        label: file.name,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const addFromCharacter = (charId: string) => {
    const char = characters.find((c) => c.id === charId);
    const img = char?.thumbnailUrl || char?.referenceImages?.[0];
    if (!img) {
      toast.info("该角色没有参考图");
      return;
    }
    addReferenceImage(shot.id, {
      sourceType: "character",
      relatedReferenceId: charId,
      localUrl: img,
      thumbnailUrl: img,
      label: char.name,
    });
  };

  return (
    <div className="flex flex-col gap-2 border rounded-md p-2">
      <h5 className="text-[10px] font-medium text-muted-foreground">参考图</h5>

      <div className="flex flex-wrap gap-2">
        {shot.referenceImages.map((img) => (
          <div key={img.id} className="relative group">
            <img
              src={img.localUrl || img.thumbnailUrl}
              alt={img.label || "参考图"}
              className="h-16 w-16 object-cover rounded border"
            />
            <button
              className="absolute -top-1 -right-1 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"
              onClick={() => removeReferenceImage(shot.id, img.id)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5 mr-1" />
          上传
        </Button>

        <select
          className="h-7 text-[11px] rounded border bg-background px-1 max-w-[140px]"
          value=""
          onChange={(e) => e.target.value && addFromCharacter(e.target.value)}
        >
          <option value="">从角色库引用…</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
      </div>
    </div>
  );
}