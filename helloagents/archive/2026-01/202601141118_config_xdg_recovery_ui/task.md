# 任务清单: Sidecar 配置持久化与 UI 收敛

目录: `helloagents/plan/202601141118_config_xdg_recovery_ui/`

---

## 1. 配置持久化（XDG + 单备份）
- [√] 1.1 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/config.py` 中将配置路径迁移到 XDG，保存前生成 `config.json.bak`
- [√] 1.2 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/config.py` 中实现从旧路径 `CODEX_HOME/tmp` 的一次性迁移
- [√] 1.3 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/cli.py` 中新增 `--config-home` 参数，并调整锁文件位置不再依赖 `.codex/tmp`

## 2. 恢复与防误覆盖
- [√] 2.1 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/controller.py` 中提供 `recovery_info()`，并对空 Profiles 保存做后端保护
- [√] 2.2 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py` 中为 `/api/config` 增加 recovery 字段，保存失败返回明确错误
- [√] 2.3 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py` 的 UI JS 中增加恢复提示（弹窗）与保存前校验

## 3. UI 工具块收敛
- [√] 3.1 隐藏 `tool_output(update_plan)`，避免重复
- [√] 3.2 `apply_patch` 详情只展示补丁内容，去掉 raw 拼接冗余
- [√] 3.3 `parseToolCallText()` 增强变体解析（call_id 识别 + JSON 参数定位）

## 4. 文档更新
- [√] 4.1 更新 `helloagents/modules/rollout_sidecar.md`：配置路径、备份机制、恢复提示
- [√] 4.2 更新 `tools/codex_thinking_sidecar/README.md`：配置路径与备份说明
- [√] 4.3 更新 `helloagents/CHANGELOG.md`

## 5. 验证
- [√] 5.1 执行 `python3 -m py_compile` 覆盖变更模块
- [√] 5.2 启动 `python -m codex_thinking_sidecar --ui` 验证 `/api/config` 含 recovery 字段，且 config 路径正确（不输出 token/url）
