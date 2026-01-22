# 技术设计: UI 提示系统统一与会话管理整改

## 技术方案

### 核心技术
- 原生 HTML/CSS/JS（现有项目形态）
- 提示机制以 `aria-label` + CSS tooltip 为主
- 必要的就地提示使用现有 DOM 节点（如标签页内的 `.bm-tip`）

### 实现要点

#### 1) 提示系统统一（核心）

目标：同一交互面只保留一种提示来源，避免“重复提示/叠加提示/滥用浮动 toast”。

- **右侧按钮（`.rightbar .icon-btn`）**
  - 统一使用 CSS `::after { content: attr(aria-label) }`
  - 移除 `title`（避免出现原生 tooltip 造成双信息栏）
  - 对需要动态内容的按钮（精简显示）改为动态更新 `aria-label`

- **右下角浮动按钮（`.float-nav button`）**
  - 补齐同款 tooltip 样式（向左浮现的信息栏）
  - 会话管理按钮 `aria-label` 统一为：`会话管理（长按可显示标签页）`
  - 折叠/展开标签页的长按交互保持，但移除 toast 提示

- **底部标签页（`#bookmarks .bookmark`）**
  - 不使用 toast（`flashToastAt`）作为 hover 提示
  - 使用标签内部 `.bm-tip` 作为“就地信息栏”，并确保：
    - 悬停标签主体：显示重命名提示
    - 悬停关闭按钮（×）：仅显示关闭监听提示
    - 不出现两条提示叠加
  - 移除 `.bm-label` / `.bm-close` 上的 `title`

- **会话管理抽屉（`.tab` 列表）**
  - 移除“点击：切换会话”等提示（不再设置 `data-hint`，也不再触发 toast）
  - 将原本显示文件名的副标题区域改为更有价值的提示文案：
    - `长按可复制对话 JSON 源文件路径`（可精简为 `长按复制 JSON 路径`）
  - 如需复制能力：为行增加长按复制路径逻辑（避免与点击切换冲突）

#### 2) 导出按钮 4 状态角标

目标：导出按钮始终为一个按钮，通过角标展示导出偏好组合（精简/译文）。

- 继续沿用现有会话级导出偏好存储（`ui/app/export_prefs.js`）
- 在会话管理抽屉的导出按钮上使用类名组合：
  - `flag-quick` → 闪电标
  - `flag-tr` → 地球标
- CSS 实现 `.mini-flag` 绝对定位角标并默认隐藏，仅在对应类存在时显示

#### 3) 导出设置弹层整改（层级 + 内容）

目标：导出设置弹层始终在最上层，且不出现冗余“当前会话”信息。

- 为 `.popup-dialog`（或 `#exportPrefsDialog`）设置明确 `z-index`，确保高于会话管理抽屉
- 删除 `exportPrefsDialog` 内“当前会话”展示块，仅保留两条设置项
- 保持选项显示为 `精简/全量`、`译文/原文`
- 导出按钮 hover 信息统一为：`导出（长按设置）`（由 `aria-label` 提供）

#### 4) 精简显示弹层 UI 对齐

目标：将渲染结构从旧的 checkbox 列表统一为当前 CSS 里已定义的 `qk-panel/qk-row` 风格。

- `ui/app/quick_view_settings.js` 渲染改为：
  - 行元素使用 `.qk-row`（button-like）
  - 通过 `aria-pressed` 表达选中状态
  - 左侧使用 `.qk-dot` 显示勾选符号（非原生 checkbox）
  - 保持键盘可达与可读性（focus-visible 样式已存在）

#### 5) 顶部状态栏移除

目标：移除顶部右侧状态汇总条（截图 `右上角状态栏.png`）。

- 从 `ui/index.html` 移除 `#statusText/#statusHover` 对应 DOM
- `ui/app/dom.js` 仍可保留字段但返回 `null`（或同步删除字段并确保调用处兜底）
- 相关更新逻辑（`setTopStatusSummary` / `load.js`）保持容错不报错

## 安全与性能
- **安全:** 不引入外部依赖，不新增敏感信息读写；复制功能仅处理本地路径字符串
- **性能:** 移除 hover toast 可减少 DOM 插入与定时器；tooltip 由 CSS 负责，避免高频 JS

## 测试与部署
- **自动化:** 运行 `pytest -q`（确保安全相关测试不受影响）
- **手动验证:**
  - 对照 `修改意见整理/*.png` 验证提示文案、是否重复、是否叠加
  - 验证导出按钮角标 4 组合、导出设置弹层层级与内容
  - 验证精简显示弹层样式与交互（鼠标/键盘）

## Git 提交策略（用户要求）

已确认采用**更细**的提交粒度：以“每个独立交互面/单条整改项”为一次提交，保证随时可回滚对照。

建议提交切分（可在实现中微调，但不合并到少于 6 次）：

1. `refactor(ui): tooltip SSOT via aria-label`（统一 tooltip 数据源，消除 `title/toast` 混用的基础设施改动）
2. `fix(ui): quick view button hint & active`（精简显示按钮：单一提示 + 动态文案 + 更明显的 active 态）
3. `fix(ui): session menu hint; no toast on long-press`（会话管理按钮：单一提示；长按折叠/展开不弹浮动提示）
4. `refactor(ui): tabs inline hints (rename/close)`（底部标签：改用 `.bm-tip` 就地提示；文案按需求；消除叠加浮动）
5. `fix(ui): session drawer remove switch hints`（会话管理抽屉：移除“点击切换会话”等提示）
6. `feat(ui): export button badges`（导出按钮 4 状态角标：原生/闪电/地球/双角标）
7. `fix(ui): export prefs popover z-index & content`（导出设置弹层：层级修复 + 移除冗余“当前会话”）
8. `refactor(ui): quick view dialog list UI`（精简显示弹层：改为 `qk-panel/qk-row` 结构与样式）
9. `chore(ui): remove top status bar`（移除顶部右侧状态栏）
10. `feat(ui): drawer long-press copy json path`（会话管理抽屉：长按复制 JSON 源路径提示与功能）
11. `docs: update kb & archive plan`（知识库/CHANGELOG 更新 + 方案包迁移至 history）
