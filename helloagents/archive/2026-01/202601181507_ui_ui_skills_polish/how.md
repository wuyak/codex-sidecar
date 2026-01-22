# 技术设计: UI 审查与轻量优化（ui-ux-pro-max + ui-skills）

## 技术方案

### 核心技术
- 纯静态页面：HTML + CSS + ES Modules（不引入构建链/前端框架）
- 原生可访问组件：优先使用 `<dialog>` 实现确认弹窗（AlertDialog 语义）
- 设计系统来源：`ui-ux-pro-max` 产出的 “Developer Tool / Real-Time Monitor + Minimalism（Dark Mode）” 方向作为约束

### 实现要点
1. **Design tokens 约束（不大改现有皮肤体系）**
   - 保留现有 `:root` CSS Variables 与 `data-bm-skin` 皮肤机制
   - 逐步移除非必要装饰：`letter-spacing`、渐变、过强的玻璃效果
2. **安全区（safe-area）**
   - 在 `:root` 增加 `--safe-top/right/bottom/left: env(...)`，并把 fixed 元素的边距统一基于这些变量计算
3. **Reduced motion**
   - 增加 `@media (prefers-reduced-motion: reduce)`：禁用关键过渡/关键帧动画，仅保留必要可读性效果
4. **触控目标**
   - `@media (pointer: coarse)`：右侧按钮与会话项最小尺寸 ≥ 44px（桌面维持紧凑）
5. **破坏性操作确认（AlertDialog）**
   - `ui/index.html` 增加一个复用 `<dialog>`：支持标题/正文/确认按钮文本
   - `ui/app/control/*` 抽出 `confirmDialog()`：替换 `confirm()`（退出/重启/删除 Profile 等）
6. **就地错误提示**
   - `saveTranslateConfig` 等保存入口不再用 `alert()` 做“缺字段”提示
   - 通过在输入附近插入 `.field-error`（或复用现有容器）实现错误展示 + 聚焦定位
7. **空状态更“下一步导向”**
   - `renderEmpty()` 改为单一主动作导向文案（“点击 ▶ 开始监听/等待几秒”）
   - 诊断链接与高级说明移动到“调试信息/高级选项”中

## 安全与性能
- **安全:** 不新增任何会把敏感配置写入 DOM/日志的路径；继续保持配置脱敏与按需 reveal 的策略
- **性能:** 去除/弱化大面积 `backdrop-filter`；避免布局属性动画；为低动效偏好提供降级

## 测试与部署
- **测试:**
  - 运行现有单测：`python3 -m unittest discover -s tests -p 'test_*.py'`
  - UI 自检：桌面/移动端尺寸（375/768/1024） + 深色皮肤 + 键盘 Tab 导航
- **部署:** 无额外步骤（仍为静态 `/ui/*` + sidecar 服务）
