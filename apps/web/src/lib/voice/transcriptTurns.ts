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

/**
 * TRANSCRIPT_UPDATED delivers the full conversation history each time.
 * Collapse to one item per (role, turn_id) using the latest text from the snapshot.
 */
export function mapSdkTranscriptSnapshot(
  items: Array<{
    uid?: string | number;
    text?: string;
    _time?: number;
    turn_id?: number;
    status?: number;
    stream_id?: number;
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
    const turnId = typeof item.turn_id === 'number' ? item.turn_id : 0;
    const status = typeof item.status === 'number' ? item.status : TurnStatus.IN_PROGRESS;
    const key = `${role}:${turnId}`;
    const timestamp =
      typeof item._time === 'number' && item._time > 0
        ? item._time > 1e12
          ? item._time
          : item._time * 1000
        : Date.now();

    if (!latestByKey.has(key)) {
      order.push(key);
    }

    latestByKey.set(key, {
      role,
      turnId,
      streamId: typeof item.stream_id === 'number' ? item.stream_id : 0,
      text,
      ts: new Date(timestamp).toISOString(),
      status,
      final: status === TurnStatus.END || status === TurnStatus.INTERRUPTED,
    });
  }

  return order.map((key) => latestByKey.get(key)!);
}

export function buildDisplayTranscript(
  snapshot: SdkTranscriptItem[],
  options: {
    agentSpeaking: boolean;
    fillerLine?: VoiceTranscriptLine | null;
  },
): VoiceTranscriptLine[] {
  const lines: VoiceTranscriptLine[] = [];

  for (const item of snapshot) {
    if (item.role === 'assistant' && !item.final && !options.agentSpeaking) {
      continue;
    }
    lines.push({
      role: item.role,
      text: item.text,
      ts: item.ts,
      final: item.final,
      turnId: item.turnId,
    });
  }

  if (options.fillerLine) {
    const alreadyPresent = lines.some(
      (line) => line.filler && line.text === options.fillerLine?.text,
    );
    if (!alreadyPresent) {
      lines.push(options.fillerLine);
    }
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

export function isUserGoodbyeIntent(
  text: string,
  options: { orderCompleted?: boolean } = {},
): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (
    /\b(bye|goodbye|good\s+bye)\b/.test(normalized) ||
    /\b(that'?s all|that is all|thanks,? that'?s all|thank you,? that'?s all)\b/.test(
      normalized,
    ) ||
    /\b(end (the )?conversation|stop talking)\b/.test(normalized) ||
    /\b(no thanks|no thank you|nothing else|i'?m done|im done)\b/.test(normalized) ||
    /^(stop|thanks\.?\s*)$/.test(normalized)
  ) {
    return true;
  }
  if (options.orderCompleted && /^no\.?\s*$/.test(normalized)) {
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
