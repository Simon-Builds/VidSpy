import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();
const YT_BASE = "https://www.googleapis.com/youtube/v3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelDoc {
  channelTitle: string;
  channelThumbnail: string;
  uploadsPlaylistId: string;
}

interface VideoEntry {
  videoId: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
}

interface VideoStats {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

interface PreviousSnapshot {
  viewCount: number;
  recordedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decide whether to poll a video on this run.
 * - Under 48 h → always poll (hourly cadence).
 * - 48 h and older → only poll once a day (when UTC hour === 0).
 */
function shouldPollVideo(publishedAt: string): boolean {
  const ageHours =
    (Date.now() - new Date(publishedAt).getTime()) / 3_600_000;
  if (ageHours < 48) return true;
  return new Date().getUTCHours() === 0;
}

/**
 * Fetch the most recent videos (up to 50) from an uploads playlist
 * that were published in the last 30 days.
 */
async function fetchRecentVideos(
  uploadsPlaylistId: string,
  apiKey: string
): Promise<VideoEntry[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const url = new URL(`${YT_BASE}/playlistItems`);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("playlistId", uploadsPlaylistId);
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`playlistItems.list failed (${res.status})`);
  }
  const data = await res.json() as {
    items?: {
      contentDetails: { videoId: string };
      snippet: {
        title?: string;
        publishedAt: string;
        thumbnails?: Record<string, { url: string }>;
      };
    }[];
  };

  return (data.items ?? [])
    .filter((item) => new Date(item.snippet.publishedAt) >= cutoff)
    .map((item) => ({
      videoId: item.contentDetails.videoId,
      title: item.snippet.title ?? "",
      thumbnail:
        item.snippet.thumbnails?.medium?.url ??
        item.snippet.thumbnails?.default?.url ??
        "",
      publishedAt: item.snippet.publishedAt,
    }));
}

/**
 * Batch-fetch statistics for up to 50 video IDs per API call.
 */
