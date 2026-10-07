# 制作工作流和 MCP 工具

## 常用过程

1. `project_init` 启用实际项目并绑定指引。普通查文档可以直接用知识工具。
2. `project_context` 读取目标、依据、revision、阶段依赖、产物/来源变化。
3. `project_plan` 保存原总玩法或用户计划表及分段方案。上游原编号保留，必要时细化子编号。
4. qx-build 按段输出节点图、变量、参数与连线。界面交给 qx-ui；脚本交给 qx-lua，统一控件 ID、宿主和信号。
5. 界面先 `layout_validate`，再 `layout_preview` 保存合同/预览并登记；实际输入和显示排序在编辑器验证。
6. 每段 `project_checkpoint` 保存结果、文件、失败、待验证点和下一步。正式验收通过后才继续依赖阶段。
7. `project_handoff` 返回可复制的接续提示。下一聊天重读当前记录，避免凭旧摘要开工。

用户启用项目授权进度维护；它不是操作编辑器或对外发布的授权。Plan 模式只读研究、验证布局结构和输出待提交内容；切换后重读 revision 再提交。

## 工具清单

| 分组 | 工具 |
|---|---|
| 官方资料 | get_node_info、list_documents、get_document、rag_search、list_client_documents、get_client_document、get_document_image |
| 项目工作流 | project_init、project_context、project_plan、project_checkpoint、project_handoff |
| 界面合同 | layout_validate、layout_preview |

详细写入 JSON 见 [数据库格式](../plugin/skills/qx-plan/references/database.md)；界面格式见 [布局 JSON](../plugin/skills/qx-ui/references/layout-json.md)。MCP 错误返回 isError；事务/结构不通过返回 committed=false，应读当前状态后修正。

`project_context` 的 `recorded_status` 是最后提交值；`effective_status` 包含当前文件和依赖审计。前置验收未通过时 `can_implement=false`，可以继续只读研究和规划替代方案。知识 source.freshness 为 version_changed/document_removed 时核对受影响能力；快照更新不直接证明旧方案失败。

`acceptance_modes` 默认为 editor。editor 只能使用 editor_playtest/user_report；static 用于明确的纯设计条件。checks.method 还支持 log_review/static_check。通过条件须逐项有证据；工具无法自行判断证据文字是否真实，因此技能要核对日志、截图和用户说明。

## CLI

```powershell
node cli.mjs project init --root '<项目绝对路径>' --name '<项目名称>'
node cli.mjs project context --root '<项目绝对路径>' --stage P2
node cli.mjs project plan --root '<项目绝对路径>' --input '<计划JSON>'
node cli.mjs project checkpoint --root '<项目绝对路径>' --input '<结果JSON>'
node cli.mjs project handoff --root '<项目绝对路径>' --stage P2
node cli.mjs layout validate --input examples/layout.json
node cli.mjs layout preview --input examples/layout.json --output '<HTML输出路径>'
node cli.mjs layout preview --root '<项目绝对路径>' --stage P2 --revision 1 --input '<布局JSON>'
```

独立 preview --output 不写项目库；带 root 的预览以 revision 登记。文件保存成功但事务冲突会返回 pending_artifacts，读取新 revision 后 checkpoint 合并登记。
