export type VoiceAssistantSurface = 'storefront' | 'live' | 'recorded' | 'product';

export type VoiceAssistantState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'ended'
  | 'error';

export type VoiceTranscriptLine = {
  role: 'user' | 'assistant';
  text: string;
  ts: string;
  /** Agora turn_id when sourced from SDK snapshot. */
  turnId?: number;
  /** Completed turns are never overwritten by partial updates. */
  final?: boolean;
  /** Short latency filler while a tool call is in progress. */
  filler?: boolean;
};

export type VoiceSessionStart = {
  sessionId: string;
  channel: string;
  shopperUserId: string;
  shopperRtcUid: number;
  surface: VoiceAssistantSurface;
  greeting: string;
  appId: string;
  rtcToken: string;
  rtmToken: string;
};
