# 技术设计: reveal_secret 逻辑抽离（Phase17）

## 技术方案
### 核心技术
- Python 标准库

### 实现要点
- 新增 `codex_sidecar/control/reveal_secret.py`：
  - `reveal_secret(cfg: Dict[str, Any], provider: str, field: str, profile: str = \"\") -> Dict[str, Any]`
  - 内部保持与 controller_core 原逻辑一致（legacy config 兼容、profiles 匹配、selected 兜底）
- controller_core：
  - 在锁内读取 `self._cfg.to_dict()`（保持脱敏前的原值），锁外调用 helper 返回结果

## 测试与部署
- **测试:** `python3 -m unittest discover -s tests`
- **部署:** 无额外步骤；仅内部逻辑迁移
