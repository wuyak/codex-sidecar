# UI 模板/设计系统调研报告（面向 codex-thinking-sidecar UI）

## 1. 背景与目标
当前 UI 为“纯静态（无构建）”的 HTML/CSS/Vanilla JS 页面，主要诉求是：

- 更精致、更一致的视觉与交互（信息密度高但不显乱）
- 维护成本可控（不引入重型前端工程化，尽量保持纯静态）
- 兼顾性能/可访问性（长列表、频繁 SSE 更新、移动端可用）
- 便于扩展“皮肤/主题”（浅色/深色、颜色体系、图标体系）

## 2. 项目约束（非常关键）
结合当前仓库实现方式，建议把模板选择分成两类：

1) **可直接集成（零构建）**：只需引入编译后的 CSS/JS（本地或 CDN），即可在现有静态页面上逐步替换样式与组件。
2) **需要构建/框架**：React/Vue/Next 等模板通常需要 Node 构建链；改造成本更高，且会显著改变项目形态（不建议作为第一步）。

本项目更适合先走“零构建可集成”的路线：先把“基础美化 + 设计系统”做出来，再视情况升级工程化。

## 3. 候选方案一览（按“零构建可集成”优先）

### A. Tabler（Bootstrap 5 Dashboard UI Kit）
- 定位：完整的后台 UI Kit（页面/组件/图标/排版都比较成熟）。
- 许可证：MIT（开源免费版）。参考：
  - `https://github.com/tabler/tabler`（MIT）
  - `https://docs.tabler.io/ui/getting-started/license/`
  - `https://docs.tabler.io/ui/getting-started/installation/`（CDN/本地均可）
- 优点：
  - 观感“像专业产品”，默认就很精致
  - 组件齐全（按钮、表单、drawer、badge、tabs、toast、cards…）
  - 图标体系完整（Tabler Icons，MIT）
  - 可渐进式接入：先引入基础 CSS，再逐块替换 class 与组件
- 风险/成本：
  - 体积与组件复杂度更高（比纯手写 CSS 重）
  - 使用 Bootstrap 体系会影响现有 DOM 结构（需要逐步迁移）
- 适合：你想“最快变好看”，且能接受引入一套 UI Kit 体系。

### B. AdminLTE（Bootstrap Admin Template）
- 定位：经典后台模板，生态/插件多，成熟度高。
- 许可证：MIT。参考：
  - `https://github.com/ColorlibHQ/AdminLTE`
  - `https://adminlte.io/themes/v4/docs/license.html`
- 优点：
  - 大量现成页面和布局范式，适合做“后台工具型 UI”
- 风险/成本：
  - 相对更“传统后台风”，视觉可能不如 Tabler 轻盈
  - 集成的插件与历史包袱可能更重（需要谨慎挑选用到的部分）
- 适合：你更偏“后台管理系统”风格，且愿意做取舍/瘦身。

### C. CoreUI Free（Bootstrap Admin Template）
- 定位：Bootstrap 5 的管理后台模板，提供企业化组件与多主题。
- 许可证：MIT。参考：
  - `https://github.com/coreui/coreui-free-bootstrap-admin-template`
  - `https://coreui.io/product/free-bootstrap-admin-template/`
- 优点：
  - 组件与主题较完整，文档较全
- 风险/成本：
  - 风格更偏“企业后台”，需要做视觉对齐以贴合当前轻量工具属性
- 适合：你想有“现成后台框架感”，又希望有更体系化的组件库支撑。

### D. Volt（Bootstrap 5 Dashboard, Vanilla JS）
- 定位：Bootstrap 5 + 原生 JS 的仪表盘模板（强调不依赖 jQuery）。
- 许可证：MIT。参考：
  - `https://github.com/themesberg/volt-bootstrap-5-dashboard`
  - `https://themesberg.com/product/admin-dashboard/volt-bootstrap-5-dashboard`（提到 MIT）
- 优点：
  - 偏现代审美，且强调 Vanilla JS，契合当前项目形态
  - 组件与页面比“纯 CSS 框架”更完整
