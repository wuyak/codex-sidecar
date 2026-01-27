# README 全量版“信息挖掘方案”（加深版）- Tasks

> 说明：本任务清单用于“信息要大而全、还能回溯到代码”的 README.DRAFT.md 挖掘与编排。
>
> 目标：把项目主体说明 + 全部功能区 + 每个 UI 按钮/设置项 + 每类信息展示块 + 对应后端接口/前端模块都写清楚，并便于后续裁剪成对外 README。
>
> 执行要求（强制）：
> - **持续推进**：从头到尾持续执行本文件所有任务，直到全部任务完成；不因阶段切换或中途结果而自动停止。
> - **不需确认**：执行过程中不要求用户逐步确认/选择；遇到缺失信息时以代码为准继续挖掘并自行补齐。
> - **唯一例外**：如遇到 EHRB 风险或需要系统级权限审批的操作，必须暂停并明确提示风险/原因后再继续。
>
> 交付物：
> - `README.DRAFT.md`：主干章节（A）+ 3 个超长附录表（C）+ 完整性自检清单（D）
> - 附录 A：UI 控件映射表（id → 行为 → API → 代码定位）
> - 附录 B：Config 字段索引（key path → 默认值 → UI → 生效时机 → 安全说明）
> - 附录 C：HTTP API 索引（method/path → 用途 → handler → 前端调用点）
>
> 约束与原则（写作口径）：
> - **以代码为准**：文档描述与运行时行为不一致时，以代码为准并在文档中写清差异/原因（必要时补充“已验证”说明）。
> - **不引入敏感信息**：任何 token/api_key/secret 不写入文档（只描述字段、脱敏与 reveal 行为）。
> - **可追溯**：关键行为必须能回溯到具体文件路径 + 关键函数/入口（前端/后端至少各 1 个锚点，或说明仅存在单侧）。
> - **全覆盖**：以“UI 控件 / API 端点 / 配置字段 / 消息 kind”四类索引为硬约束，不以“感觉写完了”为完成标准。
>
> 附录表格规范（必填列）：
> - 附录 A（UI 控件映射表）：`UI 区域` / `控件(id/文案/aria-label/icon)` / `交互(click/long-press/hover/右键/快捷入口)` / `行为` / `影响范围(UI/写入 config/影响 watcher/触发后端任务)` / `相关配置键` / `后端 API(method path + 关键参数)` / `前端定位(文件 + 关键函数/选择器)` / `后端定位(文件 + handler/函数分支)`
> - 附录 B（Config 字段索引）：`key path` / `默认值` / `说明` / `UI 入口(抽屉/字段)` / `生效时机(立即/需重启/热更新)` / `敏感性与脱敏` / `reveal 行为(如有)` / `迁移规则(如有)`
> - 附录 C（HTTP API 索引）：`method` / `path` / `用途` / `输入(query/body)` / `输出(json 字段)` / `错误/失败条件` / `handler(后端定位)` / `前端调用点(文件 + 调用函数)`

## 0. 基础准备（口径与边界）

- [x] 0.1 明确 README.DRAFT 的定位：探索挖掘版（全量覆盖，可回溯到代码）
- [x] 0.2 明确项目边界：只读旁路、不注入/不接管 Codex 输入；写清“刻意不做什么”
- [x] 0.3 确认启动入口与文档口径统一（仅 `./run.sh` + `./run.sh --ui`），并记录默认端口与 `/ui`
- [x] 0.4 建立“全覆盖自检项”（UI 控件 / API / 配置字段 / 消息 kind 四类索引）

## 1. README.DRAFT.md 目录骨架（A. 输出结构）

- [x] 1.1 创建/更新目录骨架（先占位，后逐节填充）：A1–A15
- [x] 1.1.1 在 `README.DRAFT.md` 写入并固定如下目录标题（作为最终目录 SSOT）：
  - A1 一眼看懂（1 屏内）
  - A2 快速开始（用户向）
  - A3 核心工作方式（数据流与边界）
  - A4 UI 总览（页面结构地图）
  - A5 UI 控件与按钮全索引（重点：到“代码/接口”粒度）
  - A6 信息展示块（消息 kind）说明（每种块一个小节）
  - A7 设置项与配置文件全量说明（配置参考）
  - A8 翻译系统（深挖：provider/模式/安全/回填）
  - A9 历史文件/离线模式（查看历史对话文件）
  - A10 导出（Markdown）规范
  - A11 通知与长跑提醒（tool_gate + 声音）
  - A12 端口占用/自恢复/多实例（运行可靠性）
  - A13 安全与隐私
  - A14 FAQ / 排障
  - A15 开发者附录
- [x] 1.2 A1 一眼看懂（1 屏内）：一句话定位 + 3–5 场景 + 1–2 不做什么 + 2 行快速开始
  - 挖掘源：`README.md`、`codex_sidecar/cli.py`、`scripts/run.sh`、`ui/index.html`
- [x] 1.3 A2 快速开始（用户向）：环境要求、默认端口、参数与环境变量、run vs --ui 选择建议
  - 挖掘源：`codex_sidecar/cli.py`、`run.sh`、`scripts/run.sh`、`scripts/_common.sh`
