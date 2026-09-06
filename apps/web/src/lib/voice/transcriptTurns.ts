import type { VoiceTranscriptLine } from './types';

/** Mirrors Agora TurnStatus: 0=in progress, 1=end, 2=interrupted */
export const TurnStatus = {
  IN_PROGRESS: 0,
  END: 1,
  INTERRUPTED: 2,
} as const;

export type SdkTranscriptItem = {
  role: 'user' | 'assistant';
  turnId: number;
  streamId: number;
  lineKey: string;
  text: string;
  ts: string;
  status: number;
  final: boolean;
};

function normalizeSpeakerUid(uid: string | number | undefined, shopperRtcUid: number): string {
  if (uid === undefined || uid === null || uid === '' || String(uid) === '0') {
    return String(shopperRtcUid);
  }
  return String(uid);
}

function asNumericId(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * TRANSCRIPT_UPDATED delivers the full conversation history each time.
 * Collapse to one item per (role, turn_id, stream_id) using the latest text.
 */
export function mapSdkTranscriptSnapshot(
  items: Array<{
    uid?: string | number;
    text?: string;
    _time?: number;
    turn_id?: number | string;
    status?: number;
    stream_id?: number | string;
  }>,
  shopperRtcUid: number,
): SdkTranscriptItem[] {
  const shopperUid = String(shopperRtcUid);
  const latestByKey = new Map<string, SdkTranscriptItem>();
  const order: string[] = [];

  for (const item of items) {
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) continue;

    const speakerUid = normalizeSpeakerUid(item.uid, shopperRtcUid);
    const role = speakerUid === shopperUid ? ('user' as const) : ('assistant' as const);
    const turnId = asNumericId(item.turn_id);
    const streamId = asNumericId(item.stream_id);
    const status = typeof item.status === 'number' ? item.status : TurnStatus.IN_PROGRESS;
    const key = `${role}:${turnId}:${streamId}`;
    const timestamp =
      typeof item._time === 'number' && item._time > 0
        ? item._time > 1e12
          ? item._time
          : item._time * 1000
        : 0;

    if (!latestByKey.has(key)) {
      order.push(key);
    }

    latestByKey.set(key, {
      role,
      turnId,
      streamId,
      lineKey: key,
      text,
      ts: timestamp > 0 ? new Date(timestamp).toISOString() : '',
      status,
      final: status === TurnStatus.END || status === TurnStatus.INTERRUPTED,
    });
  }

  return order.map((key, ordinal) => {
    const entry = latestByKey.get(key)!;
    return {
      ...entry,
      lineKey: `${key}#${ordinal}`,
    };
  });
}

export function buildDisplayTranscript(
  snapshot: SdkTranscriptItem[],
  options: {
    agentSpeaking: boolean;
    agentThinking?: boolean;
  },
): VoiceTranscriptLine[] {
  const lines: VoiceTranscriptLine[] = [];
  const showInterimAssistant = options.agentSpeaking || Boolean(options.agentThinking);

  for (const item of snapshot) {
    if (item.role === 'assistant' && !item.final && !showInterimAssistant) {
      continue;
    }
    lines.push({
      role: item.role,
      text: item.text,
      ts: item.ts,
      final: item.final,
      turnId: item.turnId,
      streamId: item.streamId,
      lineKey: item.lineKey,
    });
  }

  return lines.slice(-40);
}

export function latestUserTurnId(snapshot: SdkTranscriptItem[]): number | null {
  for (let index = snapshot.length - 1; index >= 0; index -= 1) {
    if (snapshot[index].role === 'user') {
      return snapshot[index].turnId;
    }
  }
  return null;
}

export function isUserPresenceCheck(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(are you there|you there|hello|hello\??|hi\??)\b/.test(normalized);
}

export function isUserGoodbyeContinuation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /^thanks?(\s+you)?(\s+very\s+much)?\.?$/.test(normalized) ||
    /^thank you(\s+very\s+much)?\.?$/.test(normalized)
  );
}

export function shouldCancelFarewellPending(text: string): boolean {
  if (isUserPresenceCheck(text)) return false;
  if (isUserGoodbyeIntent(text)) return false;
  if (isUserGoodbyeContinuation(text)) return false;
  return true;
}

export function findFinalAssistantTurnAfterUserTurn(
  snapshot: SdkTranscriptItem[],
  userTurn: SdkTranscriptItem,
): SdkTranscriptItem | undefined {
  const anchorIndex = snapshot.findIndex(
    (item) => item.role === 'user' && item.turnId === userTurn.turnId,
  );
  if (anchorIndex < 0) return undefined;
  return snapshot
    .slice(anchorIndex + 1)
    .find((item) => item.role === 'assistant' && item.final);
}

export function isUserExplicitSessionEndIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /\b(end|stop) (the )?(call|conversation)\b/.test(normalized);
}

export function isUserGoodbyeIntent(
  text: string,
  options: { orderCompleted?: boolean } = {},
): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (
    /\b(bye|goodbye|good\s+bye)\b/.test(normalized) ||
    /\b(that'?s all|that is all|that'?s it|that is it)\b/.test(normalized) ||
    /\b(end (the )?(conversation|session)|stop talking)\b/.test(normalized) ||
    /\b(no thanks|no thank you|nothing else|i'?m done|im done)\b/.test(normalized) ||
    /\bno\b[\s,.!]*\b(thanks?|thank you)\b/.test(normalized) ||
    /^(stop|thanks\.?\s*|thank you\.?\s*)$/.test(normalized) ||
    isUserGoodbyeContinuation(text)
  ) {
    return true;
  }
  if (options.orderCompleted && /^no[\s,.!]*\.?\s*$/.test(normalized)) {
    return true;
  }
  return false;
}

/** @deprecated Use mapSdkTranscriptSnapshot — kept for legacy tests importing applyTranscriptUpdates */
export function applyTranscriptUpdates(
  current: VoiceTranscriptLine[],
  incoming: VoiceTranscriptLine[],
): VoiceTranscriptLine[] {
  void current;
  return incoming;
}
