# 任务清单: UI 审查与轻量优化（ui-ux-pro-max + ui-skills）

目录: `helloagents/plan/202601181507_ui_ui_skills_polish/`

---

## 1. 视觉与布局（Design System 对齐）
- [√] 1.1 移除 `letter-spacing`（顶栏标题/角标/分隔线），改用字号/字重/间距实现层级，验证 why.md#需求-更“克制”的状态信息
- [√] 1.2 移除书签热区渐变（`linear-gradient`），用纯色 + 边框替代，验证 why.md#需求-更“克制”的状态信息
- [√] 1.3 弱化/移除大面积 `backdrop-filter`（书签浮层等），并确保深色皮肤下对比度，验证 why.md#需求-更“克制”的状态信息
- [√] 1.4 引入 `env(safe-area-inset-*)` 统一 fixed 元素边距（书签/右侧按钮/浮动按钮/抽屉），验证 why.md#需求-更“克制”的状态信息

## 2. 动效与可访问性（ui-skills）
- [√] 2.1 增加 `prefers-reduced-motion: reduce` 降级（禁用关键过渡/关键帧），验证 why.md#需求-更“克制”的状态信息
- [√] 2.2 增加 `pointer: coarse` 下的触控目标放大（≥44px），验证 why.md#需求-更“克制”的状态信息

## 3. 破坏性操作确认（AlertDialog）
- [√] 3.1 增加可复用 `<dialog>`（AlertDialog 语义），替换退出/重启/删除 Profile 的 `confirm()`，验证 why.md#需求-破坏性操作更安全且不打断阅读

## 4. 表单错误就地提示
- [√] 4.1 保存翻译设置：缺字段时不再 `alert()`；在对应输入附近显示错误并聚焦定位，验证 why.md#需求-表单错误就地提示
- [√] 4.2 保存配置：保存失败时在抽屉内显示错误（靠近“保存”按钮），避免抢焦点，验证 why.md#需求-表单错误就地提示

## 5. 空状态与下一步
- [√] 5.1 `renderEmpty()` 改为单一“下一步”导向（开始监听/等待），调试信息移入“调试信息/高级选项”，验证 why.md#需求-更“克制”的状态信息

## 6. 安全检查
- [√] 6.1 审计：不引入新的敏感信息输出（DOM/title/console），验证 how.md#安全与性能

## 7. 文档更新
- [√] 7.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`（UI 行为说明）
- [√] 7.2 更新 `helloagents/CHANGELOG.md`（记录 UI 审查与优化点）

## 8. 测试
- [√] 8.1 运行 `python3 -m unittest discover -s tests -p 'test_*.py'`
- [?] 8.2 UI 冒烟：桌面/移动端尺寸 + 深色皮肤 + 键盘 Tab 导航
