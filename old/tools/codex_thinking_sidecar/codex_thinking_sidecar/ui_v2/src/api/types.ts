export type SidecarMessageKind =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_output"
  | "tool_gate"
  | "reasoning_summary";

export type SidecarMessage = {
  id: string;
  kind: SidecarMessageKind | string;
  ts?: string;
  seq?: number;
  op?: string;

  thread_id?: string;
  file?: string;

  text?: string;
  zh?: string;
  translate_error?: string;
};

export type SidecarThread = {
  key: string;
  thread_id: string;
  file: string;
  count: number;
  last_ts: string;
  last_seq: number;
  kinds?: Record<string, number>;
};

export type ApiMessagesResponse = {
  messages: SidecarMessage[];
};

export type ApiThreadsResponse = {
  threads: SidecarThread[];
};

export type ApiConfigResponse = {
  ok: boolean;
  config?: Record<string, unknown>;
  recovery?: unknown;
  [k: string]: unknown;
};

export type ApiStatusResponse = Record<string, unknown> & { ok?: boolean };

export type ApiTranslatorsResponse = Record<string, unknown> & { translators?: unknown[] };

export type ApiOkResponse = { ok: boolean; [k: string]: unknown };
