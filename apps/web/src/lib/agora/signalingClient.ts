export async function createSignalingClient(appId: string, userId: string) {
  const mod = await import('agora-rtm-sdk');
  const AgoraRTM = mod.default;
  const RTMClient = AgoraRTM?.RTM ?? mod.RTM;
  if (!RTMClient) {
    throw new Error('Agora Signaling SDK is unavailable');
  }

  return new RTMClient(appId, userId, { useStringUserId: true });
}
