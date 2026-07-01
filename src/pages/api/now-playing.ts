import type { NextApiRequest, NextApiResponse } from 'next';
import { getTheme, escapeXML, truncate, formatNumber, FONT, resolveBackground, sendError, sendSvg, Theme } from '@/lib/svg';
import {
  parseUsername,
  getUserInfo,
  getRecentTracks,
  getArtistPlays,
  getTrackPlays,
  fetchAvatar,
  LastfmError,
  RecentTrack,
} from '@/lib/lastfm';

const LASTFM_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';

function albumArt(images?: RecentTrack['image']): string | undefined {
  if (!Array.isArray(images)) return undefined;
  const url = images[3]?.['#text'] || images[2]?.['#text'];
  if (!url || url.includes(LASTFM_PLACEHOLDER)) return undefined;
  return url;
}

function line(artist: string, extra: string | undefined, max: number): string {
  const full = extra ? `${artist || 'Unknown Artist'} • ${extra}` : artist || 'Unknown Artist';
  return truncate(full, max);
}

function equalizer(color: string): string {
  return [154, 161, 168, 175]
    .map(
      (x, i) => `<rect x="${x}" y="29" width="4" height="10" rx="1.5" fill="${color}">
      <animate attributeName="height" values="5;15;5" dur="${0.6 + i * 0.15}s" repeatCount="indefinite"/>
      <animate attributeName="y" values="34;24;34" dur="${0.6 + i * 0.15}s" repeatCount="indefinite"/>
    </rect>`,
    )
    .join('');
}

interface Data {
  current: RecentTrack;
  previous?: RecentTrack;
  art: string | null;
  artistPlays: number;
  trackPlays: number;
  total: string;
}

function render(t: Theme, d: Data): string {
  const { defs, fill } = resolveBackground(t);
  const live = Boolean(d.current['@attr']?.nowplaying);
  const accent = '#e5342b';

  const ax = 344;
  const ay = 43;
  const asz = 134;
  const frame = `<rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="14" fill="none" stroke="${t.section}" stroke-opacity="0.35" stroke-width="1.5"/>`;
  const artwork = d.art
    ? `<rect x="${ax - 3}" y="${ay - 3}" width="${asz + 6}" height="${asz + 6}" rx="16" fill="${t.section}" opacity="0.08"/>
       <clipPath id="art"><rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="14"/></clipPath>
       <image href="${d.art}" x="${ax}" y="${ay}" width="${asz}" height="${asz}" clip-path="url(#art)" preserveAspectRatio="xMidYMid slice"/>
       ${frame}`
    : `<rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="14" fill="${t.section}" opacity="0.1"/>
       <text x="${ax + asz / 2}" y="${ay + asz / 2 + 18}" font-size="50" text-anchor="middle" fill="${t.subtitle}">♪</text>
       ${frame}`;

  const header = live
    ? `<circle cx="34" cy="34" r="4" fill="${accent}"><animate attributeName="opacity" values="1;0.2;1" dur="1.3s" repeatCount="indefinite"/></circle>
       <text x="46" y="38" font-family="${FONT}" font-size="12" font-weight="bold" letter-spacing="2" fill="${accent}">NOW PLAYING</text>
       ${equalizer(accent)}`
    : `<text x="28" y="38" font-family="${FONT}" font-size="12" font-weight="bold" letter-spacing="2" fill="${t.subtitle}">LAST SCROBBLE</text>`;

  const previous = d.previous
    ? `<line x1="28" y1="128" x2="316" y2="128" stroke="${t.subtitle}" stroke-opacity="0.18"/>
       <text x="28" y="150" font-family="${FONT}" font-size="10" font-weight="bold" letter-spacing="2" fill="${t.subtitle}">PREVIOUS</text>
       <text x="28" y="172" font-family="${FONT}" font-size="15" font-weight="bold" fill="${t.section}" opacity="0.9">${escapeXML(truncate(d.previous.name, 24))}</text>
       <text x="28" y="190" font-family="${FONT}" font-size="12" fill="${t.subtitle}">${escapeXML(line(d.previous.artist?.['#text'], d.previous.album?.['#text'], 42))}</text>`
    : '';

  const stats = `${formatNumber(d.artistPlays)} artist plays   ·   ${formatNumber(d.trackPlays)} track plays   ·   ${d.total} scrobbles`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="220" viewBox="0 0 500 220" fill="none" role="img">
  ${defs}
  <rect x="0.5" y="0.5" width="499" height="219" rx="16" fill="${fill}" stroke="${t.subtitle}" stroke-opacity="0.18"/>
  ${artwork}
  ${header}
  <text x="28" y="78" font-family="${FONT}" font-size="23" font-weight="bold" fill="${t.section}">${escapeXML(truncate(d.current.name, 22))}</text>
  <text x="28" y="103" font-family="${FONT}" font-size="14" fill="${t.item}">${escapeXML(line(d.current.artist?.['#text'], d.current.album?.['#text'], 34))}</text>
  ${previous}
  <text x="28" y="209" font-family="${FONT}" font-size="10.5" fill="${t.subtitle}">${escapeXML(stats)}</text>
</svg>`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const theme = getTheme(req.query.theme);
  try {
    const user = parseUsername(req.query.username);
    if (!user) return sendError(res, 'username query param is required', theme);

    const [recent, info] = await Promise.all([getRecentTracks(user, 2), getUserInfo(user)]);
    const current = recent[0];
    if (!current) return sendError(res, 'No recent tracks found', theme);

    const artist = current.artist?.['#text'] || '';
    const [artistPlays, trackPlays, art] = await Promise.all([
      getArtistPlays(user, artist),
      getTrackPlays(user, artist, current.name),
      fetchAvatar(albumArt(current.image)),
    ]);

    sendSvg(
      res,
      render(theme, { current, previous: recent[1], art, artistPlays, trackPlays, total: formatNumber(info.playcount) }),
      30,
    );
  } catch (err) {
    sendError(res, err instanceof LastfmError ? err.message : 'Error fetching data from Last.fm', theme);
  }
}
