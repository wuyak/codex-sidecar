# 技术设计: UI 主题与提示音整体重做（Manifest 驱动）

## 技术方案

### 核心技术
- 后端：Python 标准库 HTTP 服务（`codex_sidecar/http/*`）
- 前端：纯静态 UI（`ui/`，无构建）
- 数据：JSON manifest（主题/音效），localStorage（主题本机记忆），sidecar `config.json`（提示音持久化）

### 实现要点
- 主题/音效均采用“manifest → 运行时应用”的方式，避免散落在 CSS/JS/HTML 的硬编码列表。
- 自定义音效仅允许从 `${config_home}/sounds/` 扫描与读取，且必须有严格的输入校验与路径安全检查。
- 全程按 `$ui-skills` 把关：
  - 不引入不必要动画；如需要动效仅限 `opacity/transform` 且 ≤200ms，并尊重 `prefers-reduced-motion`
  - 图标按钮必须有 `aria-label`
  - fixed 元素继续尊重 `safe-area-inset`
  - 错误就地提示，避免 `alert()/confirm()`
  - 保持既有 `z-index` 量表，不新增随意的层级

## 架构设计

### 主题（Theme）分层
- `ui/themes/manifest.json`：主题清单与 tokens（颜色/圆角/阴影/间距/字体等）
- `ui/app/theme.js`：加载 manifest、渲染主题下拉、应用 tokens、localStorage 记忆
- `ui/styles.css`：只消费 tokens（`var(--token)`），不再包含“多套 skin 的大量覆盖块”

### 提示音（SFX）分层
- `ui/sfx/manifest.json`：内置音效清单（id/label/文件名/推荐用途）
- `${config_home}/sounds/`：用户自定义音效目录（手动放入文件）
- `GET /api/sfx`：后端返回“内置 + 自定义”的合并列表与当前选择（供 UI 动态渲染）
- `GET /api/sfx/file/<name>`：后端受限读取自定义文件（按文件名）

## 架构决策 ADR

### ADR-001: 主题与音效改为 Manifest 驱动（采纳）
**上下文:** 现有实现通过 HTML option + CSS skin 块 + JS 零散逻辑拼接，难以扩展且难维护。  
**决策:** 主题/音效均使用 JSON manifest 作为 SSOT，UI 运行时加载并应用。  
**理由:**  
- 变更集中、可审计、可扩展（新增主题/音效无需改多处）  
- 易于做到“精选（少而精）”与“破坏性整体重做”  
**替代方案:** 继续用 CSS/HTML 硬编码追加 → 拒绝原因: 维护成本与一致性风险高。  
**影响:** 需要一次性重构 CSS tokens 与 UI 设置渲染逻辑。

### ADR-002: 自定义音效采用配置目录扫描 + 受限读取接口（采纳）
**上下文:** UI 为静态页面，无法直接读取本地文件系统。  
**决策:** 后端提供扫描与受限读取 API，仅允许访问 `${config_home}/sounds/`。  
**理由:** 满足“零构建/本地资源/用户可自定义”的约束，同时可控且可加安全限制。  
**替代方案:** UI 上传文件并由后端写入 → 拒绝原因: 增加写入接口与安全面，且用户已接受手动放入目录。  
**影响:** 需要新增 API 路由与输入校验；需要文档说明目录位置与支持格式。

## API 设计

### [GET] /api/sfx
- **响应:** 返回可用音效列表与当前配置
  - `builtin`: 来自 `ui/sfx/manifest.json`
  - `custom`: 来自 `${config_home}/sounds/` 扫描结果（文件名）

### [GET] /api/sfx/file/<name>
- **描述:** 读取 `${config_home}/sounds/<name>` 并返回音频 bytes
- **安全:** `name` 必须通过文件名白名单校验；resolve 后父目录必须为 `${config_home}/sounds/`；扩展名与大小受限

## 安全与性能
- **安全:**
  - 路径穿越防护：拒绝包含 `/`、`\\`、`..`、控制字符的 name；使用 `Path.resolve()` 校验父目录
  - 扩展名白名单：`.ogg/.mp3/.wav`
  - 大小上限：默认设置单文件上限（实现中可配置/常量），避免巨文件导致内存/带宽问题
- **性能:**
  - `/api/sfx` 扫描目录可做轻量缓存（按 mtime/ttl），避免频繁 I/O
  - 音效预览与事件播放遵循浏览器限制；避免高频触发（保持现有节流思路）

## 测试与部署
- **测试:**
  - 为“文件名校验/路径 resolve 防护/扩展名过滤/大小限制”补充单元测试
  - 保持现有测试框架（`unittest`）
- **部署:**
  - 无构建；只需随代码发布 `ui/themes/manifest.json`、`ui/sfx/manifest.json` 与内置音效文件
  - 文档注明 `${config_home}/sounds/` 的位置（UI 已展示 config_home）

