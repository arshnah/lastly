const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');

const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
const SPOTIFY_AUTH_API = "https://accounts.spotify.com/api/token";

const INDIAN_TAGS = [
    "bollywood", "hindi", "indian", "desi", "punjabi", "sufi", "ghazal", "filmi",
    "qawwali", "india", "indian pop", "bhangra", "haryanvi", "urdu", "pakistani",
    "coke studio", "indian classical", "tamil", "telugu", "kollywood", "tollywood",
];

// Load .env next to the script
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...vParts] = trimmed.split('=');
            env[k.trim()] = vParts.join('=').trim();
        }
    }
    return env;
}

const env = loadEnv();
const LASTFM_API_KEY = env.LASTFM_API_KEY;
const LASTFM_USERNAME = env.LASTFM_USERNAME || "arshnahbtw";
const SPOTIFY_CLIENT_ID = env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:9999/callback";

if (!LASTFM_API_KEY || !SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.error("Error: Missing credentials in .env file.");
    process.exit(1);
}

// Artist tags cache
const artistTagsCache = new Map();

async function getArtistTags(artist) {
    const k = artist.toLowerCase();
    if (artistTagsCache.has(k)) return artistTagsCache.get(k);
    
    const params = new URLSearchParams({
        method: "artist.gettoptags",
        artist,
        api_key: LASTFM_API_KEY,
        format: "json"
    });
    
    try {
        const res = await fetch(LASTFM_API + "?" + params.toString());
        const data = await res.json();
        let tags = [];
        if (data.toptags && data.toptags.tag) {
            const list = data.toptags.tag;
            if (Array.isArray(list)) {
                tags = list.map(t => (t && t.name || "").toLowerCase()).filter(Boolean);
            } else if (list && typeof list === 'object') {
                tags = [(list.name || "").toLowerCase()].filter(Boolean);
            }
        }
        artistTagsCache.set(k, tags);
        return tags;
    } catch {
        return [];
    }
}

async function isEnglishArtist(artist) {
    const tags = await getArtistTags(artist);
    if (!tags.length) return true; // keep if unknown
    const hasIndian = tags.some(t => INDIAN_TAGS.some(ind => t.includes(ind)));
    return !hasIndian;
}

async function getSimilarArtists(artist, limit = 5) {
    const params = new URLSearchParams({
        method: "artist.getsimilar",
        artist,
        api_key: LASTFM_API_KEY,
        format: "json",
        limit
    });
    try {
        const res = await fetch(LASTFM_API + "?" + params.toString());
        const data = await res.json();
        if (data.similarartists && data.similarartists.artist) {
            const list = data.similarartists.artist;
            const arr = Array.isArray(list) ? list : [list];
            return arr.map(a => a && a.name).filter(Boolean);
        }
    } catch {}
    return [];
}

let authCode = null;
let serverInstance = null;

function startCallbackServer() {
    return new Promise((resolve, reject) => {
        serverInstance = http.createServer((req, res) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            if (url.pathname === '/callback') {
                authCode = url.searchParams.get('code');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Authentication successful!</h1><p>You can close this tab and return to the script.</p>');
                
                setTimeout(() => {
                    serverInstance.close(() => {
                        resolve();
                    });
                }, 1000);
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        
        serverInstance.on('error', (err) => {
            reject(err);
        });

        serverInstance.listen(9999, '127.0.0.1', () => {
            // Server successfully listening
        });
    });
}

async function spotifyOAuth() {
    // Check if code/URL was passed in argv
    const arg = process.argv[2];
    if (arg) {
        if (arg.startsWith('http')) {
            const urlObj = new URL(arg);
            authCode = urlObj.searchParams.get('code');
        } else {
            authCode = arg;
        }
        if (authCode) {
            console.log("Using provided authorization code directly...");
            return exchangeCodeForToken(authCode);
        }
    }

    const scope = "playlist-modify-private playlist-modify-public";
    const authUrl = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        response_type: "code",
        redirect_uri: SPOTIFY_REDIRECT_URI,
        scope
    }).toString();
    
    console.log("\n" + "=".repeat(65));
    console.log("SPOTIFY AUTHENTICATION REQUIRED");
    console.log("=".repeat(65));
    console.log(`Please open this URL in your browser to log in:\n\n${authUrl}\n`);
    
    try {
        console.log("Waiting for authentication redirect on port 9999...");
        await startCallbackServer();
    } catch (e) {
        console.log("\nFailed to start callback server (port 9999 might be in use).");
        console.log("No worries! Please log in using the URL above, and paste the final redirect URL (http://127.0.0.1:9999/callback?code=...) here:");
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const inputUrl = await new Promise(resolve => rl.question('> ', resolve));
        rl.close();
        
        try {
            const urlObj = new URL(inputUrl.trim());
            authCode = urlObj.searchParams.get('code');
        } catch {
            authCode = inputUrl.trim(); // Assume they pasted the code directly
        }
    }
    
    if (!authCode) {
        console.error("Error: Authentication failed.");
        process.exit(1);
    }
    
    return exchangeCodeForToken(authCode);
}

