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

type VoiceToolkitRtmEngine = RtmEngine & {
  publish: (channel: string, message: string, options?: Record<string, unknown>) => Promise<void>;
  addEventListener: (event: string, listener: (...args: unknown[]) => void) => void;
  removeEventListener: (event: string, listener: (...args: unknown[]) => void) => void;
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

  const rtmEngine = options.rtmClient as VoiceToolkitRtmEngine;

  const initConfig = {
    rtcEngine: options.rtcClient,
    rtmEngine,
    rtmConfig: { rtmEngine },
    renderMode: TranscriptHelperMode.TEXT,
    enableLog: process.env.NODE_ENV === 'development',
  };

  const ai = await AgoraVoiceAI.init(
    initConfig as Parameters<typeof AgoraVoiceAI.init>[0],
  );

  ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (items) => {
    const snapshot = mapSdkTranscriptSnapshot(items, options.shopperRtcUid);
    options.onTranscriptSnapshot(snapshot);
  });

  ai.on(AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED, (_agentUserId, active) => {
    console.info(`[VoiceAI Client] ${new Date().toISOString()} event=agent_speaking active=${active}`);
    options.onSpeaking(active);
  });

  ai.on(AgoraVoiceAIEvents.AGENT_THINKING_CHANGED, (_agentUserId, active) => {
    console.info(`[VoiceAI Client] ${new Date().toISOString()} event=agent_thinking active=${active}`);
    options.onThinking(active);
  });

  ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (_agentUserId, error) => {
    console.warn(`[VoiceAI Client] ${new Date().toISOString()} event=agent_error`, error);
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
  const audioTrack = track as IRemoteAudioTrack & {
    play(element?: HTMLElement | string): Promise<void>;
  };
  try {
    if (container) {
      await audioTrack.play(container);
      return;
    }
    await audioTrack.play();
  } catch (error) {
    console.warn('[VoiceAI] Remote audio play failed:', error);
  }
}
