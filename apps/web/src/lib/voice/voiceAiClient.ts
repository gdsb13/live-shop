import type { IAgoraRTCClient, IRemoteAudioTrack } from 'agora-rtc-sdk-ng';
import type { VoiceTranscriptLine } from './types';
import {
  createVoiceRtmClient as acquireVoiceRtmClient,
  releaseVoiceRtmClient,
} from './rtmSession';

type RtmEngine = {
  login: (options: { token: string }) => Promise<unknown>;
  logout: () => Promise<unknown>;
  subscribe?: (channel: string) => Promise<unknown>;
};

export { releaseVoiceRtmClient };

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

function normalizeSpeakerUid(
  uid: string | number | undefined,
  shopperRtcUid: number,
): string {
  if (uid === undefined || uid === null || uid === '' || String(uid) === '0') {
    return String(shopperRtcUid);
  }
  return String(uid);
}

function mapToolkitTranscripts(
  items: Array<{ uid?: string | number; text?: string; _time?: number }>,
  shopperRtcUid: number,
): VoiceTranscriptLine[] {
  const shopperUid = String(shopperRtcUid);
  return items
    .map((item) => {
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!text) return null;
      const speakerUid = normalizeSpeakerUid(item.uid, shopperRtcUid);
      const timestamp =
        typeof item._time === 'number' && item._time > 0
          ? item._time > 1e12
            ? item._time
            : item._time * 1000
          : Date.now();
      return {
        role: speakerUid === shopperUid ? ('user' as const) : ('assistant' as const),
        text,
        ts: new Date(timestamp).toISOString(),
      };
    })
    .filter((line): line is VoiceTranscriptLine => line !== null);
}

export async function initVoiceAiToolkit(options: {
  rtcClient: IAgoraRTCClient;
  rtmClient: RtmEngine;
  channel: string;
  shopperRtcUid: number;
  onTranscripts: (lines: VoiceTranscriptLine[]) => void;
  onSpeaking: (active: boolean) => void;
  onThinking: (active: boolean) => void;
}): Promise<VoiceAiRuntime> {
  const {
    AgoraVoiceAI,
    AgoraVoiceAIEvents,
    TranscriptHelperMode,
  } = await import('agora-agent-client-toolkit');

  const ai = await AgoraVoiceAI.init({
    rtcEngine: options.rtcClient,
    rtmEngine: options.rtmClient,
    rtmConfig: { rtmEngine: options.rtmClient },
    renderMode: TranscriptHelperMode.TEXT,
    enableLog: process.env.NODE_ENV === 'development',
  });

  ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (items) => {
    const lines = mapToolkitTranscripts(items, options.shopperRtcUid);
    if (lines.length > 0) {
      options.onTranscripts(lines);
    }
  });

  ai.on(AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED, (_agentUserId, active) => {
    options.onSpeaking(active);
  });

  ai.on(AgoraVoiceAIEvents.AGENT_THINKING_CHANGED, (_agentUserId, active) => {
    options.onThinking(active);
  });

  ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (_agentUserId, error) => {
    console.warn('[VoiceAI] Agent error:', error);
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
      await releaseVoiceRtmClient();
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
