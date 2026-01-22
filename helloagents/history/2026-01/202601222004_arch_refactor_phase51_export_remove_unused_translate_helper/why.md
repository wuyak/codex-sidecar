# Why - Phase51 export remove unused translate helper

## 背景

`ui/app/export.js` 内保留了一个旧的 `_ensureReasoningTranslated(...)` 实现（通过 `/api/control/retranslate` + 轮询 `/api/messages` 等待回填），当前导出逻辑已不再调用该函数（已拆分为 direct/offline 两条路径），因此属于未引用遗留代码。

## 目标

- 删除未使用的翻译 helper，降低文件体积与维护成本。
- 保持现有导出行为不变（仍走 `_ensureReasoningTranslatedDirect/_ensureReasoningTranslatedOffline`）。

