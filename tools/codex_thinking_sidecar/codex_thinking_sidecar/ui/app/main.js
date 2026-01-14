import { getDom } from "./dom.js";
import { connectEventStream } from "./events.js";
import { loadControl, maybeAutoStartOnce, setStatus, wireControlEvents } from "./control.js";
import { bootstrap, refreshList } from "./list.js";
import { renderEmpty, renderMessage } from "./render.js";
import { createState } from "./state.js";
import { renderTabs, upsertThread } from "./sidebar.js";

export async function initApp() {
  const dom = getDom();
  const state = createState();

  const onSelectKey = async (key) => {
    state.currentKey = key;
    // When multiple Codex sessions exist, auto-follow may jump between rollout files.
    // Selecting a session in the sidebar pins the watcher to that thread/file so the
    // visible log keeps updating for the chosen session.
    try {
      if (key === "all") {
        await fetch("/api/control/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "auto" }),
        });
      } else {
        const t = state.threadIndex.get(key) || {};
        const threadId = (t.thread_id || key || "").toString();
        const file = (t.file || "").toString();
        await fetch("/api/control/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "pin", thread_id: threadId, file }),
        });
      }
    } catch (_) {}
    await refreshList(dom, state, renderTabsWrapper, renderMessage, renderEmpty);
  };

  const renderTabsWrapper = (d, s) => renderTabs(d, s, onSelectKey);
  const refreshListWrapper = async () => await refreshList(dom, state, renderTabsWrapper, renderMessage, renderEmpty);

  wireControlEvents(dom, state, {
    refreshList: refreshListWrapper,
    renderTabs: () => renderTabsWrapper(dom, state),
  });

  await loadControl(dom, state);
  await maybeAutoStartOnce(dom, state);
  await loadControl(dom, state);

  await bootstrap(dom, state, renderTabsWrapper, renderMessage, renderEmpty);
  connectEventStream(dom, state, upsertThread, renderTabsWrapper, renderMessage, setStatus);
}
