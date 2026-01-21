# 技术设计: 项目整体架构优化（Phase 2）

## 技术方案（推荐）
以“**降低入口复杂度 + 复用同类能力 + 空转短路**”为主线，按后端→前端顺序分批推进。

## 现状分析（代码解析结果）
为避免“凭感觉重构”，本方案先对模块依赖做了静态解析（仅统计 ESM/Python import 关系，不代表运行时调用图）：

### 后端（Python：`codex_sidecar/`）
- 模块数：33
- 依赖环：0（无循环依赖）
- fan-out 最高（依赖最多的入口）：
  - `codex_sidecar/watcher.py`（7）
  - `codex_sidecar/controller.py`（5）
  - `codex_sidecar/cli.py`（5）
  - `codex_sidecar/http/handler.py`（5）
- 结论：优先把 **handler/controller/watcher** 做“薄入口 + 少分叉”，可以以最小改动换最大维护收益。

### 前端（ESM：`ui/app/`）
- 模块数：90
- 依赖环：0（无循环依赖）
- fan-out 最高（编排最重的入口）：
  - `ui/app/control/wire.js`（20）
  - `ui/app/main.js`（18）
- 结论：优先拆分/收敛 **wire/main** 的职责边界，降低“一个文件改动牵一身”的风险。

### 1) 后端：让 Handler/Controller 更薄
#### 1.1 HTTP handler 收敛为“路由 + 调用”
- 统一 JSON body 读取、错误响应、常用参数解析（避免多处 try/except 样板）
- 翻译入口统一：`/api/control/translate_text` 与 `/api/offline/translate` 复用同一内部处理路径（已具备基础，继续完善一致性）
- 尽量减少 handler 对“业务细节”的了解：handler 只做输入校验与调用 controller/offline 模块

#### 1.2 Controller 内部逻辑按“职责块”重排
- 将翻译相关逻辑（probe/text/items）在 controller 内部统一为一条路径，复用“构建 translator / 读取 last_error / 解析模型名 / 生成响应”的公共代码
- 将 watcher 热更新配置的逻辑集中管理（减少 patch_config 内的散落 try/except）
- 不引入新依赖；尽量在同文件内通过 helper 减少重复

### 2) watcher：减少空转与状态分叉
- 对“无增量”场景做短路（避免不必要的 open/read、避免重复计算）
- 对 follow target 刷新与 poll 读取的边界条件做一致性整理：`idle/wait_*` 时不跟随、不轮询；有 target 才做最小工作

### 3) 前端：降低 orchestration 模块的耦合
#### 3.1 `control/wire.js` 渐进拆分（不改行为）
目标不是“更抽象”，而是把超大文件拆成几块**直接可读**的功能域：
- 导入/展示名单相关 wiring
- 导出相关 wiring（含并发/提示）
- 设置抽屉 wiring（含保存/热加载）
- 会话管理与标签栏交互 wiring

拆分策略：保持 `wire(dom, state, ...)` 的外部签名不变，只把内部函数迁到子模块并复用原有 util。

#### 3.2 `main.js` 降低 fan-out
把与“刷新/数据源选择（Live/Offline）”相关的决策集中到少数函数中，避免多处分散判断。

## 架构决策 ADR
### ADR-001: 优先“内部 helper/重排”而不是引入新框架
**决策:** 不引入新框架与外部依赖；通过 helper + 文件内重排 + 小模块拆分降低复杂度。

### ADR-002: 分批次、可回滚的重构策略
**决策:** 每个子模块重构完成即提交；确保任意时刻可回到稳定点。

## 测试与回归
- Python：`python3 -m compileall -q codex_sidecar` + `python3 -m unittest discover -s tests -p 'test_*.py'`
- JS：对改动文件执行 `node --check`（必要时补充最小“契约型”测试）

## 回归清单（不改功能）
以下场景必须在每个阶段提交前后做一次验证（可以通过 UI 手工验证，或用最小化脚本/单测覆盖关键契约）：
- Live：开始/停止监听、SSE 增量入库、threads/messages 刷新
- Offline：展示中列表、打开离线会话、离线消息渲染
- Translation：自动翻译/手动重译、离线翻译（不依赖 watcher）
- Export：导出 Markdown（精简/译文）与并发提示（避免卡住后批量下载）