- 风险/成本：
  - 仍是 Bootstrap 体系，迁移依旧需要“改 DOM + class”
- 适合：想要“比 Tabler 更轻一点的后台模板”，同时不想引入 jQuery。

### E. Start Bootstrap（SB Admin / SB Admin 2）
- 定位：偏入门友好的后台模板，结构简单、容易改。
- 许可证：MIT。参考：
  - `https://github.com/StartBootstrap/startbootstrap-sb-admin`
  - `https://github.com/StartBootstrap/startbootstrap-sb-admin-2`
- 优点：
  - 简单直接，改造成本相对低
  - 适合把“当前 UI”快速换成更干净的后台布局
- 风险/成本：
  - 默认观感相对“朴素”，如果追求更高级的质感可能仍需二次设计
- 适合：希望先有一个“能看”的成熟布局，再慢慢提升细节。

## 4. 候选方案（轻量 CSS 框架 / 设计系统）
这类方案不是“完整后台模板”，但非常适合当前项目做“渐进美化”，且不会引入工程化。

### F. Pico.css（语义化 Minimal CSS）
- 定位：给原生 HTML 标签直接上样式，几乎不需要写 class。
- 许可证：MIT。参考：
  - `https://picocss.com/`
  - `https://github.com/picocss/pico`
- 优点：
  - 引入成本极低，适合先把表单/抽屉/按钮整体变好看
  - 不强依赖复杂结构，适配现有页面更顺滑
- 风险/成本：
  - “后台模板感”不强，更像“精致的文档/表单/工具页”
- 适合：你想维持“轻量工具”气质，而不是变成完整后台管理系统。

### G. Spectre.css（轻量组件 CSS 框架）
- 定位：小体积、基础组件齐全。
- 许可证：MIT。参考：
  - `https://github.com/picturepan2/spectre`
- 优点：
  - 体积小、组件覆盖适中，适合工具型 UI
- 风险/成本：
  - 默认风格相对中性，仍需你做品牌化/主题化

### H. Halfmoon（带暗黑模式的 Bootstrap-like 框架）
- 定位：强调暗黑模式与 CSS variables。
- 许可证：MIT。参考：
  - `https://www.gethalfmoon.com/docs/download/`
- 优点：
  - 暗黑模式与主题化对“长时间挂着的 sidecar”很实用
- 风险/成本：
  - 生态/流行度低于 Bootstrap/Tabler，需要评估长期维护预期

## 5. 组件化方案（零构建但更现代）

### I. Shoelace（Web Components）
- 定位：可通过 CDN 引入的 Web Components（按钮、抽屉、对话框、tooltip 等）。
- 许可证：MIT。参考：
  - `https://github.com/shoelace-style/shoelace`（MIT）
- 优点：
  - 可只拿你需要的组件，逐步替换现有控件（drawer、tooltip、button…）
  - 无框架依赖，适合本项目的“纯静态 + 原生 JS”
- 风险/成本：
  - 引入自定义元素后，UI 结构与样式体系会产生“混合栈”，需要设计规范来约束

## 6. 颜色体系与图标（可独立引入，提升质感非常明显）

### Radix Colors（颜色系统）
- 许可证：MIT。参考：
  - `https://github.com/radix-ui/colors`
- 价值：
  - 用一套可访问性更好的颜色阶梯，快速提升“对比度/状态色/hover/active”一致性

### Tabler Icons / Heroicons / Lucide（图标体系）
- Tabler Icons：MIT。参考 `https://github.com/tabler/tabler-icons`
- Heroicons：MIT（适合更简洁的线性图标风格）
- Lucide：ISC（也很常见）
- 价值：
  - 当前 UI 使用字符图标（例如符号按钮），替换为统一 SVG 图标后“专业感”会立刻提升

## 6.1 设计范式参考（对当前“右侧 Dock + 书签栏”最直接）

### Material Design：Navigation rail（垂直导航轨）
- 参考：
  - `https://m3.material.io/components/navigation-rail/overview`
