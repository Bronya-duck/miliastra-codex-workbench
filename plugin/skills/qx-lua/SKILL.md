---
name: qx-lua
description: 编写和修改千星奇域客户端 Lua，制作按钮事件、控件交互、HUD 和轻量 2D 玩法，提供控件配置、脚本挂载及验证步骤。
---

先阅读[本地资料规则](../references/knowledge-workflow.md)。

用 `list_client_documents` 和 `get_client_document` 查控件、客户端脚本教程及 API；开放需求用 `rag_search(queries, scope="client")` 定位。共享资料可用 `get_document`。挂载和界面配置按实际图片核对。

项目已有 `qx-ui` 布局时先读其 JSON 和配置说明，复用控件树、名称/路径、宿主、输入规则和信号；需要新界面时读取 [qx-ui](../qx-ui/SKILL.md) 完成布局，再衔接代码。实际索引由编辑器取得，不能把设计 ID 当作运行时 ID。开工以 project_context 的有效依赖为准；每段后 project_checkpoint 记录文件、挂载要求及实际验收方法。

根据官方接口签名与生命周期编写 Lua，说明控件树/名称、宿主对象、脚本映射和挂载位置、必要配置与验证。自定义变量名与官方 API 名分清。给出可复制的代码；用户要求保存时再写 `.lua` 文件。未在编辑器运行的代码标为待验证。
