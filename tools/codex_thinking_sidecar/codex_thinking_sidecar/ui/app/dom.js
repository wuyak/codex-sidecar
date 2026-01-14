export function getDom() {
  const byId = (id) => document.getElementById(id);
  return {
    statusText: byId("statusText"),
    debugText: byId("debugText"),

    cfgHome: byId("cfgHome"),
    watchHome: byId("watchHome"),
    autoStart: byId("autoStart"),
    followProc: byId("followProc"),
    onlyWhenProc: byId("onlyWhenProc"),
    procRegex: byId("procRegex"),
    replayLines: byId("replayLines"),
    includeAgent: byId("includeAgent"),
    displayMode: byId("displayMode"),
    pollInterval: byId("pollInterval"),
    scanInterval: byId("scanInterval"),

    translatorSel: byId("translator"),
    httpProfile: byId("httpProfile"),
    httpProfileAddBtn: byId("httpProfileAddBtn"),
    httpProfileRenameBtn: byId("httpProfileRenameBtn"),
    httpProfileDelBtn: byId("httpProfileDelBtn"),
    httpUrl: byId("httpUrl"),
    httpToken: byId("httpToken"),
    httpTimeout: byId("httpTimeout"),
    httpAuthEnv: byId("httpAuthEnv"),

    saveBtn: byId("saveBtn"),
    recoverBtn: byId("recoverBtn"),

    sidebarToggleBtn: byId("sidebarToggleBtn"),
    startBtn: byId("startBtn"),
    stopBtn: byId("stopBtn"),
    clearBtn: byId("clearBtn"),
    configToggleBtn: byId("configToggleBtn"),
    drawerOverlay: byId("drawerOverlay"),
    drawer: byId("drawer"),
    drawerCloseBtn: byId("drawerCloseBtn"),
    shutdownBtn: byId("shutdownBtn"),
    scrollTopBtn: byId("scrollTopBtn"),
    scrollBottomBtn: byId("scrollBottomBtn"),

    tabs: byId("tabs"),
    list: byId("list"),
  };
}

