# 千星 Codex 工坊

面向 Codex 的千星奇域制作助手：把官方资料查询、分段计划、节点图、客户端 Lua、界面设计和项目接续放进同一个本地工作流。

它既提供资料工具，也保存制作过程。Codex 开始一段任务时读取项目状态；结束时登记产物、证据与失败经验；下次聊天可以核对文件变化后继续。当前版本 **0.4.1**，优先支持本机 Windows，要求 **Node.js 24 或以上**。

本仓库用于公开源码与发布包；个人日常使用的完整版独立维护。整理发布包使用本仓库自己的配置、依赖和隔离夹具，保留个人完整版的全部资料及能力，不切换其插件入口或同步个人知识库。

## 与参考项目的关系

最初参考的是 [dsh-plugin-miliastra-toolbox](https://github.com/1475505/dsh-plugin-miliastra-toolbox)，其知识能力来自 [Miliastra-toolbox](https://github.com/1475505/Miliastra-toolbox)。我们保留了相近的资料查询接口，借鉴官方目录定位和标题解析思路。完整上游还包含自己的 Web/AI 功能，不能笼统说它没有 AI 辅助。

本项目独立增加的重点是 **Codex 制作工作流**：

| 能力 | 本项目的实现 |
|---|---|
| 六个简单入口 | qx-plan、qx-docs、qx-build、qx-ui、qx-lua、qx-debug 自动按需求选择 |
| 阶段接续 | SQLite 项目记忆、用户原计划、依赖、失败记录、续做提示 |
| 产物变化 | checkpoint 保存 SHA-256；context 发现文件变化并提示相关阶段重验 |
| 验收边界 | 静态设计与编辑器玩法验收分别记录，代码写完不等于试玩通过 |
| 可复用界面 | JSON 布局合同、父子树/依赖校验、逐控件属性与设备覆盖 |
| 可看可点的预览 | 离线 HTML，支持设备切换、隐藏状态、属性与依赖检查 |
| 本地知识 | 全部当前中文综合指南、教程、FAQ；原图、GIF 多帧、裁剪；本地 BGE 检索 |
| 更新与发布 | 用户明确更新后暂存校验再切换；源码与个人资料分离，可检查、导出发布包 |

来源与许可证范围见 [NOTICE](NOTICE.md)。本项目没有把上游源码、节点归属映射表或官方资料打进发布包。节点归属从官方目录核实，无法确认时保留 unknown。

## 安装

以下命令用于主动选择安装公开版本。已有独立个人完整版的机器整理发布源码时，无须执行插件安装或切换入口。

先克隆到一个长期保留的位置，在仓库根目录执行：

```powershell
git clone https://github.com/Bronya-duck/miliastra-codex-workbench.git
cd miliastra-codex-workbench
npm ci --prefix runtime
node scripts/configure.mjs
codex plugin marketplace add .
codex plugin add miliastra-codex-workbench@miliastra-codex
```

`configure` 根据当前克隆位置与 Node 路径生成私有 `plugin/.mcp.json`；移动源码后重新配置并更新插件安装。薄插件缓存只放技能，MCP 指向本仓库运行目录。配置文件不提交 Git。插件布局依据 [OpenAI 官方插件文档](https://developers.openai.com/plugins/build/plugins)，安装命令已在本机 Codex CLI 验证。

有已有资料时可以复用，不必重新下载：

```powershell
node scripts/configure.mjs --node '<Node 可执行文件绝对路径>' --data '<已有数据绝对目录>'
```

全新安装要显式准备资料和模型（会访问官方资料站和 Hugging Face，耗时与空间取决于实际目录）：

```powershell
# 默认数据在仓库 data/；自定义时，CLI 使用与 MCP 相同的变量
$env:MILIASTRA_DATA_DIR = '<数据绝对目录>'
node runtime/cli.mjs setup
node runtime/cli.mjs doctor
```

日常检索在资料准备后使用本地快照，不调用 embedding 服务。每天北京时间首次使用会检查目录变化并提示；不会自动替换资料。明确更新时执行 `node runtime/cli.mjs sync`；失败保留现有活动快照。`model` 只准备模型；`reindex` 用本地正文重新索引。

模型固定为 `Xenova/bge-small-zh-v1.5` q8、CPU、CLS pooling、归一化余弦排序，提交 `75c43b069aac4d136ba6bc1122f995fedcfd2781`。模型及依赖各自许可证独立于本项目。

新安装者安装后重新打开聊天/重新加载插件。本机已经使用独立个人完整版时，发布插件保持停用，继续由个人版提供六个技能。已有项目库可继续读取，旧版未跟踪的文件在下一次 checkpoint 登记哈希。

## 最简单的用法

项目首次启用可以说：

> $qx-plan 在当前项目启用千星奇域制作：使用本地官方知识库和本项目进度数据库。后续遇到不确定的节点、组件、控件、Lua 用法或报错，先自主查询官方资料；每段计划、制作和排错后保存结果，换聊天时读取进度继续。

每个制作项目启用一次即可。入口创建或复用本项目 `.miliastra/project.sqlite`，并在 `AGENTS.md`（已有 override 时使用 `AGENTS.override.md`）绑定专属指引，保留原有规则与进度。只启用时无需先给出总玩法；后续聊天按项目指引自主查资料，项目进度分别保存。资料连接失败时会分别说明项目记录的启用状态与待修复问题。

升级后在已有项目重新发送这段提示语，可更新千星指引块并保留原数据库内容。插件更新后重新加载插件或重启 Codex，再使用新的入口。

然后按需要使用几个入口，也可以直接用自然语言：

| 入口 | 示例 |
|---|---|
| `$qx-plan` | 以这份总玩法和计划表为基础，给出分段制作计划 |
| `$qx-build` | 继续 P2，完成仇恨追击的变量、节点参数和连线方案 |
| `$qx-ui` | 为本段给出控件树、依赖、属性、位置、前后顺序，并生成预览 |
| `$qx-lua` | 根据已保存布局写按钮 Lua，列挂载与验证步骤 |
| `$qx-debug` | 根据这份日志查明按钮为何无响应，保存失败试验 |
| `$qx-docs` | 查这个节点的参数、归属端和官方图示 |

想换聊天继续时说“生成本阶段续做提示”。各技能可以自主查资料，不必手动先运行 qx-docs。规划/代码/预览可以在外部完成；实际编辑器操作以当前用户授权与工具能力为准。

## 演示、测试与发布

```powershell
node scripts/demo.mjs
npm test
npm run test:knowledge
npm run check-release
node scripts/diagnose.mjs --offline
node scripts/export.mjs
```

演示在 `.local/` 新建隔离项目，生成 10 个控件的 HUD/帮助面板、布局 JSON、交互 HTML 和续做提示，使用本项目原创示例，不触碰游戏工程。预览用于设计检查，不能模拟引擎输入、所有锚点变换或证明 Lua 已运行。

`diagnose --offline` 通过真实 MCP 测试本地正文、Lua 文档、图片和语义查询，需已准备资料；也可 --config 指向已安装插件的配置。`export` 只导出允许发布的源码与文档，生成文件哈希清单。个人项目库、官方原文/图片、模型、依赖安装目录、机器路径配置均排除；也可以直接将本仓库源码提交 GitHub。源码仓库为 [Bronya-duck/miliastra-codex-workbench](https://github.com/Bronya-duck/miliastra-codex-workbench)。

更多说明：[工作流与工具](docs/workflow.md)、[架构](docs/architecture.md)、[验收记录](docs/validation.md)、[贡献](CONTRIBUTING.md)、[安全与资料范围](SECURITY.md)。