async function fetchVideoStatsBatch(
  videoIds: string[],
  apiKey: string
): Promise<Record<string, VideoStats>> {
  const statsMap: Record<string, VideoStats> = {};

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/videos`);
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`videos.list failed (${res.status})`);
    }
    const data = await res.json() as {
      items?: { id: string; statistics: Record<string, string> }[];
    };

    for (const item of data.items ?? []) {
      const s = item.statistics;
      statsMap[item.id] = {
        viewCount: s.viewCount != null ? Number(s.viewCount) : null,
        likeCount: s.likeCount != null ? Number(s.likeCount) : null,
        commentCount: s.commentCount != null ? Number(s.commentCount) : null,
      };
    }
  }

  return statsMap;
}

/**
 * Read the most recent snapshot for each videoId from a channel's snapshots
 * sub-collection. Returns a map of videoId → { viewCount, recordedAt }.
 */
async function getPreviousSnapshots(
  channelId: string,
  videoIds: string[]
): Promise<Map<string, PreviousSnapshot>> {
  const snapshotsRef = db
    .collection("tracked_channels")
    .doc(channelId)
    .collection("snapshots");

  const snap = await snapshotsRef.get();
  const latestMap = new Map<string, PreviousSnapshot>();
  const videoIdSet = new Set(videoIds);

  for (const doc of snap.docs) {
    const data = doc.data();
    const vid = data.videoId as string;
    if (!videoIdSet.has(vid)) continue;

    const existing = latestMap.get(vid);
    const recordedAt = data.recordedAt as Timestamp;
    if (!existing || recordedAt.seconds > existing.recordedAt.seconds) {
      latestMap.set(vid, {
        viewCount: data.viewCount as number,
        recordedAt,
      });
    }
  }

  return latestMap;
}

// ---------------------------------------------------------------------------
// Scheduled Cloud Function — runs every 60 minutes
// ---------------------------------------------------------------------------

export const pollTrackedChannels = onSchedule(
  {
    schedule: "every 60 minutes",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error("YOUTUBE_API_KEY environment variable is not set.");
      return;
    }

    const channelsSnap = await db.collection("tracked_channels").get();
    if (channelsSnap.empty) {
      console.log("No tracked channels found.");
      return;
    }

    const now = new Date();
    const isoKey = now.toISOString().replace(/\.\d{3}Z$/, "Z");

    for (const channelDoc of channelsSnap.docs) {
      const channelId = channelDoc.id;
      const { uploadsPlaylistId } = channelDoc.data() as ChannelDoc;

      try {
        // 1. Fetch recent videos
        const allVideos = await fetchRecentVideos(uploadsPlaylistId, apiKey);
        const videosToProcess = allVideos.filter((v) =>
          shouldPollVideo(v.publishedAt)
        );

        if (videosToProcess.length === 0) {
          console.log(`Channel ${channelId}: no videos to poll this run.`);
          continue;
        }

        // 2. Batch-fetch current stats from YouTube
        const statsMap = await fetchVideoStatsBatch(
          videosToProcess.map((v) => v.videoId),
          apiKey
        );

        // 3. Read previous snapshots from Firestore to compute deltas
        const prevSnapshots = await getPreviousSnapshots(
          channelId,
          videosToProcess.map((v) => v.videoId)
        );

        // 4. Compute delta-based VPH for each video
        const vphMap = new Map<string, number | null>();
        for (const video of videosToProcess) {
          const currentViews = statsMap[video.videoId]?.viewCount;
          const prev = prevSnapshots.get(video.videoId);

          if (currentViews == null || !prev) {
            // No previous snapshot — can't compute delta VPH yet
            vphMap.set(video.videoId, null);
            continue;
          }

          const hoursBetween =
            (now.getTime() - prev.recordedAt.toDate().getTime()) / 3_600_000;

          if (hoursBetween < 0.01) {
            // Less than ~36 seconds apart — avoid division by near-zero
            vphMap.set(video.videoId, null);
            continue;
          }

          const viewDelta = currentViews - prev.viewCount;
          const vph = viewDelta / hoursBetween;
          vphMap.set(video.videoId, Math.round(vph * 100) / 100);
        }

        // 5. Compute avg VPH from first 5 videos that have a real VPH
        const baselineVphs: number[] = [];
        for (const video of videosToProcess.slice(0, 5)) {
          const vph = vphMap.get(video.videoId);
          if (vph != null && vph > 0) baselineVphs.push(vph);
        }
        const avgVph =
          baselineVphs.length > 0
            ? baselineVphs.reduce((a, b) => a + b, 0) / baselineVphs.length
            : null;

        // 6. Write snapshots + track top momentum
        const batch = db.batch();
        let topMomentumVideoId: string | null = null;
        let topMomentumScore = 0;

        for (const video of videosToProcess) {
          const stats = statsMap[video.videoId];
          if (!stats?.viewCount) continue;

          const vph = vphMap.get(video.videoId) ?? null;
          let momentumScore: number | null = null;

          if (vph != null && avgVph != null && avgVph > 0) {
            momentumScore = Math.round((vph / avgVph) * 100) / 100;
          }

          const snapRef = db
            .collection("tracked_channels")
            .doc(channelId)
            .collection("snapshots")
            .doc(`${isoKey}_${video.videoId}`);

          batch.set(snapRef, {
            videoId: video.videoId,
            viewCount: stats.viewCount ?? 0,
            likeCount: stats.likeCount ?? 0,
            commentCount: stats.commentCount ?? 0,
            vph,
            momentumScore,
            recordedAt: Timestamp.fromDate(now),
          });

          if (momentumScore != null && momentumScore > topMomentumScore) {
            topMomentumScore = momentumScore;
            topMomentumVideoId = video.videoId;
          }
        }

        // Update parent channel doc — refresh video metadata + metrics
        const videosMeta = allVideos.map((v) => ({
          videoId: v.videoId,
          title: v.title,
          thumbnail: v.thumbnail,
          publishedAt: v.publishedAt,
        }));
        batch.update(channelDoc.ref, {
          lastUpdated: Timestamp.fromDate(now),
          currentTopMomentum: topMomentumVideoId,
          videos: videosMeta,
        });

        await batch.commit();
        console.log(
          `Channel ${channelId}: wrote ${videosToProcess.length} snapshots. Top momentum: ${topMomentumVideoId} (${topMomentumScore.toFixed(2)})`
        );
      } catch (err) {
        // Log and continue — one bad channel shouldn't abort the whole run
        console.error(`Error polling channel ${channelId}:`, err);
      }
    }
  }
);
