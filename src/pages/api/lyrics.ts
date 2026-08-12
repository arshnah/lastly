import type { NextApiRequest, NextApiResponse } from 'next';
import { getTheme, escapeXML, truncate, FONT, resolveBackground, sendError, sendSvg, Theme } from '@/lib/svg';
import { parseUsernames, getRecentTracks, RecentTrack, LastfmError } from '@/lib/lastfm';
import { fetchLyrics, parseSynced, currentWindow } from '@/lib/lyrics';

function render(t: Theme, track: string, artist: string, lines: string[], live: boolean): string {
  const { defs, fill } = resolveBackground(t);
  const F = t.font || FONT;
  const W = t.width || 500;
  const PAD = 28;
  const lineH = 24;
  const bodyTop = 96;
  const H = bodyTop + Math.max(lines.length, 1) * lineH + 12;

  const body = lines.length
    ? lines
        .map((l, i) => {
          const isCurrent = l.startsWith('▸ ');
          const text = isCurrent ? l.slice(2) : l;
          return `<text x="${PAD}" y="${bodyTop + i * lineH}" font-family="${F}" font-size="14" fill="${
            isCurrent ? t.section : t.subtitle
          }" font-weight="${isCurrent ? 'bold' : 'normal'}">${escapeXML(truncate(text, 60))}</text>`;
        })
        .join('\n')
    : `<text x="${PAD}" y="${bodyTop}" font-family="${F}" font-size="13" fill="${t.subtitle}">No lyrics found</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img">
  ${defs}
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${fill}" stroke="${t.subtitle}" stroke-opacity="0.18"/>
  <text x="${PAD}" y="38" font-family="${F}" font-size="12" font-weight="bold" letter-spacing="2" fill="${
    live ? t.accent || t.section : t.subtitle
  }">${live ? 'LYRICS · NOW PLAYING' : 'LYRICS'}</text>
  <text x="${PAD}" y="62" font-family="${F}" font-size="16" font-weight="bold" fill="${t.section}">${escapeXML(truncate(track, 48))}</text>
  <text x="${PAD}" y="80" font-family="${F}" font-size="12" fill="${t.item}">${escapeXML(truncate(artist, 60))}</text>
  ${body}
</svg>`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const theme = getTheme(req.query.theme, req.query.bg);
  try {
    const users = parseUsernames(req.query.username);
    if (!users.length) return sendError(res, 'username query param is required', theme);

    const recents = await Promise.all(users.map((u) => getRecentTracks(u, 1).catch(() => [] as RecentTrack[])));
    const current = recents.flat().find((t) => t && t.name);
    if (!current) return sendError(res, 'No recent tracks found', theme);

    const artist = current.artist?.['#text'] || '';
    const live = Boolean(current['@attr']?.nowplaying);

    const lyrics = await fetchLyrics(artist, current.name, current.album?.['#text']);

    let lines: string[] = [];
    if (lyrics?.synced) {
      // Last.fm doesn't expose playback position for the currently-playing
      // track, so this shows the opening synced lines rather than a truly
      // live-synced window.
      lines = currentWindow(parseSynced(lyrics.synced), null, 6);
    } else if (lyrics?.plain) {
      lines = lyrics.plain.split('\n').filter(Boolean).slice(0, 6);
    }

    sendSvg(res, render(theme, current.name, artist, lines, live), 60);
  } catch (err) {
    sendError(res, err instanceof LastfmError ? err.message : 'Error fetching lyrics', theme);
  }
}
