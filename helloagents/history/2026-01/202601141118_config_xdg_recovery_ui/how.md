# 技术设计: Sidecar 配置持久化与 UI 收敛

## 技术方案
### 核心技术
- Python: `pathlib` + 原子写入（临时文件 replace）
- UI: 继续内联 HTML，但对配置与工具块渲染做收敛（后续再做静态资源分层）

### 实现要点
1. **配置目录（XDG）**
   - 新增 `default_config_home()`：默认使用 `$XDG_CONFIG_HOME/codex-thinking-sidecar/`，否则 `~/.config/codex-thinking-sidecar/`
   - 配置文件路径改为：`config.json`

2. **备份机制（单文件）**
   - 保存前将旧 `config.json` 复制为 `config.json.bak`（覆盖式）
   - 不再继续写入 `.lastgood` / `.bak-YYYY...`（但恢复时仍会读取旧文件作为候选来源）

3. **兼容迁移**
   - `load_config()` 在新路径无配置时，尝试从旧路径 `CODEX_HOME/tmp/codex_thinking_sidecar.config.json` 读取并迁移到新位置（不删除旧文件）

4. **恢复与提示**
   - `GET /api/config` 附带 `recovery: {available, source}`，仅包含“是否可恢复 + 来源路径”，不返回 token/url
   - UI 在 provider=http 且 Profiles 无有效项时，弹窗提示是否从备份恢复（仅提示一次）

5. **防空保存**
   - 前端保存前校验至少存在 1 个有效 Profile（name + http/https URL）
   - 后端 `update_config()` 增加 guard：拒绝保存空/不可用的 http Profiles（除非显式传 `__allow_empty_translator_config`）

6. **UI 工具块收敛**
   - `tool_output(update_plan)` 直接跳过，避免与 `tool_call(update_plan)` 重复
   - `tool_output(apply_patch)` 详情只展示补丁内容（args），不再拼接多份 raw
   - `parseToolCallText()` 增强：支持 `call_id=`/`call_id：` 等变体，优先抓 JSON 参数块，提升 tool_call→tool_output 关联稳定性

## 架构决策 ADR
### ADR-001: 配置目录使用 XDG（推荐）而非 CODEX_HOME/tmp
**上下文:** sidecar 是独立工具，`.codex` 是 Codex 数据目录，耦合会导致“配置看似丢失/被覆盖”的体验问题。  
**决策:** 默认写入用户级配置目录（XDG）。  
**替代方案:** 继续写入 `CODEX_HOME/tmp` → 拒绝原因：与 Codex 数据耦合、误覆盖与路径漂移风险高。  
**影响:** 需要一次兼容迁移与文档更新。

## 安全与性能
- **安全:** 不在 UI debug/接口中输出 token/url；提醒用户不要把本机配置加入版本控制
- **性能:** 备份/恢复只读写小文件，影响可忽略

## 测试与部署
- **测试:** `python -m py_compile`；启动 `--ui` 验证 `/ui` 能加载并正确展示 Profiles/恢复提示
- **部署:** 无需额外部署；本地脚本 `./ui.sh` / `./run.sh` 保持可用
