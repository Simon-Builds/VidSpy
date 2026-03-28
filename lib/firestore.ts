import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
  query,
  orderBy,
  limit,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

const ORG_ID = "default";

export interface TrackedChannel {
  channelId: string;
  channelTitle: string;
  channelThumbnail: string;
  uploadsPlaylistId: string;
  lastUpdated: Timestamp | null;
  subscriberCount?: number | null;
  totalViews?: number | null;
  // Aggregated metrics (populated by hourly poll)
  avgVphTotal?: number | null;
  avgVphLong?: number | null;
  avgVphShort?: number | null;
  avgViewsTotal?: number | null;
  avgViewsLong?: number | null;
  avgViewsShort?: number | null;
  videosLast30Days?: number | null;
}

export interface VideoSnapshot {
  videoId: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  vph: number | null;
  engagementRate: number | null;
  recordedAt: Timestamp;
}

/** Video metadata stored on the channel doc — identity + publish info only. */
export interface VideoMeta {
  videoId: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
  durationSeconds?: number | null;
  isShort?: boolean;
}

/** Mutable per-video polling state stored in the video_states sub-collection. */
export interface VideoState {
  isViralOverride: boolean;
  viralUpgradeAt: Timestamp | null;
}

/** One channel-level VPH data point stored in the vph_history sub-collection. */
export interface ChannelVphSnapshot {
  vph: number;
  recordedAt: Timestamp;
}

/** One video's VPH time-series for the multi-line chart. */
export interface VideoVphSeries {
  videoId: string;
  title: string;
  data: Array<{ time: string; vph: number }>;
  latestVph: number;
}

/** Pivoted chart data for the multi-line VPH comparison chart. */
export interface VideoVphChartData {
  series: VideoVphSeries[];  // top N videos sorted by latest VPH desc
  timestamps: string[];      // all unique HH:mm labels sorted asc (x-axis)
}

/** Full channel data assembled from Firestore (channel doc + latest snapshots). */
export interface TrackedChannelData {
  channelId: string;
  channelTitle: string;
  channelThumbnail: string;
  subscriberCount: number | null;
  totalViews: number | null;
  avgEngagementRate: number | null;
  videos: {
    videoId: string;
    title: string;
    thumbnail: string;
    publishedAt: string;
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    vph: number | null;
    engagementRate: number | null;
    durationSeconds: number | null;
    isShort: boolean;
  }[];
}

/**
 * Save a channel to tracked_channels and add it to the org watchlist.
 * Uses merge:true so re-tracking an existing channel is safe.
 */
export async function addTrackedChannel(
  channelId: string,
  channelTitle: string,
  channelThumbnail: string,
  uploadsPlaylistId: string
): Promise<void> {
  const channelRef = doc(db, "tracked_channels", channelId);
  await setDoc(
    channelRef,
    {
      channelTitle,
      channelThumbnail,
      uploadsPlaylistId,
      lastUpdated: serverTimestamp(),
    },
    { merge: true }
  );

  const orgRef = doc(db, "organizations", ORG_ID);
  const orgSnap = await getDoc(orgRef);
  const existing: string[] = orgSnap.exists()
    ? (orgSnap.data().watchlist ?? [])
    : [];
  if (!existing.includes(channelId)) {
    await setDoc(
      orgRef,
      { watchlist: [...existing, channelId], members: [] },
      { merge: true }
    );
  }
}

/**
 * Track a channel AND immediately cache the current video metrics as the
 * first baseline snapshot. VPH is null on this first snapshot because we
 * need at least two data points to compute a real delta.
 * Also stores video metadata (title, thumbnail, publishedAt) on the channel
 * doc so the Tracked Channels page can render without calling the YouTube API.
 */
export interface TrackVideoInput {
  videoId: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  durationSeconds?: number | null;
  isShort?: boolean;
}

