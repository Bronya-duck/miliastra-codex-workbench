---
name: qx-docs
description: 查询千星奇域官方文档：节点参数与归属端、组件配置、教程和 FAQ。用于查资料或解释已有功能。
---

查询前阅读[本地资料规则](../references/knowledge-workflow.md)。

- 节点名用 `get_node_info(names)`，支持批量。
- 文档或系统名用 `list_documents(keywords)` 找标题，再 `get_document(titles)` 取全文；可直接传 ID。省略关键词或 `[]` 列目录。
- 自然语言问题用 `rag_search(queries, scope="all")` 定位，再读取相关全文。

直接回答用户所问的功能、参数或配置，带官方来源。需要制作完整节点图用 `qx-build`，客户端 Lua 用 `qx-lua`，故障定位用 `qx-debug`。
