const YT_BASE = "https://www.googleapis.com/youtube/v3";

export interface VideoItem {
  videoId: string;
  title: string;
  publishedAt: string;
  thumbnail: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

export interface ChannelResult {
  channelTitle: string;
  channelThumbnail: string;
  videos: VideoItem[];
}

/**
 * Parses a YouTube channel URL / handle / ID and returns
 * the right query param for the channels.list endpoint.
 */
export function parseChannelInput(input: string): {
  param: "forHandle" | "id";
  value: string;
} {
  const trimmed = input.trim();

  // Full URL: https://www.youtube.com/@handle  or  youtube.com/channel/UC...
  try {
    const url = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`
    );
    const pathname = url.pathname;

    // /@handle
    const handleMatch = pathname.match(/^\/@([\w.-]+)/);
    if (handleMatch) {
      return { param: "forHandle", value: `@${handleMatch[1]}` };
    }

    // /channel/UC...
    const channelMatch = pathname.match(/^\/channel\/(UC[\w-]+)/);
    if (channelMatch) {
      return { param: "id", value: channelMatch[1] };
    }
  } catch {
    // not a URL — fall through
  }

  // Bare @handle
  if (trimmed.startsWith("@")) {
    return { param: "forHandle", value: trimmed };
  }

  // Bare UC... channel ID
  if (trimmed.startsWith("UC")) {
    return { param: "id", value: trimmed };
  }

  // Treat anything else as a handle
  return { param: "forHandle", value: `@${trimmed}` };
}

/**
 * Step 1 — resolve channel info + uploads playlist ID.
 */
export async function fetchUploadsPlaylistId(
  input: string,
  apiKey: string
): Promise<{ uploadsPlaylistId: string; channelTitle: string; channelThumbnail: string }> {
  const { param, value } = parseChannelInput(input);

  const url = new URL(`${YT_BASE}/channels`);
  url.searchParams.set("part", "contentDetails,snippet");
  url.searchParams.set(param, value);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `channels.list failed (${res.status})`);
  }

  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error("Channel not found. Check the URL or handle and try again.");

  return {
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    channelTitle: item.snippet.title,
    channelThumbnail: item.snippet.thumbnails?.default?.url ?? "",
  };
}

/**
 * Step 2 — fetch videos from the uploads playlist.
 */
export async function fetchPlaylistVideos(
  playlistId: string,
  apiKey: string,
  maxResults = 10
): Promise<VideoItem[]> {
  const url = new URL(`${YT_BASE}/playlistItems`);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `playlistItems.list failed (${res.status})`);
  }

  const data = await res.json();

  return (data.items ?? []).map(
    (item: {
      contentDetails: { videoId: string };
      snippet: { title: string; publishedAt: string; thumbnails?: { medium?: { url: string } } };
    }) => ({
      videoId: item.contentDetails.videoId,
      title: item.snippet.title,
      publishedAt: item.snippet.publishedAt,
      thumbnail: item.snippet.thumbnails?.medium?.url ?? "",
      viewCount: null,
      likeCount: null,
      commentCount: null,
    })
  );
}

/**
 * Step 3 — fetch view/like/comment counts for a list of video IDs.
 * Returns a map of videoId → stats for easy merging.
 */
export async function fetchVideoStats(
  videoIds: string[],
  apiKey: string
): Promise<Record<string, { viewCount: number | null; likeCount: number | null; commentCount: number | null }>> {
  const url = new URL(`${YT_BASE}/videos`);
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", videoIds.join(","));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `videos.list failed (${res.status})`);
  }

  const data = await res.json();
  const map: Record<string, { viewCount: number | null; likeCount: number | null; commentCount: number | null }> = {};

  for (const item of data.items ?? []) {
    const s = item.statistics;
    map[item.id] = {
      viewCount: s.viewCount != null ? Number(s.viewCount) : null,
      likeCount: s.likeCount != null ? Number(s.likeCount) : null,
      commentCount: s.commentCount != null ? Number(s.commentCount) : null,
    };
  }

  return map;
}
