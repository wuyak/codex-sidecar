# 技术设计: config.load_config 结构化重构（Phase 13）

## 技术方案

### 核心技术
- Python 3.8
- “线性流程 + 小 helper”组织方式

### 实现要点
- 将 `load_config()` 拆为若干私有函数：
  - `_try_load_current_config()`
  - `_apply_inplace_migrations()`
  - `_try_import_from_legacy_homes()`
  - `_try_import_from_legacy_snapshots()`
- 保持迁移顺序与保存策略：
  - 每个迁移点仅在确实发生变更时写回
  - 任何迁移异常不阻断整体加载（继续回退）
- 单测策略：通过 `TemporaryDirectory` 写入 `config.json`，验证返回值与写回结果

## 安全与性能
- **安全:** 不引入新的配置读取来源；旧目录导入仍严格限定在既有候选路径
- **性能:** 拆分不会改变 IO 次数；可读性提升

## 测试与部署
- **测试:** 新增迁移单测；跑全量 `unittest` + `compileall`
- **部署:** 无（内部重构）
