# 任务清单: 离线展示会话（展示中）+ 双标签栏

目录: `helloagents/plan/202601210025_offline_showcase_tabs/`

---

## 1. 后端 API（离线一致性 + 翻译复用）
- [ ] 1.1 在 `codex_sidecar/http/handler.py` 中新增 `POST /api/control/translate_text`（调用 `controller.translate_text`），验证离线 UI/导出不依赖 watcher
- [ ] 1.2 在 `codex_sidecar/http/handler.py` 的 `GET /api/offline/messages` 中统一 `key` 编码规则（`offline:${encodeURIComponent(rel)}` 的等价实现），并保持原安全校验不回退
- [ ] 1.3 在 `codex_sidecar/offline.py` 中按 `off:${key}:${sha1(rawLine)}` 生成离线 `messages[].id`（确保稳定且与 Live 不冲突）

## 2. UI：双标签栏 + 三列表会话管理
- [ ] 2.1 在 `ui/index.html` 增加“展示标签栏”容器（在现有监听标签栏上方），并确保 `data-tabs-collapsed` 可同时隐藏两行
- [ ] 2.2 在 `ui/styles.css` 中为双标签栏调整布局（底部定位、#main padding-bottom、corner-notify 避让、安全区 inset），避免遮挡右侧按钮
- [ ] 2.3 在 `ui/app/dom.js` 增加展示标签栏 DOM 引用
- [ ] 2.4 在 `ui/app/sidebar/tabs.js` 扩展 `renderTabs`：分流渲染 offline/live 到不同 host；并为 offline 标签提供“移除展示/关闭展示”语义（不写入 hiddenThreads）
- [ ] 2.5 在 `ui/app/control/wire.js` 中把抽屉列表改为三列表：监听中/展示中/关闭监听；并提供从“最近文件”加入展示中/打开离线会话的动作
- [ ] 2.6 在 `ui/app/offline.js` 中实现 `offlineKeyFromRel/offlineRelFromKey` 的 encode/decode 规则，并更新所有调用点保持一致
- [ ] 2.7 在 `ui/app/list/refresh.js` 中确认离线会话 refresh 逻辑仍可按 key 正确过滤与渲染

## 3. UI：离线翻译回填 + 本地缓存（M2）
- [ ] 3.1 在 `ui/app/interactions/thinking_rows.js` 中：当 `state.currentKey` 为离线 key 时，点击“翻译/重译”改为调用 `/api/control/translate_text`（或兼容 fallback），并使用 `renderMessage(..., { patchEl })` 回填译文
- [ ] 3.2 在 `ui/app` 增加离线译文缓存读写（`localStorage offlineZh:${rel}`），并在打开离线会话/导出前合并缓存到 messages
- [ ] 3.3 在 `ui/app/export.js` 中将离线导出补齐译文改为读取/写入 `offlineZh:${rel}`（与 UI 行为一致），并优先走 `/api/control/translate_text`

## 4. 安全检查
- [ ] 4.1 执行安全检查（输入校验、路径限制、敏感信息处理、翻译接口最小返回、避免引入新的外部执行入口）

## 5. 文档与知识库同步
- [ ] 5.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`：补充“展示中/监听中”与离线翻译入口说明
- [ ] 5.2 更新 `helloagents/CHANGELOG.md`：记录新增双标签栏、三列表与翻译接口

## 6. 测试
- [ ] 6.1 在 `tests/` 增加离线 key/id 生成与路径校验的单元测试（覆盖 encode/decode、一致性与安全边界）
- [ ] 6.2 本地手工验证：打开离线会话、关闭展示标签、离线翻译回填、导出译文补齐

