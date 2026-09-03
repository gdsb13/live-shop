export type AgoraRtcRole = 'host' | 'audience';

export type AgoraRtcToken = {
  appId: string;
  token: string;
  channelName: string;
  userId: string;
  role: AgoraRtcRole;
  liveSessionId: string;
  expiresAt: string;
};

export type AgoraRtmToken = {
  appId: string;
  token: string;
  userId: string;
  chatChannelName: string;
  liveSessionId: string;
  signalingArea?: string;
  signalingAreas?: string[];
  signalingFallbackAreas?: string[];
  appIdPrefix?: string;
  appIdSuffix?: string;
  expiresAt: string;
};

export type LiveChatMessage = {
  id: string;
  sender: string;
  text: string;
  ts: string;
};
