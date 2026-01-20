# 技术设计: 离线展示会话（展示中）+ 双标签栏

## 技术方案

### 核心技术
- **后端:** Python 标准库 HTTPServer + 现有 `SidecarController` / `SidecarHandler`
- **离线解析:** 复用 `codex_sidecar.watch.rollout_extract.extract_rollout_items`
- **前端:** 现有静态 UI（原生 JS + CSS），继续复用 `renderMessage` / `refreshList` / 导出逻辑

### 实现要点
- **双数据源:** Live 走 `/api/messages`；Offline 走 `/api/offline/messages`
- **双标签栏分流:** 以 `isOfflineKey(key)` 做过滤：Offline 渲染到“展示标签栏”，Live 渲染到“监听标签栏”
- **三列表抽屉:** 会话管理抽屉中分组渲染：监听中/展示中/关闭监听
- **离线翻译不依赖 watcher:** 新增 `POST /api/control/translate_text`（调用 `controller.translate_text`）
- **离线译文缓存:** `localStorage` 按文件分桶存储，避免重复翻译

## 架构设计

```mermaid
flowchart TD
  UI[UI /ui] -->|Live| API_MSG[/api/messages]
  UI -->|Offline| API_OFF[/api/offline/messages]
  UI -->|Translate text| API_TR[/api/control/translate_text]
  API_OFF --> OFF[codex_sidecar/offline.py]
  API_TR --> CTRL[codex_sidecar/controller.py]
  API_MSG --> STATE[codex_sidecar/http/state.py]
```

## 架构决策 ADR

### ADR-001: 离线会话单独“展示标签栏”而非混入监听标签栏
**上下文:** 现有单标签栏会让离线会话与监听会话产生行为与设定重叠，用户期望完全隔离两类会话的导航与状态。
**决策:** 新增一行“展示标签栏”承载离线会话；保留原“监听标签栏”仅承载实时会话。
**理由:** 最小改动实现清晰分层；不改变 watcher 状态机；避免误触发 follow/未读/提示音。
**替代方案:** 混入同一标签栏并用样式区分 → 拒绝原因: 仍共享交互/关闭逻辑，认知负担与误操作风险更高。
**影响:** 需要增加一个固定栏位与对应 DOM/样式，并调整渲染函数支持多 host。

### ADR-002: 离线会话 key 使用 encodeURIComponent(rel)
**上下文:** 离线会话 key 会进入：DOM id/Map key/localStorage key，需稳定且不与 live key 冲突，也不应包含路径分隔符。
**决策:** `offline:${encodeURIComponent(rel)}`；并在服务端返回同样编码后的 `key` 字段。
**理由:** Key 可安全用于属性与存储；避免 `sessions/...` 的斜杠在多处引发歧义；仍可逆解析回 rel。
**替代方案:** 直接拼接 rel → 拒绝原因: 与 UI/存储键空间更易混淆，且与“展示标签栏”隔离策略不够一致。
**影响:** 服务端与前端需统一编码/解码；refreshList 的 key 过滤保持一致。

## API 设计

### [GET] /api/offline/files（已存在）
- **用途:** 列出可选的 `rollout-*.jsonl` 文件（限制在 `CODEX_HOME/sessions/**`）
- **注意:** 仅用于 UI 选择，不会进入 watcher 监听集合

### [GET] /api/offline/messages（已存在，需小幅调整返回字段一致性）
- **请求:** `?rel=<sessions/.../rollout-*.jsonl>&tail_lines=<n>`
- **响应:** `{ ok, rel, key, file, messages: [...] }`
- **变更点:**
  - `key` 改为 `offline:${encodeURIComponent(rel)}`（与前端一致）
  - `messages[].id` 改为 `off:${key}:${sha1(rawLine)}`

### [POST] /api/control/translate_text（新增）
- **描述:** 翻译任意文本块（不依赖 watcher/SidecarState）
- **请求:** `{ text: string }`
- **响应:** `{ ok, provider, model, ms, zh, error? }`
- **用途:** 离线思考翻译回填、离线导出补齐译文

> 兼容：保留 `/api/offline/translate`（已存在）作为历史调用入口；新代码优先使用 `/api/control/translate_text`。

## 数据模型
- `localStorage`：
  - `offlineZh:${rel}` → `{ [msg_id]: zh }`（离线译文缓存）
  - `offlineShow:${v}` → `[{ rel, key, thread_id?, file? }]`（展示中离线会话列表，版本化）

## 安全与性能
- **安全:**
  - 离线文件解析继续强制：仅允许 `CODEX_HOME/sessions/**/rollout-*.jsonl`
  - 翻译接口不回显任何 secret；错误信息做最小化
- **性能:**
  - 离线仅 tail N 行（沿用 `tail_lines` 上限）
  - 双标签栏新增固定元素，不引入大面积动画；保持现有 z-index 体系与 safe-area inset

## 测试与部署
- **测试:**
  - 单元测试：离线路径校验、离线消息 id/key 生成稳定性
  - 手工验证：UI 三列表/双标签栏、离线打开/关闭展示、离线翻译回填、导出译文补齐
- **部署:** 本项目为本机服务，无额外部署流程；修改后重启 sidecar 进程即可

