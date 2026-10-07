# Codex 项目接续与验收

官方规则由 `miliastra` MCP 查询；项目经验保存在用户制作项目根目录的 `.miliastra/project.sqlite`，摘要为 `.miliastra/PROGRESS.md`。六个技能共同使用本项目记录，实测与假设分别标来源。项目记录不授予编辑器操作权限。

开始有上下文依赖的任务先调用 `project_context(project_root, stage_id?)`。从工作区子目录向上找最近的项目库；传实际项目绝对路径。读目标、原计划、阶段依赖、失败试验和产物；`recorded_status` 是历史提交，`effective_status` 是结合当前文件哈希的状态。发现 `changed`、`unavailable` 或依赖待验证，先核对原因和重验；资料 `version_changed` 时重新读受影响全文。旧版未跟踪的产物先核对后登记。

用户说启用项目时调用 `project_init`，它复用数据库并更新自有 AGENTS 指引块，保留块外内容。未启用时普通查资料、聊天设计可直接完成；保存项目进度需要用户授权的项目位置。

需要计划或提交时读 [数据格式](../qx-plan/references/database.md)：

- `project_plan` 保存总玩法原文、阶段、依赖和验收。已有计划表保留编号和上层约束。
- 每段方案、制作或排错结束调用 `project_checkpoint`，合并保留已有产物，提交实际来源、证据、失败原因和下一步。它自动记录项目内文件哈希；结构化布局由 `layout_preview` 保存并登记。
- 静态设计条件可明确设为 `static`；玩法条件默认为 `editor`。代码完成或结构校验通过记为待验证；全量实际验收才记 `verified`。
- 需要新聊天继续时调用 `project_handoff`，返回可复制的续做提示和阶段上下文；它不会发送消息。新聊天仍先读当前库。

事务以最新 `expected_revision` 提交。冲突时保留产物、重读、合并后重试；返回 `committed:true` 才算落库。每段记录后按有效依赖继续，避免重复失败试验。修改会使相关已执行阶段重新待验证，旧证据保留历史。

计划模式只用只读 `project_context`、`project_handoff`、`layout_validate` 与资料工具，输出待提交记录；回到可写模式重读后补录。项目记录维护不下载官方资料。

MCP 不可用时，技能包内 `qx-plan/scripts/project-db.mjs` 可用 Node 24 运行 `read/init/bind/plan/record/refresh`。该兼容脚本直接读写数据库，缺少 MCP 的产物哈希与续做审计；按实际代码、截图和日志人工核对，恢复 MCP 后补登记。命令格式见数据说明。
