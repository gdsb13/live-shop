export type VoiceAssistantSurface = 'storefront' | 'live' | 'product';

export type VoiceAssistantState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export type VoiceTranscriptLine = {
  role: 'user' | 'assistant';
  text: string;
  ts: string;
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
