import type { NextApiRequest, NextApiResponse } from 'next';
import { parseUsername, getRecentTracks, LastfmError } from '@/lib/lastfm';

// JSON sibling to now-playing.ts's SVG output, for consumers that want to
// render their own UI (e.g. a native React "last played" card) instead of
// embedding an image.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = parseUsername(req.query.username);
    if (!user) return res.status(400).json({ ok: false, error: 'username query param is required' });

    const [track] = await getRecentTracks(user, 1);
    if (!track) return res.status(200).json({ ok: false });

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
      ok: true,
      song: track.name,
      artist: track.artist?.['#text'] || 'Unknown Artist',
      album: track.album?.['#text'] || '',
      coverArt: track.image?.[track.image.length - 1]?.['#text'] || null,
      nowPlaying: Boolean(track['@attr']?.nowplaying),
      url: `https://www.last.fm/music/${encodeURIComponent(track.artist?.['#text'] || '')}/_/${encodeURIComponent(track.name)}`,
      date: track.date?.['#text'] || (track['@attr']?.nowplaying ? 'Now playing' : ''),
    });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err instanceof LastfmError ? err.message : 'Error fetching data from Last.fm' });
  }
}
