# 结构化布局与预览

这是工坊自有的设计合同，不是游戏导入文件。官方类型与属性先查资料；合同中的稳定设计 ID 不能替代编辑器索引。完整配置和排序规则仍按 [布局交付约定](layout-contract.md) 输出。

`layout_validate({layout})` 只读校验。`layout_preview({project_root,stage_id,expected_revision,layout})` 在项目里保存 JSON 和自包含 HTML，并事务登记文件哈希。revision 使用刚读的 `project_context`；结果 committed=false 时先保留路径、重读后补提交，不重复覆盖产物。

## 最小格式

```json
{
  "schema_version": 1,
  "stage_id": "P2",
  "title": "收集 HUD",
  "canvas": {"width": 1600, "height": 900, "origin": "bottom-left", "unit": "ui", "devices": [{"id": "pc", "width": 1600, "height": 900}]},
  "controls": [
    {
      "id": "Root", "name": "CollectionRoot", "type": "按官方核实的根控件类型", "parent": null,
      "position": {"x": 800, "y": 450, "space": "canvas"}, "size": {"width": 1600, "height": 900},
      "anchors": {"min": [0.5,0.5], "max": [0.5,0.5], "pivot": [0.5,0.5]},
      "render": {"scope": "client-host", "order": 0},
      "state": {"active": true, "visible": true, "interactable": false},
      "appearance": {"bg_color": "#11223300", "opacity": 1},
      "properties": {"宿主": "待编辑器填写", "来源类型": "设计建议"}
    },
    {
      "id": "Count", "name": "CollectionCount", "type": "按官方核实的文本控件类型", "parent": "Root",
      "position": {"x": -400, "y": 300, "space": "parent-center"}, "size": {"width": 300, "height": 60},
      "render": {"scope": "client-host", "order": 1},
      "state": {"active": true, "visible": true, "interactable": false},
      "appearance": {"text": "3 / 20", "text_color": "#FFFFFF", "font_size": 28}, "properties": {}
    }
  ],
  "dependencies": [{"from": "Count", "to": "var:collection_count", "kind": "data", "description": "计数变化时刷新显示；通信与 API 待官方核实"}],
  "sources": [],
  "assumptions": ["尺寸为设计建议，实际控件类型和输入需核实"]
}
```

每个控件需要 id/name/type/parent/position/size/render。ID 唯一，父级存在且无环；根用 null。根位置是画布中心点坐标，子级位置是相对父级中心的偏移，单位 UI，正 x 向右、正 y 向上。排序必须有 scope 和整数 order，表示本方案在相应范围的顺序，不能直接当成全引擎通用层级。

`properties` 保存逐控件官方配置项和待填写索引。`appearance` 是预览样式，支持 text/bg_color/text_color/font_size/opacity，区别于官方属性。实际配置表里说明映射。

`overrides` 按设备 ID 覆盖 position/size/anchors/render/state/appearance/properties；保留 id、类型与父子关系。设备尺寸与控制布局同时给出，不自动实现游戏安全区/拉伸。

依赖 kind 为 data/event/lifecycle/layout/resource；from 为控件 ID，to 为控件 ID 或 `var:`/`signal:`/`script:`/`asset:` 引用。树是结构，依赖另列，外部符号还要在玩法或脚本中核对。

来源填写查询返回的 document_id、official_url、snapshot_id，可补 body_sha256 和已读 image_ids。无来源会警告。最多 250 个控件、8 种设备；更大的布局按页面分别出合同。

## 检查结果的解释

错误修复后再保存；交互重叠、越界、跨 scope 等警告逐项判断。HTML 支持设备切换、展示隐藏控件、点选查看属性/依赖和缩放。固定中心锚点的几何预览可用于核对相对位置；拉伸、旋转、缩放、裁剪、实际渲染/输入和 Lua 调用在编辑器验证。结构通过不会验证 type/API 是否真实存在。

预览生成只算设计产物。`static_check` 可通过纯设计验收；玩法验收用实际试玩或用户实测证据，不能用预览冒充关卡完成。
