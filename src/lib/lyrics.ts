import axios from 'axios';

const LRCLIB = 'https://lrclib.net/api';
const TIMEOUT = 6000;

export interface LyricsResult {
  plain?: string;
  synced?: string;
}

export async function fetchLyrics(
  artist: string,
  track: string,
  album?: string,
  duration?: number,
): Promise<LyricsResult | null> {
  const params: Record<string, string> = { artist_name: artist, track_name: track };
  if (album) params.album_name = album;
  if (duration) params.duration = String(Math.round(duration));

  try {
    const { data } = await axios.get(`${LRCLIB}/get`, { params, timeout: TIMEOUT });
    if (data?.plainLyrics || data?.syncedLyrics) {
      return { plain: data.plainLyrics || undefined, synced: data.syncedLyrics || undefined };
    }
  } catch {
    // exact lookup 404s often (missing duration, slightly different title) - fall back to search
  }

  try {
    const { data } = await axios.get(`${LRCLIB}/search`, {
      params: { artist_name: artist, track_name: track },
      timeout: TIMEOUT,
    });
    const hit = Array.isArray(data) ? data[0] : null;
    if (hit && (hit.plainLyrics || hit.syncedLyrics)) {
      return { plain: hit.plainLyrics || undefined, synced: hit.syncedLyrics || undefined };
    }
  } catch {
    // no lyrics available for this track
  }

  return null;
}

// LRC format: [mm:ss.xx]line text
export function parseSynced(lrc: string): Array<{ time: number; text: string }> {
  const lines: Array<{ time: number; text: string }> = [];
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (!m) continue;
    const text = m[3].trim();
    if (text) lines.push({ time: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return lines;
}

// Windows the lyric lines around a playback position. Last.fm's now-playing
// entries don't expose an elapsed time, so `elapsedSeconds` is usually null -
// in that case this just returns the opening lines instead of a synced window.
export function currentWindow(
  lines: Array<{ time: number; text: string }>,
  elapsedSeconds: number | null,
  count = 6,
): string[] {
  if (!lines.length) return [];
  if (elapsedSeconds == null) return lines.slice(0, count).map((l) => l.text);

  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= elapsedSeconds) idx = i;
    else break;
  }

  const start = Math.max(0, idx - 1);
  return lines
    .slice(start, start + count)
    .map((l, i) => (start + i === idx ? `▸ ${l.text}` : l.text));
}
