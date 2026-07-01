import type { NextApiRequest, NextApiResponse } from 'next';
import { getTheme, escapeXML, truncate, FONT, resolveBackground, sendError, sendSvg, Theme } from '@/lib/svg';
import { parseUsername, getRecentTracks, fetchAvatar, LastfmError, RecentTrack } from '@/lib/lastfm';

const LASTFM_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';

function albumArt(images?: RecentTrack['image']): string | undefined {
  if (!Array.isArray(images)) return undefined;
  const url = images[3]?.['#text'] || images[2]?.['#text'];
  if (!url || url.includes(LASTFM_PLACEHOLDER)) return undefined;
  return url;
}

function equalizer(color: string): string {
  const bars = [
    { x: 430, dur: '0.7s' },
    { x: 438, dur: '0.9s' },
    { x: 446, dur: '0.6s' },
    { x: 454, dur: '0.8s' },
  ];
  return bars
    .map(
      (b) => `<rect x="${b.x}" width="5" rx="1.5" fill="${color}">
      <animate attributeName="height" values="8;26;8" dur="${b.dur}" repeatCount="indefinite"/>
      <animate attributeName="y" values="88;70;88" dur="${b.dur}" repeatCount="indefinite"/>
    </rect>`,
    )
    .join('');
}

function render(t: Theme, art: string | null, track: RecentTrack): string {
  const { defs, fill } = resolveBackground(t);
  const live = Boolean(track['@attr']?.nowplaying);
  const accent = '#e5342b';

  const artwork = art
    ? `<clipPath id="art"><rect x="20" y="20" width="100" height="100" rx="10"/></clipPath>
       <image href="${art}" x="20" y="20" width="100" height="100" clip-path="url(#art)" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="20" y="20" width="100" height="100" rx="10" fill="${t.section}" opacity="0.15"/>
       <text x="70" y="86" font-size="42" text-anchor="middle" fill="${t.subtitle}">♪</text>`;

  const status = live
    ? `<circle cx="150" cy="38" r="4" fill="${accent}">
         <animate attributeName="opacity" values="1;0.2;1" dur="1.3s" repeatCount="indefinite"/>
       </circle>
       <text x="162" y="42" font-family="${FONT}" font-size="12" font-weight="bold" letter-spacing="1.5" fill="${accent}">NOW PLAYING</text>
       ${equalizer(accent)}`
    : `<text x="140" y="42" font-family="${FONT}" font-size="12" font-weight="bold" letter-spacing="1.5" fill="${t.subtitle}">LAST PLAYED</text>`;

  const album = track.album?.['#text'] || '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140" viewBox="0 0 480 140" fill="none" role="img">
  ${defs}
  <rect width="480" height="140" rx="14" fill="${fill}"/>
  ${artwork}
  ${status}
  <text x="140" y="72" font-family="${FONT}" font-size="19" font-weight="bold" fill="${t.title}">${escapeXML(truncate(track.name, 28))}</text>
  <text x="140" y="96" font-family="${FONT}" font-size="14" fill="${t.item}">${escapeXML(truncate(track.artist?.['#text'] || 'Unknown Artist', 34))}</text>
  ${album ? `<text x="140" y="118" font-family="${FONT}" font-size="12" font-style="italic" fill="${t.subtitle}">${escapeXML(truncate(album, 40))}</text>` : ''}
  <text x="460" y="130" font-family="${FONT}" font-size="10" text-anchor="end" fill="${t.subtitle}" opacity="0.6">last.fm</text>
</svg>`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const theme = getTheme(req.query.theme);
  try {
    const user = parseUsername(req.query.username);
    if (!user) return sendError(res, 'username query param is required', theme);

    const [track] = await getRecentTracks(user, 1);
    if (!track) return sendError(res, 'No recent tracks found', theme);

    const art = await fetchAvatar(albumArt(track.image));
    sendSvg(res, render(theme, art, track), 30);
  } catch (err) {
    sendError(res, err instanceof LastfmError ? err.message : 'Error fetching data from Last.fm', theme);
  }
}
