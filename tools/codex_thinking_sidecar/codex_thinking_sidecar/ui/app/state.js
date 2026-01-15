export function createState() {
  return {
    httpProfiles: [],
    httpSelected: "",
    currentKey: "all",
    threadIndex: new Map(), // key -> { key, thread_id, file, count, last_ts }
    callIndex: new Map(), // call_id -> { tool_name, args_raw, args_obj }
    rowIndex: new Map(), // msg.id -> rendered DOM element
    timeline: [], // [{ id, ms, seq }] for rendered rows (sorted)
    renderSeq: 0,
    bootAutoStarted: false,
    uiEventSource: null,
    lastRenderedMs: NaN,

    // 刷新/渲染控制（用于频繁切换会话与长时间挂着时的稳定性/性能）
    isRefreshing: false,
    refreshToken: 0,
    refreshAbort: null,
    ssePending: [],
    sseFlushTimer: 0,

    // SDK 控制模式状态（由 /api/sdk/status 动态探测）
    sdkAvailable: false,
    sdkCsrfToken: "",
    sdkThreadId: "",
    sdkBusy: false,
  };
}
