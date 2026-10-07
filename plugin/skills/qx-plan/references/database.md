# 项目数据库命令

优先用 MCP：`project_init`、`project_context`、`project_plan`、`project_checkpoint`、`project_handoff`。plan/checkpoint 的 input 使用下面 JSON；root 为实际制作项目绝对目录。MCP 自动哈希产物并审计有效依赖；以下 Node 24 兼容脚本用于 MCP 不可用时直接读库，缺少该审计能力。

```powershell
node '<本技能绝对目录>/scripts/project-db.mjs' init --root '<项目绝对目录>' --name '<项目名>'
node '<本技能绝对目录>/scripts/project-db.mjs' bind --root '<项目绝对目录>'
node '<本技能绝对目录>/scripts/project-db.mjs' read --root '<项目绝对目录>'
node '<本技能绝对目录>/scripts/project-db.mjs' plan --root '<项目绝对目录>' --input '<UTF-8 JSON文件>'
node '<本技能绝对目录>/scripts/project-db.mjs' record --root '<项目绝对目录>' --input '<UTF-8 JSON文件>'
```

`init` 幂等，不覆盖旧库；`read` 以只读方式打开，不存在时只返回 `initialized:false`。`bind` 追加或更新专属项目指引块，保留块外原内容，不重复追加；支持升级旧版指引。`refresh` 从已提交数据库重建进度摘要。数据库事务成功才返回 `committed:true` 与新 revision；`summary_error` 表示数据库已提交，但 Markdown 摘要生成失败，可运行 `refresh` 修复。

输入文件由正常文件工具写入，可保存到项目 `.miliastra/requests/`；不要把复杂 JSON 或用户文本拼接进命令字符串。提交后以返回的 revision 为准；遇到版本冲突重新读库，合并实际改动后再提交。所有 `plan` 和 `record` 输入必须包含读取到的 `expected_revision`。

## 保存总计划及每段方案

```json
{
  "expected_revision": 0,
  "summary": "依据用户总计划拆分制作阶段",
  "goal": "双人合作收集玩法",
  "basis": {"origin": "user_plan", "text": "用户原计划全文或表格，包括原编号"},
  "constraints": ["现有场景只读；新内容需在测试关卡验证"],
  "stages": [
    {
      "id": "P1.1",
      "title": "验证客户端按钮与脚本映射",
      "goal": "确认点击事件能驱动计数",
      "skills": ["qx-docs", "qx-lua"],
      "depends_on": [],
      "steps": ["查阅官方映射规则", "创建测试模板并挂载脚本", "试玩并读取日志"],
      "deliverables": ["scripts/button.lua", "映射与挂载说明"],
      "acceptance": ["试玩中点击一次只增加一次计数", "退出后无监听残留报错"],
      "unknowns": ["编辑器输入稳定性尚未验证"],
      "fallback": "由用户完成首次挂载，我负责代码和日志排错",
      "sources": [{"document_id": "mhbgxf0nynww", "official_url": "https://act.mihoyo.com/ys/ugc/tutorial/detail/mhbgxf0nynww", "snapshot_id": "实际查询返回的版本"}]
    }
  ]
}
```

至少一段；每段有唯一 ID、目标和可观察验收条件。`basis.origin` 可为 `goal`、`user_plan`、`revision`；有用户计划时保存其原文，续写时若不改变依据可省略 `basis`。重规划按 ID 合并：未列出的旧段仍保留；取消旧段通过 `record(status="cancelled")` 并说明原因。已执行阶段的目标、步骤、交付物、验收或依赖有修改时会变回待验证，原验证在历史中保存。依赖只能引用存在的阶段，且不能构成循环。

每输出一段可提交该段的 `plan`，后续提交其余段；先登记所有阶段的简要目标可建立前向依赖，再逐段补足步骤。总体阶段表本身只是规划，不能标记为执行完成。

## 记录某段实际结果

```json
{
  "expected_revision": 1,
  "stage_id": "P1.1",
  "status": "needs_verification",
  "summary": "已保存代码；尚未进入编辑器试玩",
  "artifacts": ["scripts/button.lua"],
  "findings": [{"statement": "脚本需映射并挂载客户端控件", "basis": "official", "reference": "文档 ID、官方地址与快照版本"}],
  "checks": [{"criterion": "试玩中点击一次只增加一次计数", "result": "not_run", "evidence": "尚未试玩"}],
  "next_action": "在测试关卡完成挂载并验证",
  "sources": [{"document_id": "mhbgxf0nynww", "snapshot_id": "实际版本"}]
}
```

状态：`planned`（只完成规划）、`in_progress`、`needs_verification`（含部分通过）、`blocked`（存在具体阻碍）、`verified`、`cancelled`。`findings.basis` 为 `official`、`tested`、`hypothesis`、`failed`，reference 必填。`checks.result` 为 passed/failed/not_run；通过项须有 evidence 与 method。method 为 editor_playtest（实际试玩）、user_report（用户实测）、log_review（日志检查）或 static_check（静态检查）。程序检查填写规则，证据真实性仍需读取对应产物核实。

阶段 `acceptance_modes` 以验收原文为键，值为 editor 或 static；省略时全部默认 editor。editor 条件只接受 editor_playtest/user_report。纯设计条件可显式声明 static，允许静态校验；不得把玩法行为改成 static 来通过验收。示例通过项：`{"criterion":"控件树无环", "result":"passed", "method":"static_check", "evidence":"实际 layout_validate 结果与保存的布局文件"}`。上述点击行为示例须实际试玩。

显式标记 `verified` 要提交全部验收条件对应的通过项，且其依赖均已验证；否则事务拒绝，旧状态保留。实际修改产物或配置时在提交中填写 `changes_made: true`，使本段及依赖它的已执行阶段重新待验证；若本次已完成全量复测，可以同时提交新证据与 `verified`。只补充资料、不改产物时可以省略 `status`，保留已有验证。重试、失败和取消均保留历史，不能用“写完方案”替代试玩结果。
