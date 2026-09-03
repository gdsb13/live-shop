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
  mode: 'agora' | 'local';
  channel: string;
  shopperUserId: string;
  surface: VoiceAssistantSurface;
  greeting: string;
  publicBaseConfigured: boolean;
  appId?: string;
  agentUid?: string;
  rtcToken?: string;
  rtmToken?: string;
};