- 可借鉴点（贴合当前书签栏）：
  - “窄条 + 图标/标记 + 选中态”的信息架构非常接近；适合高频切换、多会话场景
  - 可用“当前会话自动展开、其他会话收起”的方式减少占用（类似 rail 的 extended/selected 强化）
  - 视觉上建议强化：选中态、hover、未读徽标三者的层级与对比度（避免既占空间又不清晰）

### Material Design：FAB（浮动操作按钮）
- 参考：
  - `https://m3.material.io/components/floating-action-button/overview`
- 可借鉴点（贴合当前右侧操作栏）：
  - 右侧操作栏本质是“多按钮的 FAB 变体/扩展”：需要明确主次（最常用的 1-2 个动作最突出）
  - 建议统一按钮的 hover/focus/active/disabled 反馈与触控热区，避免“看得到点不到/层级不对”的挫败感

## 7. 推荐路径（按风险/收益排序）

### 路径 1（最低风险、收益立竿见影）：继续保持“纯静态”，引入设计系统
1) 统一设计 token：颜色（Radix Colors）+ 间距/圆角/阴影（CSS variables）
2) 统一图标：用 Tabler Icons 或 Heroicons 替换字符按钮
3) 做 2-3 套皮肤：default / flat / dark（都用 `data-*` + CSS variables 切换）
4) 把现有组件（书签、抽屉、toast、pill、row）做“组件级样式规范化”

适合：你非常在意“保持简洁与可维护”，不想引入大模板，但要显著变好看。

### 路径 2（中等风险、最像成品）：选择 Tabler/Volt 作为整体 UI Kit
1) 先仅引入 Tabler（或 Volt）的 compiled CSS（本地 vendor 化）
2) 逐块迁移：按钮/表单/抽屉 → row 卡片 → 列表布局 → 工具栏/书签栏
3) 保留现有 JS 结构（events/render/list），只替换 DOM 与 class

适合：你想 UI 直接跃迁到“专业后台风”，并愿意接受 CSS 体系替换。

### 路径 3（最高收益但成本最大）：重写为 React/Vue + 组件库
这会带来构建链、路由、状态管理等变化；除非你准备把 sidecar UI 做成长期演进的“产品级前端”，否则不建议作为第一步。

## 8. 具体落地建议（结合当前 UI 结构）
建议优先改造的“高感知区域”：

1) **右侧工具栏**：改为统一 SVG 图标 + hover/focus 态；提供 “active/disabled/loading” 三态规范
2) **抽屉（配置/翻译）**：改为更现代的 drawer（可用 Tabler/Shoelace 的样式范式），并统一表单组件间距
3) **消息卡片（row）**：用更细腻的排版与层级（标题/时间/类型徽章/内容区域）
4) **书签栏**：已具备基础交互；下一步做“皮肤化 + hover 展开动画更顺滑 + 未读徽章更精致”

## 9. 明确不建议（除非你愿意接受明显复杂度上升）
- 直接上 Tailwind + 组件库（Flowbite 等）：虽然看起来很现代，但通常需要构建链与 class 体系迁移，后续维护成本更高。
- 直接套“付费主题市场模板”（ThemeForest 等）：短期好看，但授权/二次分发/长期维护不确定性更高。

## 10. 本仓库落地结论（2026-01-17）

为解决“交互状态临时手工管理、书签易错、浮层层级不稳定”等问题，本仓库曾评估过 **Vue 3 + Vite + Pinia** 的 UI v2 作为实验入口；但为避免丢失既有优化能力、降低维护成本，当前仍以 legacy 静态 UI（`/ui`）为主，UI v2 已归档到 `old/` 仅供参考：

- 默认 UI（legacy）：`/ui`（源码目录：`ui/`）
- 回滚/对照（legacy 快照）：已归档到 `old/`（不再提供 `/ui-legacy` 路由）
- UI v2（已归档）：`old/tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2/`（不再提供 `/ui-v2` 路由）

> 备注：本报告中“零构建可集成”的模板/设计系统仍可作为备选路径参考；UI v2 的迁移以“逐项确认保留 legacy 交互与筛选能力”为约束推进。
