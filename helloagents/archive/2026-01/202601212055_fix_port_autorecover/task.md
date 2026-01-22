# 任务清单: 启动脚本自动清理占用端口的旧 sidecar

目录: `helloagents/plan/202601212055_fix_port_autorecover/`

---

## 1. 启动脚本
- [√] 1.1 在 `scripts/run.sh` 中：当健康检查失败但检测到 lock/端口占用时，安全终止旧 sidecar（仅匹配 codex_sidecar 进程），并重试启动
- [√] 1.2 在 `scripts/ui.sh` 中：同样处理（避免 UI-only 启动也卡在端口占用）
- [√] 1.3 输出提示：在终端明确打印“检测到占用/尝试终止/结果/建议”的信息

## 2. 文档更新
- [√] 2.1 更新 `helloagents/modules/rollout_sidecar.md`：说明“端口占用自动恢复”的行为与安全边界
- [√] 2.2 更新 `helloagents/CHANGELOG.md`：补充修复记录

## 3. 验证
- [?] 3.1 复现：启动 sidecar 后意外关闭浏览器但保持进程；再次运行 `./run.sh` 应自动打开已有 UI 或自动终止并重启（视健康状态而定）
