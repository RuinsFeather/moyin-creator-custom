// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * ShotContentEditor — 编辑镜头内容字段
 * 画面概述 / 场景 / 动作 / 对白 / 景别 / 镜头运动 / 时长 / 备注
 */
import { useStoryboardStore } from "@/stores/storyboard-store";
import type { StoryboardShot } from "@/types/storyboard";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

interface Props {
  shot: StoryboardShot;
}

const SHOT_SIZES = ["特写", "近景", "中景", "全景", "远景"];
const CAMERAS = ["固定", "推", "拉", "摇", "移", "跟", "升降"];

const fieldCls = "w-full";
const labelCls = "text-[10px] text-muted-foreground mb-1 block";

export function ShotContentEditor({ shot }: Props) {
  const updateShotContent = useStoryboardStore((s) => s.updateShotContent);
  const updateShot = useStoryboardStore((s) => s.updateShot);
  const c = shot.content;

  return (
    <div className="flex flex-col gap-2 border rounded-md p-2">
      <div>
        <label className={labelCls}>画面内容概述</label>
        <Textarea
          className={fieldCls}
          rows={2}
          value={c.summary}
          onChange={(e) => updateShotContent(shot.id, { summary: e.target.value })}
        />
      </div>

      <div>
        <label className={labelCls}>场景</label>
        <Input
          className={fieldCls}
          value={c.scene}
          onChange={(e) => updateShotContent(shot.id, { scene: e.target.value })}
        />
      </div>

      <div>
        <label className={labelCls}>动作</label>
        <Textarea
          className={fieldCls}
          rows={2}
          value={c.action}
          onChange={(e) => updateShotContent(shot.id, { action: e.target.value })}
        />
      </div>

      <div>
        <label className={labelCls}>对白</label>
        <Textarea
          className={fieldCls}
          rows={2}
          value={c.dialogue}
          onChange={(e) => updateShotContent(shot.id, { dialogue: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>景别</label>
          <Select
            value={c.shotSize}
            onValueChange={(v) => updateShotContent(shot.id, { shotSize: v })}
          >
            <SelectTrigger className={fieldCls}>
              <SelectValue placeholder="景别" />
            </SelectTrigger>
            <SelectContent>
              {SHOT_SIZES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className={labelCls}>镜头运动</label>
          <Select
            value={c.cameraMovement}
            onValueChange={(v) => updateShotContent(shot.id, { cameraMovement: v })}
          >
            <SelectTrigger className={fieldCls}>
              <SelectValue placeholder="镜头运动" />
            </SelectTrigger>
            <SelectContent>
              {CAMERAS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className={labelCls}>时长（秒）</label>
        <Input
          className={fieldCls}
          type="number"
          value={c.durationSeconds ?? ""}
          onChange={(e) =>
            updateShotContent(shot.id, {
              durationSeconds: e.target.value === "" ? undefined : Number(e.target.value),
            })
          }
        />
      </div>

      <div>
        <label className={labelCls}>备注</label>
        <Textarea
          className={fieldCls}
          rows={2}
          value={shot.notes}
          onChange={(e) => updateShot(shot.id, { notes: e.target.value })}
        />
      </div>
    </div>
  );
}