export function createState() {
  return {
    httpProfiles: [],
    httpSelected: "",
    currentKey: "all",
    threadIndex: new Map(), // key -> { key, thread_id, file, count, last_ts }
    callIndex: new Map(), // call_id -> { tool_name, args_raw, args_obj }
    renderSeq: 0,
    bootAutoStarted: false,
    uiEventSource: null,
    lastRenderedMs: NaN,
  };
}
