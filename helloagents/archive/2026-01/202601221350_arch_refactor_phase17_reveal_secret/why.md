# 变更提案: reveal_secret 逻辑抽离（Phase17）

## 需求背景
`SidecarController.reveal_secret()` 当前在 `controller_core.py` 内实现了较多“配置字典解析 + provider/field 分支 + profile 选择”逻辑。

该逻辑属于控制面可复用的纯函数（输入为配置字典与 provider/field/profile；输出为 JSON 响应），放在 controller 内会：
- 增加 controller_core 文件体积与职责
- 使该逻辑难以单测（需要构造 controller 实例/锁等上下文）

## 变更内容
在不改变 API 行为与返回结构的前提下：
1. 抽离 reveal_secret 的纯逻辑到 `codex_sidecar/control/reveal_secret.py`
2. `SidecarController.reveal_secret()` 保持签名不变，仅负责取配置快照并调用 helper
3. 新增单测覆盖 openai/nvidia/http 三类分支与 profile 兜底

## 影响范围
- **模块:** control / controller
- **文件:** `codex_sidecar/controller_core.py`（重构）、新增 `codex_sidecar/control/reveal_secret.py`、新增 tests
- **API:** 无变更（仍为 `POST /api/control/reveal_secret`）
- **数据:** 无变更

## 核心场景
### 需求: UI 显示/隐藏密钥值
**模块:** control
当 `/api/config` 返回脱敏字段时，UI 可通过 reveal_secret 按需取回单个字段的原值。

#### 场景: HTTP profiles 未找到 profile
- 预期结果：返回 `ok=true` 且 `value=""`（不报错，便于 UI 新建 profile）

## 风险评估
- **风险:** 分支逻辑迁移时造成返回结构/字段名变化
- **缓解:** 以“原实现”为 SSOT；新增单测覆盖关键分支与边界条件
