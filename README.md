# VidSpy

A tool that tracks YouTube channels and tells you which videos are doing well right now. It checks views every hour and calculates how fast each video is growing.

**Built with:** Next.js 16 · Firebase Firestore · Cloud Functions v2 · YouTube Data API v3 · Tailwind v4 · Shadcn UI

---

## Getting Started

### What You Need

- Node.js 18+
- A Firebase project with Firestore turned on
- A YouTube Data API v3 key

### Install & Run

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

### Deploy to Vercel

```bash
vercel --prod
```

Make sure to add `YOUTUBE_API_KEY` to your Vercel project's environment variables. The Search page won't work without it.

---

## Build Approach

Everything lives in one file — `app/page.tsx`. There are three views (Search, Tracked Channels, Competitor Analysis) and they switch using state, not routes. This makes switching between views instant and keeps things simple.

**Firebase does the backend work.** Firestore saves all the channel and video data. A Cloud Function runs every hour, checks YouTube for new stats, and saves them. No custom server needed.

**Smart polling saves API quota.** New videos (under 7 days old) get checked every hour. Older videos (7–30 days) only get checked every 12 hours. If an older video suddenly blows up, it gets bumped back to hourly checks. Videos older than 30 days stop getting checked.

**One place for all filters.** Search, content type, date range, min/max for views, VPH, likes, comments, and engagement — all go through one `useMemo` block. This replaced three copies of the same filtering code.

**Nothing resets on refresh.** Your selected channel, view, sidebar, and filters are saved in the browser so they're still there when you come back.

**Works on phones.** Hamburger menu, sideways-scrolling channel list, and rows that expand when you tap them. Works from 375px screens and up.

---

## How Polling Works

A Cloud Function runs every hour. But not every video gets checked every time — that would use too much YouTube API quota. So videos get checked at different speeds depending on how old they are.

### New Videos (0–7 days)

Checked **every hour**. This is when a video's growth matters most. VPH is calculated like this:

```
VPH = (current views − previous views) / hours between checks
```

### Older Videos (7–30 days)

Checked **every 12 hours**. They're past their peak, so we don't need to watch them as closely. VPH is calculated the same way but over the 12-hour gap.

### Viral Comeback

If an older video suddenly gets a VPH that's **2x the channel's average**, it gets bumped back to hourly checks for 24 hours. After 24 hours, the system checks again — if it's still hot, the hourly window resets. If it's cooled off, it goes back to 12-hour checks.

This uses two fields in Firestore:

- `isViralOverride` — is this video in viral mode?
- `viralUpgradeAt` — when did viral mode start?

### 30+ Days

Videos older than 30 days don't get checked at all. No API calls, no data saved.

---

## Metrics

### VPH (Views Per Hour)

Each video shows its VPH in the table. If a video's VPH is higher than the channel's average, it shows up in **green** so you can spot it fast.

### Engagement Rate

How much people interact with a video compared to how many watched it:

```
engagement = ((likes + comments) / views) × 100
```

- Shown as a percentage like `5.42%`
- **Blue** if it's above the channel average
- Shows `—` if there are no views yet

---

## Database Structure

```
tracked_channels/{channelId}
  channelTitle, channelThumbnail, uploadsPlaylistId
  subscriberCount, totalViews
  avgEngagementRate              ← channel average, updated each poll
  lastUpdated
  videos: VideoMeta[]            ← basic info about each video

  /snapshots/{timestamp_videoId}
    videoId, viewCount, likeCount, commentCount
    vph, engagementRate          ← saved and never changed
    recordedAt

  /video_states/{videoId}
    isViralOverride: boolean     ← is viral mode on?
    viralUpgradeAt: Timestamp    ← when viral mode started
```

Snapshots are never overwritten. Every check adds a new one, so the full history is always there.
