type RtcClient = {
  leave: () => Promise<unknown>;
};

const activeByKey = new Map<string, RtcClient>();

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sessionKey(channelName: string, userId: string) {
  return `${channelName}:${userId}`;
}

export async function releaseRtcChannel(
  channelName: string,
  userId: string,
  client?: RtcClient | null,
) {
  const key = sessionKey(channelName, userId);
  const tracked = activeByKey.get(key);
  const toLeave = tracked ?? client ?? null;

  activeByKey.delete(key);
  if (!toLeave) return;

  try {
    await toLeave.leave();
  } catch {
    // Stale sessions may already be gone on the Agora side.
  }
  await sleep(300);
}

export function registerRtcChannel(
  channelName: string,
  userId: string,
  client: RtcClient,
) {
  activeByKey.set(sessionKey(channelName, userId), client);
}

export function unregisterRtcChannel(
  channelName: string,
  userId: string,
  client: RtcClient,
) {
  const key = sessionKey(channelName, userId);
  if (activeByKey.get(key) === client) {
    activeByKey.delete(key);
  }
}

function isUidConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UID_CONFLICT') || message.includes('uid conflict');
}

export async function joinRtcChannel(
  channelName: string,
  userId: string,
  client: RtcClient,
  join: () => Promise<unknown>,
) {
  await releaseRtcChannel(channelName, userId);

  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      try {
        await client.leave();
      } catch {
        // ignore stale leave errors between retries
      }
      await sleep(300 * attempt);
    }

    try {
      await join();
      registerRtcChannel(channelName, userId, client);
      return;
    } catch (error) {
      lastError = error;
      if (!isUidConflict(error) || attempt === maxAttempts - 1) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error('Could not join Agora RTC channel');
}
