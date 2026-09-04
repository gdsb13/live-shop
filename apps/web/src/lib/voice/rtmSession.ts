type RtmEngine = {
  login: (options: { token: string }) => Promise<unknown>;
  logout: () => Promise<unknown>;
  subscribe?: (channel: string) => Promise<unknown>;
  unsubscribe?: (channel: string) => Promise<unknown>;
};

let activeClient: RtmEngine | null = null;
let activeChannel = '';
let releasePromise: Promise<void> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function releaseVoiceRtmClient(): Promise<void> {
  if (releasePromise) {
    await releasePromise;
    return;
  }

  const client = activeClient;
  const channel = activeChannel;
  activeClient = null;
  activeChannel = '';

  if (!client) return;

  releasePromise = (async () => {
    if (channel && typeof client.unsubscribe === 'function') {
      try {
        await client.unsubscribe(channel);
      } catch {
        // Channel may already be unsubscribed.
      }
    }
    try {
      await client.logout();
    } catch {
      // RTM session may already be gone.
    }
    await sleep(400);
  })();

  try {
    await releasePromise;
  } finally {
    releasePromise = null;
  }
}

export async function createVoiceRtmClient(
  appId: string,
  rtcUid: number,
  rtmToken: string,
  channel: string,
): Promise<RtmEngine> {
  await releaseVoiceRtmClient();

  const mod = await import('agora-rtm');
  const AgoraRTM = mod.default ?? mod;
  const RTM = AgoraRTM.RTM ?? AgoraRTM;
  const client = new RTM(appId, String(rtcUid));
  await client.login({ token: rtmToken });

  if (typeof client.subscribe === 'function') {
    try {
      await client.subscribe(channel);
    } catch (error) {
      console.warn('[VoiceAI] RTM channel subscribe failed:', error);
    }
  }

  activeClient = client;
  activeChannel = channel;
  return client;
}
