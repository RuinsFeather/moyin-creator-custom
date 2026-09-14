---
name: screenplay-to-storyboard
description: "将中文剧本按画面变化细拆为与示例 storyboard JSON 一致的标准分镜 JSON，适用于从 Markdown 剧本生成可审阅的镜头清单。"
metadata:
  short-description: "按画面动作生成标准分镜 JSON"
---

# Screenplay To Storyboard

将剧本 Markdown 拆成可直接导入或审阅的标准镜头 JSON。用户通常会提供一个示例 json 和一个待处理的剧本 Markdown；输出文件应放在示例 JSON 同目录，默认命名为 storyboard1.json。

## 工作顺序

1. 先读取示例 JSON，不要凭记忆猜字段。确认顶层字段、shots、content、references 和时间戳格式，保留示例的字段形状。
2. 读取剧本全文并按场次标题分组。content.scene 使用当前地点，不能把上一场地点带入下一场。
3. 分析可见画面变化。一个镜头表达一个连续、可拍摄的画面单位，至少包含动作、人物反应、环境或道具。按视觉阶段、空间变化、动作阶段、视角变化或转场变化拆分，不要按逗号机械切分。
4. 连续复合动作要按画面阶段拆开。例如红雾遮蔽镜头、迷雾散去显现石门和银色守卫、守卫抬剑挥向镜头，应拆成三个镜头。
5. 对白不能独立成为只有台词的镜头。将角色名、语气和台词归入紧邻的动作镜头的 content.dialogue，并在 sourceText 中保留原文。不得生成 action 只有角色名或冒号的镜头。
6. 画外音、字幕、转场和特效必须挂到实际画面上。符纸贴镜头、标题浮现、雷鸟冲出风暴、毒触手破沙而出都应有可拍摄的 action。
7. 镜头数量以覆盖原文所有画面为准，不为凑数切分。过长的复合动作要细拆，短而不可再分的动作保持完整。

## 每个镜头

content.summary 写画面摘要；action 写可执行画面；dialogue 收纳本镜头全部对白、画外音或字幕；scene 是当前地点；shotSize 和 cameraMovement 根据原文提示或画面需要填写；durationSeconds 使用合理整数；additionalDescription 补充氛围、特效、构图、声音或参考风格。

sourceText 必须能追溯到剧本原文，可包含该镜头对应的动作、角色提示和台词。不要凭空补写剧情事实；原文写着“台词交由 AI 自由发挥”时保留该提示。

## 引用和质量检查

为同名角色和同一地点复用稳定引用 ID。references.characters 只列出当前镜头实际出现或明确提及的角色；references.scenes 使用当前地点；costumes 和 referenceImages 无来源时保持空数组。新镜头的 origin、reviewStatus 按示例使用。

生成后必须用 JSON 解析器校验，并检查：shots 非空；order 从 0 连续递增；shotNumber 与顺序一致；每个镜头的 action、scene、sourceText 非空；没有只有角色名或只有台词的镜头；所有场次、关键转场、字幕、魔法、战斗、道具和人物反应均被覆盖；长复合句已按画面阶段拆分；对白仍附着在有动作的镜头上。将新 JSON 放在示例文件旁边，不修改原始剧本或示例 JSON，并报告实际镜头数量和校验结果。
