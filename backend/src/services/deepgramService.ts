/* eslint-disable @typescript-eslint/no-explicit-any */
import { DeepgramClient, ListenV1InterimResults, ListenV1SmartFormat, ListenV1VadEvents } from '@deepgram/sdk';
import { env } from '../config/env';
import { wsManager } from './wsManager';

export interface AudioStartMeta {
  questionText: string;
  difficulty: 'EASY' | 'MEDIUM' | 'ADVANCED';
  turnNumber: number;
  studentId: string;
  domain?: string;
}

interface DeepgramSession {
  socket: any;
  transcript: string;
  interim: string;    // words of the segment Deepgram has not finalised yet
  triggered: boolean; // prevent double-trigger on UtteranceEnd
  meta: AudioStartMeta;
  pendingChunks: Buffer[]; // audio buffered before socket opens
  isOpen: boolean;
}

const sessions = new Map<string, DeepgramSession>();

// Everything heard so far: the finalised text plus the segment still in progress, so an
// answer is never lost because Deepgram had not finalised its last words yet.
const heardText = (session: DeepgramSession): string =>
  [session.transcript, session.interim].filter(Boolean).join(' ').trim();

type EagerEndCallback = (transcript: string, meta: AudioStartMeta) => Promise<void>;

export async function openSession(
  sessionId: string,
  meta: AudioStartMeta,
  onEagerEnd: EagerEndCallback,
): Promise<void> {
  // Close any stale session first
  const existing = sessions.get(sessionId);
  if (existing) {
    try { existing.socket.sendCloseStream({}); } catch {}
    sessions.delete(sessionId);
  }

  if (!env.DEEPGRAM_API_KEY) {
    console.warn('[Deepgram] DEEPGRAM_API_KEY not set — session skipped');
    return;
  }

  const deepgram = new DeepgramClient({ apiKey: env.DEEPGRAM_API_KEY });

  let socket: any;
  try {
    // Cast to any — ConnectArgs requires Authorization but SDK fills it from apiKey at runtime
    socket = await deepgram.listen.v1.connect({
      model: 'nova-3',
      language: 'en',
      interim_results: ListenV1InterimResults.True,
      utterance_end_ms: 3000,
      endpointing: 2500,
      smart_format: ListenV1SmartFormat.True,
      vad_events: ListenV1VadEvents.True,
      filler_words: 'true', // keep "um"/"uh" in transcripts — they are scored (blueprint §4.4)
      Authorization: env.DEEPGRAM_API_KEY, // required by type, filled by SDK auth
    } as any);
  } catch (err) {
    console.error(`[Deepgram] connect failed  session=${sessionId}:`, err);
    return;
  }

  const session: DeepgramSession = { socket, transcript: '', interim: '', triggered: false, meta, pendingChunks: [], isOpen: false };
  sessions.set(sessionId, session);

  socket.on('open', () => {
    session.isOpen = true;
    console.log(`[Deepgram] session opened  session=${sessionId}`);
    // Flush any audio chunks that arrived before the socket opened
    for (const chunk of session.pendingChunks) {
      try { socket.sendMedia(chunk); } catch {}
    }
    session.pendingChunks = [];
  });

  socket.on('message', async (msg: any) => {
    if (msg?.type === 'Results') {
      const words: string = msg?.channel?.alternatives?.[0]?.transcript ?? '';
      if (!words) {
        if (msg.is_final) session.interim = ''; // the pending segment was finalised as silence
        return;
      }

      if (msg.is_final) {
        session.transcript += (session.transcript ? ' ' : '') + words;
        session.interim = '';
      } else {
        session.interim = words;
      }

      wsManager.emit(sessionId, {
        type: 'transcript_interim',
        text: msg.is_final ? session.transcript : words,
        isFinal: Boolean(msg.is_final),
      });
    } else if (msg?.type === 'UtteranceEnd') {
      if (session.triggered) return;
      session.triggered = true;

      // Brief pause: final Results messages from Deepgram can arrive a few hundred
      // milliseconds after UtteranceEnd, so wait before reading session.transcript.
      await new Promise((resolve) => setTimeout(resolve, 400));

      // May be empty — the caller decides how to handle a silent turn
      const finalTranscript = heardText(session);
      console.log(`[Deepgram] UtteranceEnd  session=${sessionId}  "${finalTranscript.slice(0, 80)}"`);

      try {
        await onEagerEnd(finalTranscript, meta);
      } catch (err) {
        console.error('[Deepgram] onEagerEnd error:', err);
      }
    }
  });

  socket.on('error', (err: unknown) => {
    console.error(`[Deepgram] error  session=${sessionId}:`, err);
  });

  socket.on('close', () => {
    // The previous answer's stream often finishes closing after the next answer's stream
    // has opened; only forget this stream, never the newer one (that dropped the audio).
    if (sessions.get(sessionId) === session) sessions.delete(sessionId);
    console.log(`[Deepgram] session closed  session=${sessionId}`);
  });

  // Must call connect() after registering handlers — SDK returns a start-closed socket
  socket.connect();
}

export function sendAudio(sessionId: string, audio: Buffer): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (!session.isOpen) {
    // Socket not yet open — buffer and flush on open
    session.pendingChunks.push(audio);
    return;
  }
  try {
    session.socket.sendMedia(audio);
  } catch (err) {
    console.error(`[Deepgram] sendAudio error  session=${sessionId}:`, err);
  }
}

// Closes the Deepgram stream and returns the final transcript collected so far.
export function closeSession(sessionId: string): string {
  const session = sessions.get(sessionId);
  if (!session) return '';
  try {
    session.socket.sendCloseStream({});
  } catch {}
  sessions.delete(sessionId);
  return heardText(session);
}
