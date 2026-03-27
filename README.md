# VidSpy

A YouTube competitor analysis platform that tracks channel performance, computes real-time Views Per Hour (VPH), and surfaces breakout content — built for enterprise teams who need signal, not noise.

**Stack:** Next.js 16 · Firebase Firestore · Cloud Functions v2 · YouTube Data API v3 · Tailwind v4 · Shadcn UI

---

## The VidSpy Smart Polling Engine

VidSpy's Cloud Function runs every hour, but not every video gets the same treatment. The polling engine uses a three-phase frequency model that balances data freshness against YouTube API quota — automatically adjusting based on video age and live VPH performance.

### Phase A — Active Scouting (0–7 days)

Every video published within the last **7 days (168 hours)** is polled **every hour**. This is the highest-resolution window for competitive analysis. VPH is computed as a true time-delta:

```
VPH = (currentViews − previousViews) / actualHoursBetween
```

### Phase B — Dormant Tracking (7–30 days)

Once a video passes the 7-day mark, it moves to a **12-hour polling cadence** to preserve API quota. VPH is normalised over the fixed interval:

```
VPH = (currentViews − previousViews) / 12
```

This keeps a consistent, comparable metric across videos polled at different times.

### Phase C — The Viral Exception

If a dormant video (> 7 days old) is polled and its VPH is **≥ 2× the channel's current average VPH**, it is automatically upgraded back to **hourly polling** for a rolling 24-hour window.

**The cooldown mechanism:** To prevent a viral video from staying in high-frequency polling indefinitely, every video in "Viral Mode" carries two state flags stored in Firestore:

- `isViralOverride: boolean` — whether hourly polling is active
- `viralUpgradeAt: Timestamp` — when the current 24-hour window started

On each run, if `viralUpgradeAt` is older than 24 hours, the system re-evaluates:
- VPH still ≥ 2× average → the window resets (`viralUpgradeAt = now`), hourly polling continues
- VPH dropped below threshold → `isViralOverride` is set to `false`, the video returns to Phase B

### Hard Cutoff (30 days+)

Videos older than 30 days are excluded from all polling. No API calls, no snapshot writes, no wasted quota. The 30-day window is sufficient for competitive intelligence — anything beyond that is historical data.

---

## VPH Display

In the Tracked Channels view, each video's VPH is shown in the table. VPH numbers appear in **green** when a video is currently above the channel's live average — making breakout content immediately visible at a glance.

The channel's average VPH is displayed as a stat card in the channel header, giving context for interpreting individual video performance.

---

## Firestore Data Model

```
tracked_channels/{channelId}
  channelTitle, channelThumbnail, uploadsPlaylistId
  subscriberCount, totalViews
  lastUpdated
  videos: VideoMeta[]          ← identity + publish metadata

  /snapshots/{timestamp_videoId}
    videoId, viewCount, likeCount, commentCount
    vph, recordedAt            ← immutable historical record

  /video_states/{videoId}
    isViralOverride: boolean   ← mutable polling state
    viralUpgradeAt: Timestamp
```

Snapshots are append-only and never overwritten — the full time-series is preserved for future historical analysis.

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

### Environment Variables

Create a `.env` file in the project root:

```
YOUTUBE_API_KEY=your_key
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

Create a `.env` file in the `functions/` directory:

```
YOUTUBE_API_KEY=your_key
```

### Deploy Cloud Functions

```bash
cd functions
npm install
firebase deploy --only functions
```
