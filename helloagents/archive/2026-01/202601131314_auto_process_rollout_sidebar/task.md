# 任务清单: 基于 Codex 进程的会话自动跟随 + 固定侧边栏切换

目录: `helloagents/plan/202601131314_auto_process_rollout_sidebar/`

---

## 1. 进程触发与文件定位（Watcher）
- [√] 1.1 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/config.py` 增加与“自动模式/进程匹配”相关的配置字段，并保持旧配置兼容（why.md#变更内容）
- [√] 1.2 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/watcher.py` 实现 Codex 进程检测与进程树收集逻辑（why.md#需求-自动跟随正在进行的会话文件）
- [√] 1.3 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/watcher.py` 实现“从 /proc/<pid>/fd 定位 rollout 文件”的选择器，并接入现有切换逻辑（process 优先，fallback 回退）
- [√] 1.4 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/watcher.py` 增强 `status()`：暴露当前模式、是否检测到 Codex、命中 PID/定位结果（便于 UI 排障）

## 2. 控制面与自动启动
- [√] 2.1 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/controller.py` 将新增配置透传到 `RolloutWatcher` 初始化参数
- [√] 2.2 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py` 的 UI 逻辑中实现“auto_start=true 时自动 start watcher”（why.md#自动开始解析监听面向-ui-用户）
- [√] 2.3 （可选）在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/cli.py` 增加对应的 CLI flag 或对 `--ui` 模式做更友好默认（不破坏现有行为）

## 3. UI：固定侧边栏会话切换
- [√] 3.1 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py` 调整 UI CSS，将会话列表改为左侧固定 sidebar，滚动消息时保持可见（why.md#需求-固定侧边栏随时切换会话）
- [√] 3.2 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py` 调整会话列表渲染：显示更清晰的会话名（时间戳 + short thread_id，文件名兜底）

## 4. 安全检查
- [√] 4.1 按 G9 做安全检查：不引入生产连接、不落盘明文敏感信息、不扩大监听范围；确认 `/proc` 扫描仅读并可控

## 5. 文档更新
- [√] 5.1 更新 `tools/codex_thinking_sidecar/README.md`：说明自动模式、进程定位策略与 WSL2 使用方式
- [√] 5.2 更新 `helloagents/modules/rollout_sidecar.md`：补充“进程触发 + 固定侧边栏”能力说明与排障提示

## 6. 验证
- [√] 6.1 本地手动验证（WSL2）：启动 UI→启动 Codex→自动开始 ingest→侧边栏切换会话→关闭 Codex→进入等待态（how.md#测试与验证）
