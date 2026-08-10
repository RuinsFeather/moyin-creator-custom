// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * ReferenceItemsEditor — 编辑镜头参考项（角色 / 服装 / 场景）
 * 从角色库和场景库选择，或手动添加。
 */
import { useMemo, useState } from "react";
import { useStoryboardStore } from "@/stores/storyboard-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";
import type { StoryboardShot, StoryboardReferenceItem } from "@/types/storyboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus } from "lucide-react";

interface Props {
  shot: StoryboardShot;
}

export function ReferenceItemsEditor({ shot }: Props) {
  const setShotReferences = useStoryboardStore((s) => s.setShotReferences);
  const characters = useCharacterLibraryStore((s) => s.characters);
  const scenes = useSceneStore((s) => s.scenes);

  const [adding, setAdding] = useState<"characters" | "costumes" | "scenes" | null>(null);
  const [manualName, setManualName] = useState("");

  const characterOptions = useMemo(
    () => characters.map((c) => c.name).filter(Boolean),
    [characters],
  );
  const sceneOptions = useMemo(() => scenes.map((s) => s.name).filter(Boolean), [scenes]);

  const remove = (key: keyof typeof shot.references, id: string) => {
    const next = shot.references[key].filter((r) => r.id !== id);
    setShotReferences(shot.id, { [key]: next } as any);
  };

  const addManual = () => {
    if (!manualName.trim() || !adding) return;
    const item: StoryboardReferenceItem = {
      id: `man_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: manualName.trim(),
      source: "manual",
    };
    setShotReferences(shot.id, { [adding]: [...shot.references[adding], item] } as any);
    setManualName("");
    setAdding(null);
  };

  const addFromLibrary = (key: "characters" | "costumes" | "scenes", name: string) => {
    if (!name) return;
    const exists = shot.references[key].some((r) => r.name === name);
    if (exists) return;
    const item: StoryboardReferenceItem = {
      id: `lib_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      source: "library",
    };
    setShotReferences(shot.id, { [key]: [...shot.references[key], item] } as any);
  };

  const renderSection = (key: "characters" | "costumes" | "scenes", label: string) => {
    const items = shot.references[key];
    const libraryOptions =
      key === "characters" ? characterOptions : key === "scenes" ? sceneOptions : [];
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground">{label}</span>
          <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => setAdding(adding === key ? null : key)}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {items.map((r) => (
            <Badge key={r.id} variant="secondary" className="text-[10px] gap-1">
              {r.name}
              <button onClick={() => remove(key, r.id)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {items.length === 0 && <span className="text-[10px] text-muted-foreground">—</span>}
        </div>

        {adding === key && (
          <div className="mt-1 flex flex-col gap-1">
            {libraryOptions
              .filter((n) => !items.some((r) => r.name === n))
              .slice(0, 5)
              .map((n) => (
                <button
                  key={n}
                  className="text-left text-[11px] px-1 py-0.5 rounded hover:bg-accent"
                  onClick={() => addFromLibrary(key, n)}
                >
                  + {n}
                </button>
              ))}
            <div className="flex gap-1">
              <Input
                className="h-6 text-[11px]"
                placeholder="手动输入名称"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addManual()}
              />
              <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={addManual}>
                添加
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2 border rounded-md p-2">
      <h5 className="text-[10px] font-medium text-muted-foreground">参考项</h5>
      {renderSection("characters", "角色")}
      {renderSection("costumes", "服装")}
      {renderSection("scenes", "场景")}
    </div>
  );
}