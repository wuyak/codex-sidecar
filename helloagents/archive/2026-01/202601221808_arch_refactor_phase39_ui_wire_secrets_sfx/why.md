
# Why: UI wire 拆分（secrets/sfx）（Phase39）

`ui/app/control/wire.js` 作为事件 wiring 入口持续增长，包含“密钥显示/隐藏 + 按需 reveal”与“提示音选择保存/试听”等相对独立的功能域逻辑。

将这些子域拆分到 `wire/*`：
- 降低单文件复杂度与认知负担
- 保持 `wire.js` 作为编排入口（便于后续继续拆分）
- 行为保持不变（仅重排代码结构）

