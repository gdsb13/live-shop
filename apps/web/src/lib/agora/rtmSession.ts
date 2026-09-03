type RtmClient = {
  logout: () => Promise<unknown>;
};

const activeByUserId = new Map<string, RtmClient>();

export function registerRtmUser(userId: string, client: RtmClient) {
  activeByUserId.set(userId, client);
}

export function unregisterRtmUser(userId: string, client: RtmClient) {
  if (activeByUserId.get(userId) === client) {
    activeByUserId.delete(userId);
  }
}

export async function disconnectRtmUser(userId: string) {
  const existing = activeByUserId.get(userId);
  if (!existing) return;

  activeByUserId.delete(userId);
  try {
    await existing.logout();
  } catch {
    // Stale sessions may already be gone on the Agora side.
  }
}

export async function loginRtmUser(
  userId: string,
  client: RtmClient,
  login: () => Promise<unknown>,
) {
  await disconnectRtmUser(userId);
  await login();
  registerRtmUser(userId, client);
}
