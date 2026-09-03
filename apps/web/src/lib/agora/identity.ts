/**
 * Unique per browser tab document. Stored on window so it survives HMR but not
 * tab duplication of sessionStorage keys. Each tab gets its own id at first access.
 */
export function getPageClientId() {
  if (typeof window === 'undefined') return 'server';
  const win = window as { __liveShopPageClientId?: string };
  if (!win.__liveShopPageClientId) {
    win.__liveShopPageClientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return win.__liveShopPageClientId;
}

/** RTC host publisher id — stable for this tab for the whole page session. */
export function hostUserId(sessionId: string) {
  return `host-${sessionId}-${getPageClientId()}`;
}

/** RTC audience id — stable for this tab for the whole page session. */
export function viewerRtcUserId(sessionId: string) {
  return `viewer-rtc-${sessionId}-${getPageClientId()}`;
}

/** @deprecated Use viewerRtcUserId instead. */
export function getOrCreateViewerUserId() {
  return viewerRtcUserId('legacy');
}

function chatNameKey(sessionId: string, isHost: boolean) {
  return `${isHost ? 'host' : 'guest'}-name-${sessionId}-${getPageClientId()}`;
}

/** Per-tab chat display name for this live session. */
export function getSessionChatName(sessionId: string, isHost = false): string | null {
  if (typeof window === 'undefined') return isHost ? 'Host' : null;
  return window.sessionStorage.getItem(chatNameKey(sessionId, isHost));
}

export function setSessionChatName(sessionId: string, name: string, isHost = false) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(chatNameKey(sessionId, isHost), name.trim());
}
