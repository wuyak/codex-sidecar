
# How: UI wire 拆分（secrets/sfx）（Phase39）

- 新增 `ui/app/control/wire/secrets.js`：封装密钥字段显示/隐藏与按需 `/api/control/reveal_secret` 拉取逻辑。
- 新增 `ui/app/control/wire/sfx.js`：封装提示音下拉保存配置与试听逻辑。
- `ui/app/control/wire.js` 仅保留编排调用与其它未拆分功能域。