- [x] 1.4 A3 核心工作方式（数据流与边界）：rollout 来源→解析→分类→渲染→（可选）翻译回填→SSE→UI 增量更新；解释 “每条消息从哪来”
  - 挖掘源：`codex_sidecar/watch/*`、`codex_sidecar/controller_core.py`、`codex_sidecar/server.py`、`ui/app/events/stream.js`
- [x] 1.5 A4 UI 总览（页面结构地图）：会话列表/书签栏、主时间线、右侧 Dock、设置抽屉、翻译抽屉、导入/导出入口；交互约定（单击/长按/右键）
  - 挖掘源：`ui/index.html`、`ui/styles.css`、`ui/app/main.js`
- [x] 1.6 A5 UI 控件与按钮全索引（重点）：把“控件 → 行为 → 配置键 → API → 代码”写成可检索的表（=附录 A）
  - 挖掘源：`ui/index.html`、`ui/app/dom.js`、`ui/app/control/*`、`ui/app/control/wire/*`、`ui/app/control/actions.js`、后端 routes/controller
- [x] 1.7 A6 信息展示块（消息 kind）说明：每种 kind 的来源/展示/交互/与其它块关系/导出呈现
  - 挖掘源：`ui/app/render/*`、`ui/app/decorate/*`、`ui/app/interactions/*`、`ui/app/format.js`、`ui/app/export.js`
- [x] 1.8 A7 设置项与配置文件全量说明（配置参考）：以“配置键路径”为主线（=附录 B）
  - 挖掘源：`codex_sidecar/config.py`、`config/sidecar/config.example.json`、`codex_sidecar/config_migrations.py`、`ui/app/control/config.js`、`ui/app/control/load.js`、`ui/app/control/ui_prefs.js`
- [x] 1.9 A8 翻译系统（深挖）：provider/模式/安全/回填/脱敏与 reveal
  - 挖掘源：后端 `codex_sidecar/control/translator_build.py`、`codex_sidecar/control/translator_specs.py`、`codex_sidecar/security.py`、`codex_sidecar/control/reveal_secret.py`；前端 `ui/app/control/wire/secrets.js`、`ui/app/interactions/thinking_rows.js`
- [x] 1.10 A9 历史文件/离线模式：导入/浏览历史入口、文件类型、离线拉取接口与 tail_lines、离线译文缓存（如有）
  - 挖掘源：`ui/app/control/wire/*import*`、`ui/app/offline*.js`、后端 `/api/offline/*` handler
- [x] 1.11 A10 导出（Markdown）规范：入口与选项、导出结构、过滤/合并规则、与 UI 一致性；明确“导出从正文开始”（无调试信息头）
  - 挖掘源：`ui/app/export.js`、`ui/app/export/*`
- [x] 1.12 A11 通知与长跑提醒：哪些情况会响铃/提示、去重策略、两类提示音区别（回答输出 vs 终端确认）
  - 挖掘源：`ui/app/sound.js`、`ui/app/control/wire/sfx.js`、`ui/sfx/manifest.json`、`ui/app/control/load.js`
- [x] 1.13 A12 端口占用/自恢复/多实例：health、锁文件与 PID 判断、只杀 sidecar 不误杀其它进程
  - 挖掘源：`scripts/_common.sh`
- [x] 1.14 A13 安全与隐私：配置范围、敏感字段与 gitignore、UI 脱敏、按需 reveal、公开仓库发布注意事项
  - 挖掘源：`.gitignore`、`codex_sidecar/security.py`、`README.md`（如有发布说明）
- [x] 1.15 A14 FAQ / 排障：按真实问题组织（看不到会话/目录不对、翻译不生效/超时、端口占用、为何不能用 UI 输入驱动 Codex、迁移配置但不带密钥）
- [x] 1.16 A15 开发者附录（全量版保留）：目录结构导览、API 端点索引、事件字段（SSE/schema）、如何跑测试、如何打包（如项目支持）

## 2. UI 全控件枚举（B-1，附录 A 素材）

- [x] 2.1 从 `ui/index.html` 抽取所有 `id=`（尤其 button/select/input/div）
- [x] 2.2 用 `ui/app/dom.js` 校验：`byId("...")` 列表与 HTML 一致（不漏/不多）
- [x] 2.3 对每个 id：全局搜索读写点，归纳“它做什么/影响范围”（仅 UI / 写入 config / 触发 watcher / 触发后端任务）
- [x] 2.4 对每个 id：定位事件绑定（click/pointer/longpress/右键/hover）与交互细节
- [x] 2.5 对每个 id：定位 API 调用（method/path/关键参数）与后端 handler
- [x] 2.6 生成“UI 控件映射表”（附录 A）：区域/控件/交互/行为/影响范围/配置键/API/前端定位/后端定位

## 3. 后端全 API 枚举（B-2，附录 C 素材）

