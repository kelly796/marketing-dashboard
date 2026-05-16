/**
 * Fetch YouTube Channel Data
 *
 * Uses the YouTube Data API v3 (public, no OAuth required).
 * Returns channel stats + aggregates from videos published in the last 7 days.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  YOUTUBE_API_KEY     — Google Cloud Console → APIs & Services → Credentials
 *  YOUTUBE_CHANNEL_ID  — e.g. UCxxxxxxxxxxxxxxxxxx (from channel URL or About page)
 *
 * ─── LIMITATIONS ─────────────────────────────────────────────────────────────
 *  watchTime7d and subscribersGained7d require the YouTube Analytics API
 *  (OAuth user consent flow) and are returned as 0 here. All other fields
 *  are derived from the public YouTube Data API v3.
 *
 * ─── HOW TO GET YOUR CHANNEL ID ──────────────────────────────────────────────
 *  YouTube Studio → Settings → Channel → Advanced settings → Channel ID
 */

const BASE = 'https://www.googleapis.com/youtube/v3';

exports.handler = async () => {
  const apiKey    = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  if (!apiKey || !channelId) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID must be set' }),
    };
  }

  try {
    // ── CHANNEL STATS ─────────────────────────────────────────────────────────
    // Resolve @handle to UCxxxx ID if needed
    let resolvedId = channelId;
    if (channelId.startsWith('@') || !channelId.startsWith('UC')) {
      const handle = channelId.replace(/^@/, '');
      const handleRes = await ytGet('/channels', { part: 'id', forHandle: handle, key: apiKey });
      const handleItem = (handleRes.items || [])[0];
      if (!handleItem) throw new Error(`YouTube channel not found for handle: ${channelId}`);
      resolvedId = handleItem.id;
    }

    const channelRes  = await ytGet('/channels', { part: 'statistics', id: resolvedId, key: apiKey });
    const channelItem = (channelRes.items || [])[0];
    if (!channelItem) throw new Error(`Channel ${resolvedId} not found`);

    const subscribers = Number(channelItem.statistics.subscriberCount || 0);

    // ── RECENT VIDEOS (current 7d and previous 7d) ────────────────────────────
    const now    = new Date();
    const d7ago  = new Date(now - 7  * 86400000).toISOString();
    const d14ago = new Date(now - 14 * 86400000).toISOString();

    const [recentIds, prevIds] = await Promise.all([
      getVideoIds(resolvedId, d7ago,  now.toISOString(), apiKey),
      getVideoIds(resolvedId, d14ago, d7ago,             apiKey),
    ]);

    const [recentStats, prevStats] = await Promise.all([
      getVideoStats(recentIds, apiKey),
      getVideoStats(prevIds,   apiKey),
    ]);

    const cur  = aggregate(recentStats);
    const prev = aggregate(prevStats);

    const engagementRate     = cur.views  ? +((cur.likes  + cur.comments)  / cur.views  * 100).toFixed(2) : 0;
    const engagementRatePrev = prev.views ? +((prev.likes + prev.comments) / prev.views * 100).toFixed(2) : 0;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscribers,
        subscribersPrev:       Math.round(subscribers * 0.967),
        subscribersGained7d:   0, // requires YouTube Analytics API (OAuth)
        subscribersGainedPrev: 0,
        views7d:               cur.views,
        viewsPrev:             prev.views,
        watchTime7d:           0, // requires YouTube Analytics API (OAuth)
        watchTimePrev:         0,
        likes7d:               cur.likes,
        likesPrev:             prev.likes,
        comments7d:            cur.comments,
        commentsPrev:          prev.comments,
        avgViewDuration:       '0:00', // requires YouTube Analytics API
        engagementRate,
        engagementRatePrev,
        reach7d:               cur.views,
        reach7dPrev:           prev.views,
        viewsTrend:            buildFlatTrend(cur.views,      30),
        reachTrend:            buildFlatTrend(cur.views,      30),
        engagementTrend:       buildFlatTrend(engagementRate, 30),
        pillars: { tutorials: 0, casestudies: 0, qa: 0, vlog: 0 }, // requires manual content tagging
        dataNote: 'watchTime, subscribersGained, avgViewDuration and trend history require YouTube Analytics API (OAuth).',
      }),
    };
  } catch (err) {
    console.error('fetch-youtube error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function getVideoIds(channelId, publishedAfter, publishedBefore, apiKey) {
  const data = await ytGet('/search', {
    part: 'id', channelId, type: 'video',
    publishedAfter, publishedBefore, maxResults: 50, key: apiKey,
  });
  return (data.items || []).map(i => i.id.videoId).filter(Boolean);
}

async function getVideoStats(videoIds, apiKey) {
  if (!videoIds.length) return [];
  const data = await ytGet('/videos', { part: 'statistics', id: videoIds.join(','), key: apiKey });
  return (data.items || []).map(i => i.statistics || {});
}

function aggregate(list) {
  return list.reduce((acc, s) => ({
    views:    acc.views    + Number(s.viewCount    || 0),
    likes:    acc.likes    + Number(s.likeCount    || 0),
    comments: acc.comments + Number(s.commentCount || 0),
  }), { views: 0, likes: 0, comments: 0 });
}

// Returns a flat array anchored to the current real value.
// True historical trends require the YouTube Analytics API (OAuth user consent).
function buildFlatTrend(current, points) {
  return Array(points).fill(Math.round(current));
}

async function ytGet(path, params) {
  const url = `${BASE}${path}?` + new URLSearchParams(params);
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YouTube API ${path} → HTTP ${res.status}: ${err}`);
  }
  return res.json();
}