async function exchangeCodeForToken(code) {
    console.log("Exchanging authorization code for tokens...");
    const authHeader = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(SPOTIFY_AUTH_API, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: SPOTIFY_REDIRECT_URI
        })
    });
    
    const data = await res.json();
    if (data.error) {
        console.error("OAuth Exchange Error:", data.error_description || data.error);
        process.exit(1);
    }
    return data.access_token;
}

async function getSpotifyUserId(token) {
    const res = await fetch("https://api.spotify.com/v1/me", {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return data.id;
}

async function createSpotifyPlaylist(token, userId) {
    const res = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: "English Taste Mix",
            description: "Your personalized English/Western taste mix based on your Last.fm listening history.",
            public: false
        })
    });
    const data = await res.json();
    return data.id;
}

async function searchSpotifyTrack(token, title, artist) {
    const cleanTitle = title.split("-")[0].split("(")[0].trim();
    const cleanArtist = artist.split("&")[0].split("feat.")[0].trim();
    const query = `track:${cleanTitle} artist:${cleanArtist}`;
    
    const params = new URLSearchParams({
        q: query,
        type: "track",
        limit: 1
    });
    
    try {
        const res = await fetch("https://api.spotify.com/v1/search?" + params.toString(), {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const items = data.tracks && data.tracks.items || [];
        if (items.length > 0) return items[0].uri;
    } catch {}
    return null;
}

async function searchSpotifyArtist(token, artistName) {
    const params = new URLSearchParams({
        q: artistName,
        type: "artist",
        limit: 1
    });
    try {
        const res = await fetch("https://api.spotify.com/v1/search?" + params.toString(), {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const items = data.artists && data.artists.items || [];
        if (items.length > 0) return items[0].id;
    } catch {}
    return null;
}

async function getArtistTopTracks(token, artistId) {
    try {
        const res = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        return (data.tracks || []).map(t => t.uri).filter(Boolean);
    } catch {
        return [];
    }
}

async function addTracksToPlaylist(token, playlistId, uris) {
    for (let i = 0; i < uris.length; i += 100) {
        const batch = uris.slice(i, i + 100);
        await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: batch })
        });
    }
}

function interleave(lists) {
    const merged = [];
    const maxLen = Math.max(...lists.map(l => l.length), 0);
    for (let i = 0; i < maxLen; i++) {
        for (const list of lists) {
            if (i < list.length) merged.push(list[i]);
        }
    }
    return merged;
}