export async function trackChannelWithData(
  channelId: string,
  channelTitle: string,
  channelThumbnail: string,
  uploadsPlaylistId: string,
  subscriberCount: number | null,
  totalViews: number | null,
  videos: TrackVideoInput[]
): Promise<Map<string, VideoSnapshot>> {
  const now = new Date();
  const isoKey = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const firestoreNow = Timestamp.fromMillis(now.getTime());

  const snapshotMap = new Map<string, VideoSnapshot>();
  const batch = writeBatch(db);

  // Build video metadata array for the channel doc
  const videosMeta: VideoMeta[] = [];

  for (const video of videos) {
    videosMeta.push({
      videoId: video.videoId,
      title: video.title,
      thumbnail: video.thumbnail,
      publishedAt: video.publishedAt,
      durationSeconds: video.durationSeconds ?? null,
      isShort: video.isShort ?? false,
    });

    if (video.viewCount == null) continue;

    const snapRef = doc(
      db,
      "tracked_channels",
      channelId,
      "snapshots",
      `${isoKey}_${video.videoId}`
    );

    const er =
      video.viewCount > 0
        ? Math.round(
            (((video.likeCount ?? 0) + (video.commentCount ?? 0)) /
              video.viewCount) *
              10000
          ) / 100
        : null;

    const snapshot: VideoSnapshot = {
      videoId: video.videoId,
      viewCount: video.viewCount ?? 0,
      likeCount: video.likeCount ?? 0,
      commentCount: video.commentCount ?? 0,
      vph: null,
      engagementRate: er,
      recordedAt: firestoreNow,
    };

    batch.set(snapRef, snapshot);
    snapshotMap.set(video.videoId, snapshot);
  }

  // Compute avg engagement rate from initial snapshot data
  const erVals = videos
    .filter((v) => v.viewCount != null && v.viewCount > 0)
    .map((v) =>
      Math.round(
        (((v.likeCount ?? 0) + (v.commentCount ?? 0)) / v.viewCount!) * 10000
      ) / 100
    );
  const avgEngagementRate =
    erVals.length > 0
      ? Math.round((erVals.reduce((a, b) => a + b, 0) / erVals.length) * 100) /
        100
      : null;

  // Write the channel doc with video metadata
  const channelRef = doc(db, "tracked_channels", channelId);
  batch.set(
    channelRef,
    {
      channelTitle,
      channelThumbnail,
      uploadsPlaylistId,
      subscriberCount,
      totalViews,
      lastUpdated: firestoreNow,
      videos: videosMeta,
      avgEngagementRate,
    },
    { merge: true }
  );

  await batch.commit();

  // Update org watchlist
  const orgRef = doc(db, "organizations", ORG_ID);
  const orgSnap = await getDoc(orgRef);
  const existing: string[] = orgSnap.exists()
    ? (orgSnap.data().watchlist ?? [])
    : [];
  if (!existing.includes(channelId)) {
    await setDoc(
      orgRef,
      { watchlist: [...existing, channelId], members: [] },
      { merge: true }
    );
  }

  return snapshotMap;
}

/**
 * Remove a channel from tracked_channels and from the org watchlist.
 */
export async function removeTrackedChannel(channelId: string): Promise<void> {
  await deleteDoc(doc(db, "tracked_channels", channelId));

  const orgRef = doc(db, "organizations", ORG_ID);
  const orgSnap = await getDoc(orgRef);
  if (orgSnap.exists()) {
    const existing: string[] = orgSnap.data().watchlist ?? [];
    await setDoc(
      orgRef,
      { watchlist: existing.filter((id) => id !== channelId) },
      { merge: true }
    );
  }
}

/**
 * Return all documents from tracked_channels (lightweight — for the sidebar).
 */
export async function getTrackedChannels(): Promise<TrackedChannel[]> {
  const snap = await getDocs(collection(db, "tracked_channels"));
  return snap.docs.map((d) => ({
    channelId: d.id,
    ...(d.data() as Omit<TrackedChannel, "channelId">),
  }));
}

/**
 * Return the latest snapshot for every video in a channel's snapshots
 * sub-collection, keyed by videoId.
 */
export async function getLatestSnapshotsForChannel(
  channelId: string
): Promise<Map<string, VideoSnapshot>> {
  const snapshotsRef = collection(
    db,
    "tracked_channels",
    channelId,
    "snapshots"
  );
  const snap = await getDocs(snapshotsRef);

  const latestMap = new Map<string, VideoSnapshot>();
  for (const d of snap.docs) {
    const data = d.data() as VideoSnapshot;
    const existing = latestMap.get(data.videoId);
    if (!existing || data.recordedAt.seconds > existing.recordedAt.seconds) {
      latestMap.set(data.videoId, data);
    }
  }

  return latestMap;
}

/**
 * Read a tracked channel's full data from Firestore — channel doc (has video
 * metadata like title/thumbnail/publishedAt) merged with latest snapshots
 * (has viewCount/likeCount/commentCount/vph).
 * No YouTube API calls needed.
 */
export async function getTrackedChannelData(
  channelId: string
): Promise<TrackedChannelData | null> {
  const channelRef = doc(db, "tracked_channels", channelId);
  const channelSnap = await getDoc(channelRef);
  if (!channelSnap.exists()) return null;

  const data = channelSnap.data();
  const videosMeta: VideoMeta[] = data.videos ?? [];

  const snapshots = await getLatestSnapshotsForChannel(channelId);

  const mergedVideos = videosMeta.map((meta) => {
    const snap = snapshots.get(meta.videoId);
    return {
      videoId: meta.videoId,
      title: meta.title,
      thumbnail: meta.thumbnail,
      publishedAt: meta.publishedAt,
      viewCount: snap?.viewCount ?? null,
      likeCount: snap?.likeCount ?? null,
      commentCount: snap?.commentCount ?? null,
      vph: snap?.vph ?? null,
      engagementRate:
        snap?.viewCount != null && snap.viewCount > 0
          ? Math.round(
              (((snap.likeCount ?? 0) + (snap.commentCount ?? 0)) /
                snap.viewCount) *
                10000
            ) / 100
          : (snap?.engagementRate ?? null),
      durationSeconds: meta.durationSeconds ?? null,
      isShort: meta.isShort ?? false,
    };
  });

  const erVals = mergedVideos
    .map((v) => v.engagementRate)
    .filter((v): v is number => v != null);
  const computedAvgEr =
    erVals.length > 0
      ? Math.round((erVals.reduce((a, b) => a + b, 0) / erVals.length) * 100) /
        100
      : null;

  return {
    channelId,
    channelTitle: data.channelTitle ?? "",
    channelThumbnail: data.channelThumbnail ?? "",
    subscriberCount: data.subscriberCount ?? null,
    totalViews: data.totalViews ?? null,
    avgEngagementRate: data.avgEngagementRate ?? computedAvgEr,
    videos: mergedVideos,
  };
}

