export function createState() {
  return {
    httpProfiles: [],
    httpSelected: "",
    currentKey: "all",
    threadIndex: new Map(), // key -> { key, thread_id, file, count, last_ts }
    threadsDirty: false,
    threadsLastSyncMs: 0,
    callIndex: new Map(), // call_id -> { tool_name, args_raw, args_obj }
    rowIndex: new Map(), // msg.id -> rendered DOM element
    timeline: [], // [{ id, ms, seq }] for rendered rows (sorted)
    renderSeq: 0,
    bootAutoStarted: false,
    uiEventSource: null,
    sseEverOpen: false,
    sseHadError: false,
    lastRenderedMs: NaN,

    // 显示模式：full=全量；quick=仅输入/输出/思考（快速浏览）
    viewMode: "full",

    // 翻译模式（来自服务端 config）：auto | manual
    translateMode: "auto",
    translatorProvider: "stub",
    // 手动翻译防抖：mid -> in-flight
    translateInFlight: new Set(),

    // 多会话频繁切换：视图缓存（key -> DOM+索引），避免每次切换都全量 refreshList。
    listHost: null, // 原始 #list 容器（作为 view host）
    activeList: null, // 当前激活的 list-view 容器
    activeViewKey: "", // 当前激活 view 的 key（用于切换时保存滚动位置）
    viewCache: new Map(), // key -> { key, el, rowIndex, callIndex, timeline, lastRenderedMs, scrollY }
    viewLru: [], // keys by recency (oldest -> newest)
    viewMax: 4,

    // 刷新/渲染控制（用于频繁切换会话与长时间挂着时的稳定性/性能）
    isRefreshing: false,
    refreshToken: 0,
    refreshAbort: null,
    ssePending: [],
    ssePendingOverflow: false,
    sseFlushTimer: 0,

    // 非当前会话的 SSE 缓冲：切回该会话时回放到缓存视图；溢出则强制 refreshList 回源。
    sseByKey: new Map(), // key -> [msg...]
    sseOverflow: new Set(), // key -> true

    // Markdown 渲染缓存（用于频繁切换/重绘加速）
    mdCache: new Map(), // key -> { text, html }

    // 思考行局部显示模式（mid -> "en"|"zh"），用于单条切换（默认：未译=EN，已译=ZH）。
    thinkModeById: new Map(),
    thinkModeOrder: [], // LRU-ish for pruning
    thinkModeMax: 600,
  };
}