async function main() {
    console.log(`Fetching listening history for user '${LASTFM_USERNAME}' from Last.fm...`);
    
    // 1. Fetch Top Artists
    console.log("Fetching top artists (6month period)...");
    const artistParams = new URLSearchParams({
        method: "user.gettopartists",
        user: LASTFM_USERNAME,
        api_key: LASTFM_API_KEY,
        format: "json",
        period: "6month",
        limit: 40
    });
    
    let topArtists = [];
    try {
        const res = await fetch(LASTFM_API + "?" + artistParams.toString());
        const data = await res.json();
        topArtists = (data.topartists && data.topartists.artist || []).map(a => a.name).filter(Boolean);
    } catch (e) {
        console.error("Error fetching top artists:", e);
        process.exit(1);
    }
    console.log(`Retrieved ${topArtists.length} top artists.`);
    
    // 2. Filter for English artists
    console.log("\nFiltering top artists for English/Western music...");
    const englishTopArtists = [];
    for (const artist of topArtists) {
        if (await isEnglishArtist(artist)) {
            englishTopArtists.push(artist);
        }
    }
    console.log(`Kept ${englishTopArtists.length} English artists: ${englishTopArtists.slice(0, 10).join(', ')}...`);
    
    if (englishTopArtists.length === 0) {
        console.error("No English artists found in your history.");
        process.exit(1);
    }
    
    // 3. Expand with similar English artists
    console.log("\nExpanding seed with similar English/Western artists...");
    const allSeedArtists = [...englishTopArtists.slice(0, 15)];
    for (const artist of englishTopArtists.slice(0, 5)) {
        const similar = await getSimilarArtists(artist, 5);
        for (const s of similar) {
            if (!allSeedArtists.includes(s) && await isEnglishArtist(s)) {
                allSeedArtists.push(s);
            }
        }
    }
    const seedPool = allSeedArtists.slice(0, 30);
    console.log(`Selected ${seedPool.length} seed artists for the mix.`);
    
    // 4. Fetch Top Tracks
    console.log("\nFetching your top listened tracks (6month period)...");
    const trackParams = new URLSearchParams({
        method: "user.gettoptracks",
        user: LASTFM_USERNAME,
        api_key: LASTFM_API_KEY,
        format: "json",
        period: "6month",
        limit: 60
    });
    
    const userTopTracks = [];
    try {
        const res = await fetch(LASTFM_API + "?" + trackParams.toString());
        const data = await res.json();
        const tracks = data.toptracks && data.toptracks.track || [];
        for (const t of tracks) {
            const title = t.name;
            const artist = t.artist && t.artist.name;
            if (title && artist && await isEnglishArtist(artist)) {
                userTopTracks.push({ title, artist });
            }
        }
    } catch (e) {
        console.warn("Warning: Error fetching top tracks:", e);
    }
    console.log(`Kept ${userTopTracks.length} English tracks from your history.`);
    
    // 5. Spotify OAuth Flow
    const token = await spotifyOAuth();
    const userId = await getSpotifyUserId(token);
    const playlistId = await createSpotifyPlaylist(token, userId);
    console.log(`Created new Spotify playlist with ID: ${playlistId}`);
    
    // 6. Resolve Direct Top Tracks
    console.log("\nResolving your direct top tracks on Spotify...");
    const directUris = [];
    for (let i = 0; i < userTopTracks.length; i++) {
        const { title, artist } = userTopTracks[i];
        const uri = await searchSpotifyTrack(token, title, artist);
        if (uri) {
            directUris.push(uri);
            console.log(`  [FOUND] ${title} - ${artist}`);
        } else {
            console.log(`  [NOT FOUND] ${title} - ${artist}`);
        }
    }
    
    // 7. Fetch Candidate Tracks for seed artists
    console.log("\nFetching Spotify top tracks for seed artists...");
    const artistTracksLists = [];
    for (const artist of seedPool) {
        const artistId = await searchSpotifyArtist(token, artist);
        if (artistId) {
            const uris = await getArtistTopTracks(token, artistId);
            if (uris.length > 0) {
                artistTracksLists.push(uris.slice(0, 3));
                console.log(`  Fetched ${uris.slice(0, 3).length} tracks for ${artist}`);
            }
        } else {
            console.log(`  Artist not found on Spotify: ${artist}`);
        }
    }
    const mixedArtistUris = interleave(artistTracksLists);
    
    // 8. Combine
    const finalUris = [];
    const seen = new Set();
    for (const uri of directUris) {
        if (!seen.has(uri)) {
            seen.add(uri);
            finalUris.push(uri);
        }
    }
    for (const uri of mixedArtistUris) {
        if (!seen.has(uri)) {
            seen.add(uri);
            finalUris.push(uri);
        }
    }
    
    const sliceUris = finalUris.slice(0, 150);
    console.log(`\nFinalized playlist list containing ${sliceUris.length} tracks.`);
    
    if (sliceUris.length > 0) {
        console.log("Uploading tracks to Spotify...");
        await addTracksToPlaylist(token, playlistId, sliceUris);
        console.log(`\nSUCCESS! Created and populated your playlist.`);
        console.log(`Playlist Link: https://open.spotify.com/playlist/${playlistId}`);
    } else {
        console.log("No tracks resolved on Spotify.");
    }
}

main().catch(console.error);
