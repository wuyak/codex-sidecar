# 轻量迭代任务清单：Controller 分层（control/ 子模块）

- [√] 重构：将 `controller.py` 的 translator schema/构建逻辑拆到 `control/*`（specs/builders）
- [√] 兼容：保持 `SidecarController` 对外方法与返回结构不变（UI/HTTP handler 无需改动）
- [√] 清理：`controller.py` 收敛 import 与体积，减少“一个文件塞所有”的耦合
- [√] 文档同步：README / wiki / CHANGELOG（如有需要）
- [√] 质量验证：`python3 -m py_compile`
- [√] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
- [√] Git 提交
