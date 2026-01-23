export function showShutdownScreen() {
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Sidecar 已退出</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 0; background: #0b1020; color: #e5e7eb; }
      .wrap { max-width: 720px; margin: 10vh auto; padding: 24px; }
      .card { background: rgba(255,255,255,.06); border: 1px solid rgba(226,232,240,.20); border-radius: 14px; padding: 18px 18px 14px; }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { margin: 8px 0; color: rgba(226,232,240,.90); line-height: 1.6; }
      .btns { display:flex; gap:10px; margin-top: 14px; flex-wrap:wrap; }
      button { border: 1px solid rgba(226,232,240,.25); background: rgba(255,255,255,.08); color: #e5e7eb; padding: 10px 12px; border-radius: 10px; cursor: pointer; }
      button:hover { background: rgba(255,255,255,.12); }
      .muted { color: rgba(226,232,240,.70); font-size: 12px; margin-top: 10px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: rgba(255,255,255,.10); padding: 2px 6px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Sidecar 已退出</h1>
        <p>监听已停止，服务已关闭。为避免误会，此页面已切换到离线提示页。</p>
        <div class="btns">
          <button type="button" id="closeBtn">关闭此标签页</button>
          <button type="button" id="reloadBtn">重新打开 UI</button>
        </div>
        <div class="muted">提示：浏览器可能限制脚本直接关闭非脚本打开的页面。你也可以手动关闭此标签页。</div>
      </div>
    </div>
    <script>
      (function () {
        var closeBtn = document.getElementById("closeBtn");
        var reloadBtn = document.getElementById("reloadBtn");
        if (closeBtn) closeBtn.onclick = function () { try { window.close(); } catch (e) {} };
        if (reloadBtn) reloadBtn.onclick = function () { try { window.location.href = "http://127.0.0.1:8787/ui"; } catch (e) {} };
      })();
    </script>
  </body>
</html>`;
  const url = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  try { window.location.replace(url); return; } catch (_) {}
  try { window.location.href = url; return; } catch (_) {}
  try { window.location.replace("about:blank"); } catch (_) {}
}

