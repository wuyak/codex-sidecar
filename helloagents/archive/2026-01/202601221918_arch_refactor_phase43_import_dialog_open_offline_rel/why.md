# Why - Phase43 import dialog open offline rel

## 背景

`ui/app/control/wire/import_dialog.js` 同时承担“离线导入弹窗渲染”和“离线 rel 粘贴/归一化/打开”逻辑，且该逻辑与 `offline_show`（展示名单）更新、会话切换、弹窗关闭强耦合，后续继续拆分会带来更高的冲突概率。

## 目标

- 将“离线 rel 归一化 + 打开/入列展示名单 + 切换会话”的动作封装为独立模块，降低 `import_dialog.js` 的内联复杂度。
- 保持行为不变：同样的输入/点击路径产生同样的 state 更新与 UI 反馈。

