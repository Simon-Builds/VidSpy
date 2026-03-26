# VidSpy

A YouTube competitor analysis platform that tracks channel performance, computes real-time momentum scores, and surfaces breakout content — built for enterprise teams who need signal, not noise.

**Stack:** Next.js 16 · Firebase Firestore · Cloud Functions v2 · YouTube Data API v3 · Tailwind v4 · Shadcn UI

---

## The VidMetrics Smart Polling Engine

VidSpy's Cloud Function runs on a scheduled cadence, but not every video gets the same treatment. The polling engine uses a tiered frequency model that balances data freshness against YouTube API quota — automatically adjusting its behaviour based on video age and real-time performance signals.

### Active Scouting (< 48 hours)

Every video published within the last 48 hours is polled **hourly**. This is the most critical window for competitive analysis — upload velocity, early traction, and audience response are all captured at the highest resolution. Delta-based Views Per Hour (VPH) and Momentum Scores are computed on every snapshot.

### The Viral Exception

Any video with a **Momentum Score above 2.0** is automatically promoted back to hourly polling, regardless of its age. A 10-day-old video that suddenly catches fire will be detected on the next scheduled run and upgraded from daily to hourly — ensuring the platform never misses a breakout hit. Once momentum drops back below the threshold, the video returns to its normal daily cadence.

### Resource Optimisation (48 hours – 30 days)

Videos between 48 hours and 30 days old that are performing within normal range (Momentum ≤ 2.0) are synced **once per day** at midnight UTC. This preserves API quota for the content that matters most while still maintaining a complete picture of the channel's catalogue.

### Hard Cutoff (30 days+)

Videos older than 30 days are excluded from all polling. No API calls, no snapshot writes, no wasted compute. The 30-day window is more than sufficient for competitive intelligence — anything beyond that is historical data, not actionable signal.

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

### Environment Variables

Create a `.env` file with:

```
YOUTUBE_API_KEY=your_key
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

### Deploy Cloud Functions

```bash
cd functions
npm install
npm run build
firebase deploy --only functions
```
