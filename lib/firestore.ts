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

  // Add to org watchlist (no duplicates)
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
 * The Cloud Function will compute actual VPH on the next hourly run by
 * comparing against this baseline.
 */
export interface TrackVideoInput {
  videoId: string;
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

  // Write baseline snapshots — raw counts only, VPH/momentum = null
  for (const video of videos) {
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

  // Write the channel doc
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
 * Return all documents from tracked_channels.
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
 * Doc IDs are "{isoTimestamp}_{videoId}" so the most recent per video
 * is found by sorting on recordedAt.seconds descending.
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

  // Build a map: videoId → latest snapshot
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
