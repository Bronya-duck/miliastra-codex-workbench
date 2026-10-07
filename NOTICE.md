# 来源与许可范围

## 本项目源码

本仓库发布自有实现，MIT 许可证适用于本仓库的运行代码、Codex 工作流技能、协议文档和原创演示。项目是在此前个人版本基础上发展而来；该版本曾研究以下项目，不能声称完全无参考或是净室实现。

- [1475505/dsh-plugin-miliastra-toolbox](https://github.com/1475505/dsh-plugin-miliastra-toolbox)：最初参考的远程知识查询插件及工具接口。研究基线 `f35d55c1109bb7d822e48b22695335278e7208bc`。
- [1475505/Miliastra-toolbox](https://github.com/1475505/Miliastra-toolbox)：官方目录地址、节点标题解析和千星资料组织思路的参考。研究基线 `1113fddb7a2ede9739f9fe71703317782540b4a5`。

发布版没有包含上述项目的源文件、提示词技能文本、知识数据或节点归属映射表。查询工具名称和部分功能相近，予以明确说明。阶段状态/证据、文件哈希审计、续做交接、布局合同及预览为本项目独立实现。

2026-10-05 核查：dsh 插件的 package.json 声明 MIT；两个仓库根目录未观察到独立 LICENSE 文件。本项目不把“公开可见”视作可以重新许可其源码；后续若引入上游代码，须单独核实许可并保留对应声明。GitHub 的 [许可说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) 解释了无许可证时的默认权利范围。

## 外部官方资料、模型与依赖

千星奇域官方教程正文、截图、动画、品牌及游戏资产属于各自权利人；本项目 MIT 不覆盖这些内容。采集器用于用户在本机使用官方资料，默认从官方站取当前中文目录，保留原始来源。公开发布源码时不打包官方知识库；公开传播采集内容需另行确认权利与官方站使用条件。

语义检索使用 [BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5) 的 [Xenova ONNX 版本](https://huggingface.co/Xenova/bge-small-zh-v1.5)。模型独立下载到本地数据目录；依赖通过 runtime/package-lock.json 安装，保留包内许可证。模型、原生运行库和 npm 包不会因为本项目使用 MIT 而改变其许可。

本项目是个人/社区辅助工具，未声称是米哈游或 OpenAI 官方产品。
