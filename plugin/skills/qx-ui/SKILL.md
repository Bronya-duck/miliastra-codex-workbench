---
name: qx-ui
description: 为千星奇域玩法或制作阶段设计界面布局，输出完整控件树、依赖关系、逐控件属性、位置、适配和前后显示顺序。用于 HUD、面板、按钮及客户端控件布局，衔接 qx-build 和 qx-lua。
---

先阅读[本地资料规则](../references/knowledge-workflow.md)、[项目记录规则](../references/project-workflow.md)和[布局交付约定](references/layout-contract.md)。保存结构化合同或生成预览时阅读 [JSON 格式](references/layout-json.md)。

1. 有项目数据库时先读当前阶段、已有布局产物和失败记录。接收 `qx-plan` 的阶段或 `qx-build` 的玩法方案，保留目标、编号、变量、信号和现有控件名称。把本段布局放进整个玩法的界面结构，标明本段新增、复用及后续预留；未知实际索引留待编辑器填写。
2. 自主调用 `miliastra` MCP 查资料，无需用户先运行 `qx-docs`。用 `rag_search(scope="all")` 或文档列表定位，再用 `get_document` / `get_client_document` 读所选控件、布局和 API 全文。属性、容器配置和层级依赖图示时，实际用 `get_document_image` 读图。查资料本身不下载更新官方知识库。
3. 明确使用传统界面控件、客户端 Lua 控件或混合方案；按官方能力选择控件和宿主。先确定画布、坐标与渲染模式，再按交付约定输出可照填的结构、关系和参数。资料未证实的字段或默认值标待确认；布局尺寸、颜色和业务名标设计建议。
4. `qx-build` 负责玩法变量、节点与界面之间的接线；需要 Lua 时读取 `qx-lua`，沿用本布局的控件路径、宿主及信号。此技能给出配置方案；实际移动控件、切换旧场景渲染模式或挂载脚本按当前会话的编辑授权执行。
5. 已启用项目输出结构化布局，先 `layout_validate`，修复错误并解释警告；用 `layout_preview` 保存 JSON 和离线交互 HTML，它同时登记产物哈希与 revision。完整配置说明可另存 Markdown 并 `project_checkpoint` 合并保留产物。只设计记 planned；配置/代码已改但未试玩记 needs_verification。计划模式只校验并输出待提交内容。预览不模拟引擎/API、非中心锚点或实际输入，试玩结果单独记证据。

交付完整控件树、依赖表、逐控件配置表、前后层次与状态变化、制作顺序和验收方法。不要仅给审美描述。结尾给出 `qx-build` / `qx-lua` 的接续任务；有实际落库时附路径及提交 revision。