- [x] 3.1 扫描 `codex_sidecar/http/routes_get.py`、`codex_sidecar/http/routes_post.py`、`codex_sidecar/server.py`：列出全部端点
- [x] 3.2 记录每个端点：输入参数（query/body）、输出字段、错误码/失败条件
- [x] 3.3 反向查找前端调用点：端点 → 调用模块 → 对应 UI 控件/行为（回填到附录 A/C）

## 4. 配置键全覆盖（B-3，附录 B 素材）

- [x] 4.1 以 `codex_sidecar/config.py` 的 `SidecarConfig` 为准，列出全部字段（含默认值与说明）
- [x] 4.2 以 `config/sidecar/config.example.json` 为“用户可见示例口径”，对齐字段可见性与写法
- [x] 4.3 从 `codex_sidecar/config_migrations.py` 提取迁移逻辑（写入 FAQ/升级说明：哪些旧值会被自动改）
- [x] 4.4 标注敏感字段：默认脱敏策略、UI “眼睛按钮” reveal 的行为与限制（不写入任何明文密钥）
- [x] 4.5 生成“Config 字段索引”（附录 B）：key/default/说明/UI 入口/生效时机/注意事项
- [x] 4.6 补充 UI 偏好（localStorage/prefs，如有）：key/default/说明（归入附录 B 或单独小表）

## 5. 行为与展示块对齐（B-4，消息 kind）

- [x] 5.1 以 UI 实际渲染为准：梳理 `ui/app/render/*` 中的块类型与布局
- [x] 5.2 梳理装饰/复制/折叠：`ui/app/decorate/*`
- [x] 5.3 梳理行内交互：`ui/app/interactions/*`
- [x] 5.4 以导出逻辑补充一致性：`ui/app/export.js`（过滤/合并/命名），反推“用户看见的结构”
- [x] 5.5 为每个消息 kind 写一段：来源/含义/UI 展示/交互/与其它块关系/导出呈现

## 6. 翻译系统（A8 细化）

- [x] 6.1 解释 auto/manual 的精确定义：范围、触发条件、失败与重试策略
- [x] 6.2 Providers：HTTP Profiles / OpenAI / NVIDIA 的字段、默认值、鉴权、超时、rpm/max_tokens/重试
- [x] 6.3 翻译回填机制：何时写 `op=update`；如何显示“已翻译/失败/重试”；in-flight 行为
- [x] 6.4 脱敏策略：哪些字段会被 mask；“眼睛按钮”按需 reveal 的流程与安全边界

## 7. 历史/离线/导入/导出（A9/A10）

- [x] 7.1 写清“查看历史对话文件”的入口（UI）与流程（前端 → 后端 → 文件/目录）
- [x] 7.2 写清离线消息拉取接口、`tail_lines` 行为与性能/边界
- [x] 7.3 写清导出入口与选项（精简/全量、思考译文策略）
- [x] 7.4 写清导出结构：标题/分段/每段的 kind+时间；哪些内容会被过滤/合并
- [x] 7.5 明确“导出从正文开始”的行为（无调试信息头），并与 UI 表现对齐

## 8. 通知与长跑提醒（A11）

- [x] 8.1 列出会触发提示音/通知的所有场景（包含 tool_gate）
- [x] 8.2 写清去重/防刷屏策略（避免回放/补齐导致刷屏）
- [x] 8.3 解释两类提示音差异（回答输出 vs 终端确认）与可配置项（如有）

## 9. 运行可靠性（A12）

- [x] 9.1 解释端口占用检测、自恢复策略、health 检测
- [x] 9.2 解释锁文件与 PID 判断策略（只杀 sidecar，不误杀其它进程）
- [x] 9.3 说明多实例行为与限制（同一目录/不同目录，冲突处理）

## 10. 安全与隐私（A13）

- [x] 10.1 明确配置范围：仅项目内/是否读全局；列出敏感字段类型（token/api_key 等）
- [x] 10.2 写清如何避免密钥入仓：`.gitignore` 与发布说明
- [x] 10.3 写清 UI 脱敏与按需 reveal：哪些字段 mask、何时可取回明文、不会持久化到导出（如适用）

## 11. 附录 A/B/C 三张长表生成（C. 输出形态）

- [x] 11.1 附录 A：UI 控件映射表（id → 行为 → API → 代码），每条含“定位锚点”（前端文件+函数/后端文件+handler）
- [x] 11.2 附录 B：Config 字段索引（key path → 默认值 → UI → 生效时机 → 注意事项/敏感说明）
- [x] 11.3 附录 C：HTTP API 索引（method/path → 用途 → handler → 前端调用点）

## 12. 完整性自检清单（D）

- [x] 12.1 `ui/index.html` 的所有 `id=` 都出现在附录 A
- [x] 12.2 `ui/app/dom.js` 的所有 `byId(...)` 都出现在附录 A
- [x] 12.3 `config/sidecar/config.example.json` 的所有顶层键都出现在附录 B
- [x] 12.4 `routes_get.py` / `routes_post.py` 的所有端点都出现在附录 C
- [x] 12.5 每个消息 kind 都有“展示 + 交互 + 导出”说明
- [x] 12.6 README.DRAFT 明确写了：只读旁路、不注入输入、敏感信息不入仓
