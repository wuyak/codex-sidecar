
# Why: UI prefs SSOT（Phase38）

`ui/app/control/load.js` 与 `ui/app/control/wire.js` 中存在重复的“UI-only 偏好（字体大小/按钮大小）”应用逻辑与 localStorage key 定义，导致维护成本与行为漂移风险上升。

本阶段将该逻辑抽离为单一来源（SSOT），在不改变任何交互/渲染行为的前提下，降低重复与耦合。

