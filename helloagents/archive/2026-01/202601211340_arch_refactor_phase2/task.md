# 任务清单: 项目整体架构优化（Phase 2）

目录: `helloagents/plan/202601211340_arch_refactor_phase2/`

---

## 1. 全局检查与基线（只读/测量）
- [√] 1.1 输出后端/前端模块依赖与 fan-in/fan-out 基线（用于定位耦合点），记录在 how.md（不引入新依赖）。
- [√] 1.2 明确“不改功能”的回归清单：离线展示/翻译/导出/监听（在 how.md 补充验证点）。

## 2. 后端：handler/controller 进一步降噪
- [√] 2.1 在 `codex_sidecar/controller.py` 内统一翻译逻辑（probe/text/items）与错误/模型解析，减少重复代码，保持返回 shape 不变。
- [√] 2.2 精简 `codex_sidecar/controller.py` 的 config 热更新路径：将 watcher 热更新的字段应用集中到单一 helper，减少散落 try/except。
- [√] 2.3 为上述重构补齐/更新单测（优先“输入输出契约”，必要时用 fake controller/translator）。
- [√] 2.4 完成一次 git commit（后端阶段）。

## 3. watcher：空转与分叉进一步收敛
- [√] 3.1 梳理 `codex_sidecar/watcher.py` 的循环：在无 follow targets 时减少不必要动作（仍需保留 tool gate 能力的最小轮询）。
- [-] 3.2 补齐关键边界 case 的单测（当前以 compileall + 全量单测回归兜底；后续如需可补充针对 idle 降频的时间型测试）。
- [√] 3.3 完成一次 git commit（watcher 阶段）。

## 4. 前端：降低 `wire.js`/`main.js` 的耦合（不改行为）
- [√] 4.1 拆分 `ui/app/control/wire.js`：按功能域迁移内部函数到 `ui/app/control/wire/*`（保留原导出签名）。
- [√] 4.2 精简 `ui/app/main.js` 的数据源分支判断：集中 Live/Offline 分流决策点。
- [√] 4.3 对改动文件执行 `node --check`，必要时补充最小契约测试。
- [√] 4.4 完成一次 git commit（前端阶段）。

## 5. 收尾：一致性审计与方案迁移
- [√] 5.1 全量回归：`compileall` + `unittest` + JS 语法检查。
- [√] 5.2 更新知识库：`helloagents/CHANGELOG.md` + 受影响模块文档（保持 SSOT 与代码一致）。
- [√] 5.3 迁移方案包至 `helloagents/archive/2026-01/` 并更新 `helloagents/archive/_index.md`。
