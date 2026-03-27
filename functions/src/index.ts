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
  vph: number | null;
  recordedAt: Timestamp;
}

interface VideoState {
  isViralOverride: boolean;
  viralUpgradeAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 3-phase polling decision:
 *
 *  Phase A — age ≤ 7 days (168 h)  → always poll hourly
 *  Phase B — age > 7 days, no viral override → poll every 12 h
 *  Phase C — age > 7 days, viral override active or expiring → poll hourly
 *  Hard cutoff — age > 30 days (720 h) → never poll
 *
 * Phase C covers both an active 24 h window AND the expiry re-evaluation:
 * the post-poll logic (not here) decides whether to extend or end the override.
 */
function shouldPoll(
  ageHours: number,
  lastSnapshotHoursAgo: number | null,
  state: VideoState
): boolean {
  // Hard cutoff
  if (ageHours > 720) return false;

  // Phase A — always hourly
  if (ageHours <= 168) return true;

  // Phase C — viral override active or needs re-evaluation after 24 h
  if (state.isViralOverride) return true;

  // Phase B — only if 12+ hours since last snapshot (or no snapshot yet)
  return lastSnapshotHoursAgo == null || lastSnapshotHoursAgo >= 12;
}

/**
 * Read the video_states sub-collection for a channel.
 * Returns a map of videoId → VideoState.
 */
async function getVideoStates(
  channelId: string
): Promise<Map<string, VideoState>> {
  const snap = await db
    .collection("tracked_channels")
    .doc(channelId)
    .collection("video_states")
    .get();

  const map = new Map<string, VideoState>();
  for (const d of snap.docs) {
    const data = d.data();
    map.set(d.id, {
      isViralOverride: data.isViralOverride ?? false,
      viralUpgradeAt: (data.viralUpgradeAt as Timestamp) ?? null,
    });
  }
  return map;
}

/**
 * Upsert a single video_states doc.
 */
async function setVideoState(
  channelId: string,
  videoId: string,
  state: VideoState
): Promise<void> {
  await db
    .collection("tracked_channels")
    .doc(channelId)
    .collection("video_states")
    .doc(videoId)
    .set(state);
}

/**
 * Fetch the most recent videos (up to 50) from an uploads playlist
 * published in the last 30 days.
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
  if (!res.ok) throw new Error(`playlistItems.list failed (${res.status})`);

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
    const batchIds = videoIds.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/videos`);
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", batchIds.join(","));
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`videos.list failed (${res.status})`);

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
 * Read the most recent snapshot for each videoId in a channel.
 * Returns a map of videoId → { viewCount, vph, recordedAt }.
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

  for (const d of snap.docs) {
    const data = d.data();
    const vid = data.videoId as string;
    if (!videoIdSet.has(vid)) continue;

    const recordedAt = data.recordedAt as Timestamp;
    const existing = latestMap.get(vid);
    if (!existing || recordedAt.seconds > existing.recordedAt.seconds) {
      latestMap.set(vid, {
        viewCount: data.viewCount as number,
        vph: (data.vph as number | undefined) ?? null,
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
    const nowMs = now.getTime();
    const isoKey = now.toISOString().replace(/\.\d{3}Z$/, "Z");

    for (const channelDoc of channelsSnap.docs) {
      const channelId = channelDoc.id;
      const { uploadsPlaylistId } = channelDoc.data() as ChannelDoc;

      try {
        // 1. Fetch recent videos (last 30 days)
        const allVideos = await fetchRecentVideos(uploadsPlaylistId, apiKey);

        // 2. Load snapshots and viral states for all videos
        const prevSnapshots = await getPreviousSnapshots(
          channelId,
          allVideos.map((v) => v.videoId)
        );
        const videoStates = await getVideoStates(channelId);

        // 3. Compute channel avg VPH from latest known snapshots
        const allKnownVphs = Array.from(prevSnapshots.values())
          .map((s) => s.vph)
          .filter((v): v is number => v != null && v > 0);
        const channelAvgVph =
          allKnownVphs.length > 0
            ? allKnownVphs.reduce((a, b) => a + b, 0) / allKnownVphs.length
            : null;

        // 4. Filter to videos that should be polled this run
        const videosToProcess = allVideos.filter((v) => {
          const ageHours =
            (nowMs - new Date(v.publishedAt).getTime()) / 3_600_000;
          const prev = prevSnapshots.get(v.videoId);
          const lastSnapshotHoursAgo = prev
            ? (nowMs - prev.recordedAt.toDate().getTime()) / 3_600_000
            : null;
          const state: VideoState = videoStates.get(v.videoId) ?? {
            isViralOverride: false,
            viralUpgradeAt: null,
          };
          return shouldPoll(ageHours, lastSnapshotHoursAgo, state);
        });

        if (videosToProcess.length === 0) {
          console.log(`Channel ${channelId}: no videos to poll this run.`);
          continue;
        }

        // 5. Batch-fetch current stats from YouTube
        const statsMap = await fetchVideoStatsBatch(
          videosToProcess.map((v) => v.videoId),
          apiKey
        );

        // 6. Compute VPH per video using phase-appropriate formula
        const vphMap = new Map<string, number | null>();
        for (const video of videosToProcess) {
          const currentViews = statsMap[video.videoId]?.viewCount;
          const prev = prevSnapshots.get(video.videoId);

          if (currentViews == null || !prev) {
            // No previous snapshot — first poll, can't compute delta
            vphMap.set(video.videoId, null);
            continue;
          }

          const ageHours =
            (nowMs - new Date(video.publishedAt).getTime()) / 3_600_000;
          const state: VideoState = videoStates.get(video.videoId) ?? {
            isViralOverride: false,
            viralUpgradeAt: null,
          };
          const viewDelta = currentViews - prev.viewCount;

          let vph: number;
          if (ageHours <= 168 || state.isViralOverride) {
            // Phase A or Phase C — use actual elapsed hours (hourly polling)
            const hoursBetween =
              (nowMs - prev.recordedAt.toDate().getTime()) / 3_600_000;
            if (hoursBetween < 0.01) {
              vphMap.set(video.videoId, null);
              continue;
            }
            vph = viewDelta / hoursBetween;
          } else {
            // Phase B — fixed 12 h denominator
            vph = viewDelta / 12;
          }

          vphMap.set(video.videoId, Math.round(vph * 100) / 100);
        }

        // 7a. Compute engagement rate per polled video
        const erMap = new Map<string, number | null>();
        for (const video of videosToProcess) {
          const stats = statsMap[video.videoId];
          if (!stats?.viewCount || stats.viewCount === 0) {
            erMap.set(video.videoId, null);
            continue;
          }
          const er =
            (((stats.likeCount ?? 0) + (stats.commentCount ?? 0)) /
              stats.viewCount) *
            100;
          erMap.set(video.videoId, Math.round(er * 100) / 100);
        }

        const erValues = Array.from(erMap.values()).filter(
          (v): v is number => v != null
        );
        const avgEngagementRate =
          erValues.length > 0
            ? Math.round(
                (erValues.reduce((a, b) => a + b, 0) / erValues.length) * 100
              ) / 100
            : null;

        // 7. Write snapshot docs and update channel metadata
        const batch = db.batch();

        for (const video of videosToProcess) {
          const stats = statsMap[video.videoId];
          if (!stats?.viewCount) continue;

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
            vph: vphMap.get(video.videoId) ?? null,
            engagementRate: erMap.get(video.videoId) ?? null,
            recordedAt: Timestamp.fromDate(now),
          });
        }

        // Refresh video metadata on the channel doc
        const videosMeta = allVideos.map((v) => ({
          videoId: v.videoId,
          title: v.title,
          thumbnail: v.thumbnail,
          publishedAt: v.publishedAt,
        }));
        batch.update(channelDoc.ref, {
          lastUpdated: Timestamp.fromDate(now),
          videos: videosMeta,
          avgEngagementRate,
        });

        await batch.commit();

        // 8. Update viral states (separate sub-collection — outside the batch)
        const stateUpdates: Promise<void>[] = [];

        for (const video of videosToProcess) {
          const vph = vphMap.get(video.videoId);
          if (vph == null) continue;

          const ageHours =
            (nowMs - new Date(video.publishedAt).getTime()) / 3_600_000;
          if (ageHours <= 168) continue; // Phase A: no viral state needed

          const state: VideoState = videoStates.get(video.videoId) ?? {
            isViralOverride: false,
            viralUpgradeAt: null,
          };
          const viralAgeHours = state.viralUpgradeAt
            ? (nowMs - state.viralUpgradeAt.toDate().getTime()) / 3_600_000
            : null;
          const viralExpired = viralAgeHours != null && viralAgeHours >= 24;

          if (channelAvgVph != null && vph >= 2 * channelAvgVph) {
            // Upgrade to or extend viral override
            if (!state.isViralOverride || viralExpired) {
              stateUpdates.push(
                setVideoState(channelId, video.videoId, {
                  isViralOverride: true,
                  viralUpgradeAt: Timestamp.fromDate(now),
                })
              );
            }
            // Active override within 24 h: no write needed
          } else if (state.isViralOverride && viralExpired) {
            // VPH dropped below 2× threshold after 24 h → demote to Phase B
            stateUpdates.push(
              setVideoState(channelId, video.videoId, {
                isViralOverride: false,
                viralUpgradeAt: null,
              })
            );
          }
        }

        await Promise.all(stateUpdates);

        console.log(
          `Channel ${channelId}: wrote ${videosToProcess.length} snapshots, ` +
          `${stateUpdates.length} state updates. Avg VPH: ${channelAvgVph?.toFixed(1) ?? "n/a"}`
        );
      } catch (err) {
        console.error(`Error polling channel ${channelId}:`, err);
      }
    }
  }
);