/** One data point for the Single Video Pulse area chart. */
export interface VideoHistoryPoint {
  vph: number;
  time: string;       // "HH:mm" label for XAxis
  recordedAt: number; // unix seconds, used for in-memory sort
}

/**
 * Return all VPH snapshots for a specific video, sorted chronologically.
 * The first snapshot is dropped because it has no valid delta (VPH is
 * always null on the baseline snapshot). Uses an equality filter on videoId
 * only — no composite index required; sort is done client-side.
 */
export async function getVideoHistory(
  channelId: string,
  videoId: string
): Promise<VideoHistoryPoint[]> {
  const snapshotsRef = collection(db, "tracked_channels", channelId, "snapshots");
  const q = query(snapshotsRef, where("videoId", "==", videoId));
  const snap = await getDocs(q);

  const points = snap.docs
    .map((d) => {
      const data = d.data();
      const ts: Timestamp = data.recordedAt;
      const date = ts.toDate();
      return {
        vph: data.vph as number | null,
        time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        recordedAt: ts.seconds,
      };
    })
    .filter((p) => p.vph != null)   // exclude baseline + any null-delta snapshots
    .sort((a, b) => a.recordedAt - b.recordedAt)
    .map((p) => ({ vph: p.vph as number, time: p.time, recordedAt: p.recordedAt }));

  return points;
}

/**
 * Return the last N channel-level VPH snapshots from vph_history,
 * ordered chronologically (oldest first — ready for charting).
 */
export async function getChannelVphHistory(
  channelId: string,
  limitCount = 24
): Promise<ChannelVphSnapshot[]> {
  const ref = collection(db, "tracked_channels", channelId, "vph_history");
  const q = query(ref, orderBy("recordedAt", "desc"), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as ChannelVphSnapshot)
    .reverse(); // chronological order for chart
}

/**
 * Query the snapshots sub-collection for per-video VPH over the last
 * `hourLimit` hours, returning the top `topN` videos by latest VPH.
 * Returns pivoted data ready for a Recharts LineChart.
 *
 * Note: uses where("recordedAt", ">=", ...) + orderBy("recordedAt", "asc").
 * Single-field indexes are auto-created by Firestore. If a composite index
 * error appears in the console, click the URL it provides to fix in one click.
 */
export async function getVideoVphHistory(
  channelId: string,
  hourLimit = 24,
  topN = 10
): Promise<VideoVphChartData> {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hourLimit);

  // Load video titles from the channel doc
  const channelSnap = await getDoc(doc(db, "tracked_channels", channelId));
  const channelData = channelSnap.data();
  const titleMap = new Map<string, string>(
    (channelData?.videos ?? []).map(
      (v: { videoId: string; title: string }) => [v.videoId, v.title]
    )
  );

  // Query snapshots within the time window
  const snapshotsRef = collection(db, "tracked_channels", channelId, "snapshots");
  const q = query(
    snapshotsRef,
    where("recordedAt", ">=", Timestamp.fromDate(cutoff)),
    orderBy("recordedAt", "asc")
  );
  const snap = await getDocs(q);

  // Group by videoId → ordered VPH points
  const byVideo = new Map<string, Array<{ time: string; vph: number }>>();
  const latestVphMap = new Map<string, number>();

  for (const d of snap.docs) {
    const data = d.data() as VideoSnapshot;
    if (data.vph == null) continue;
    const time = data.recordedAt.toDate().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    if (!byVideo.has(data.videoId)) byVideo.set(data.videoId, []);
    byVideo.get(data.videoId)!.push({ time, vph: data.vph });
    latestVphMap.set(data.videoId, data.vph);
  }

  // Sort by latest VPH descending, take topN
  const sorted = [...byVideo.entries()]
    .sort((a, b) => (latestVphMap.get(b[0]) ?? 0) - (latestVphMap.get(a[0]) ?? 0))
    .slice(0, topN);

  const series: VideoVphSeries[] = sorted.map(([videoId, data]) => ({
    videoId,
    title: titleMap.get(videoId) ?? videoId,
    data,
    latestVph: latestVphMap.get(videoId) ?? 0,
  }));

  // Collect all unique timestamps for x-axis
  const allTimes = new Set<string>();
  for (const s of series) s.data.forEach((p) => allTimes.add(p.time));
  const timestamps = [...allTimes].sort();

  return { series, timestamps };
}
