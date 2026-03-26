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
} from "firebase/firestore";
import { db } from "./firebase";

const ORG_ID = "default";

export interface TrackedChannel {
  channelId: string;
  channelTitle: string;
  channelThumbnail: string;
  uploadsPlaylistId: string;
  lastUpdated: Timestamp | null;
  currentTopMomentum: string | null;
  subscriberCount?: number | null;
  totalViews?: number | null;
}

export interface VideoSnapshot {
  videoId: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  vph: number | null;
  momentumScore: number | null;
  recordedAt: Timestamp;
}

/** Video metadata stored on the channel doc — no stats, just identity + publish info. */
export interface VideoMeta {
  videoId: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
}

/** Full channel data assembled from Firestore (channel doc + snapshots). */
export interface TrackedChannelData {
  channelId: string;
  channelTitle: string;
  channelThumbnail: string;
  subscriberCount: number | null;
  totalViews: number | null;
  videos: {
    videoId: string;
    title: string;
    thumbnail: string;
    publishedAt: string;
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    vph: number | null;
    momentumScore: number | null;
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
      currentTopMomentum: null,
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
 * first baseline snapshot. VPH and momentum are null on this first snapshot
 * because we need at least two data points to compute a real delta.
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
    });

    if (video.viewCount == null) continue;

    const snapRef = doc(
      db,
      "tracked_channels",
      channelId,
      "snapshots",
      `${isoKey}_${video.videoId}`
    );

    const snapshot: VideoSnapshot = {
      videoId: video.videoId,
      viewCount: video.viewCount ?? 0,
      likeCount: video.likeCount ?? 0,
      commentCount: video.commentCount ?? 0,
      vph: null,
      momentumScore: null,
      recordedAt: firestoreNow,
    };

    batch.set(snapRef, snapshot);
    snapshotMap.set(video.videoId, snapshot);
  }

  // Write the channel doc — includes video metadata
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
      currentTopMomentum: null,
      videos: videosMeta,
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
 * (has viewCount/likeCount/commentCount/vph/momentumScore).
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

  // Get latest snapshots
  const snapshots = await getLatestSnapshotsForChannel(channelId);

  // Merge metadata + snapshots
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
      momentumScore: snap?.momentumScore ?? null,
    };
  });

  return {
    channelId,
    channelTitle: data.channelTitle ?? "",
    channelThumbnail: data.channelThumbnail ?? "",
    subscriberCount: data.subscriberCount ?? null,
    totalViews: data.totalViews ?? null,
    videos: mergedVideos,
  };
}
