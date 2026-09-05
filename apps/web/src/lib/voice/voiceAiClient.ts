import type { IAgoraRTCClient, IRemoteAudioTrack } from 'agora-rtc-sdk-ng';
import {
  mapSdkTranscriptSnapshot,
  type SdkTranscriptItem,
} from './transcriptTurns';
import {
  createVoiceRtmClient as acquireVoiceRtmClient,
} from './rtmSession';

type RtmEngine = {
  login: (options: { token: string }) => Promise<unknown>;
  logout: () => Promise<unknown>;
  subscribe?: (channel: string) => Promise<unknown>;
};

export { releaseVoiceRtmClient } from './rtmSession';

export async function createVoiceRtmClient(
  appId: string,
  rtcUid: number,
  rtmToken: string,
  channel: string,
): Promise<RtmEngine> {
  return acquireVoiceRtmClient(appId, rtcUid, rtmToken, channel);
}

export type VoiceAiRuntime = {
  destroy: () => Promise<void>;
};

export async function initVoiceAiToolkit(options: {
  rtcClient: IAgoraRTCClient;
  rtmClient: RtmEngine;
  channel: string;
  shopperRtcUid: number;
  onTranscriptSnapshot: (snapshot: SdkTranscriptItem[]) => void;
  onSpeaking: (active: boolean) => void;
  onThinking: (active: boolean) => void;
  onAgentError?: (error: unknown) => void;
}): Promise<VoiceAiRuntime> {
  const {
    AgoraVoiceAI,
    AgoraVoiceAIEvents,
    TranscriptHelperMode,
  } = await import('agora-agent-client-toolkit');

  try {
    const existing = AgoraVoiceAI.getInstance();
    existing.unsubscribe?.();
    existing.destroy?.();
  } catch {
    // No live singleton yet.
  }

  const ai = await AgoraVoiceAI.init({
    rtcEngine: options.rtcClient,
    rtmEngine: options.rtmClient,
    rtmConfig: { rtmEngine: options.rtmClient },
    renderMode: TranscriptHelperMode.TEXT,
    enableLog: process.env.NODE_ENV === 'development',
  });

  ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (items) => {
    const snapshot = mapSdkTranscriptSnapshot(items, options.shopperRtcUid);
    options.onTranscriptSnapshot(snapshot);
  });

  ai.on(AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED, (_agentUserId, active) => {
    options.onSpeaking(active);
  });

  ai.on(AgoraVoiceAIEvents.AGENT_THINKING_CHANGED, (_agentUserId, active) => {
    options.onThinking(active);
  });

  ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (_agentUserId, error) => {
    console.warn('[VoiceAI] Agent error:', error);
    options.onAgentError?.(error);
  });

  ai.subscribeMessage(options.channel);

  return {
    destroy: async () => {
      try {
        ai.unsubscribe();
        ai.destroy();
      } catch {
        // Toolkit may already be destroyed.
      }
    },
  };
}

export async function playRemoteAudioTrack(
  track: IRemoteAudioTrack | undefined,
  container?: HTMLElement | null,
) {
  if (!track) return;
  track.setVolume(100);
  try {
    if (container) {
      await track.play(container);
      return;
    }
    await track.play();
  } catch (error) {
    console.warn('[VoiceAI] Remote audio play failed:', error);
  }
}
