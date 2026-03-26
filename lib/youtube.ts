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

type RawPlaylistItem = {
  contentDetails: { videoId: string };
  snippet: { title: string; publishedAt: string; thumbnails?: { medium?: { url: string } } };
};

/**
 * Step 2 — paginate the uploads playlist, fetching 50 at a time.
 * Stops as soon as the last video in a page is older than 30 days.
 * Returns only videos published within the last 30 days.
 */
export async function fetchPlaylistVideos(
  playlistId: string,
  apiKey: string
): Promise<VideoItem[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const allItems: VideoItem[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${YT_BASE}/playlistItems`);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `playlistItems.list failed (${res.status})`);
    }

    const data = await res.json();
    const items: RawPlaylistItem[] = data.items ?? [];

    for (const item of items) {
      if (new Date(item.snippet.publishedAt) >= cutoff) {
        allItems.push({
          videoId: item.contentDetails.videoId,
          title: item.snippet.title,
          publishedAt: item.snippet.publishedAt,
          thumbnail: item.snippet.thumbnails?.medium?.url ?? "",
          viewCount: null,
          likeCount: null,
          commentCount: null,
        });
      }
    }

    // Stop paginating if the last item on this page is older than the cutoff
    const lastItem = items[items.length - 1];
    const lastDate = lastItem ? new Date(lastItem.snippet.publishedAt) : new Date(0);
    if (lastDate < cutoff || !data.nextPageToken) break;

    pageToken = data.nextPageToken;
  } while (true);

  return allItems;
}

/**
 * Step 3 — fetch view/like/comment counts for a list of video IDs.
 * Batches requests in groups of 50 (API limit).
 * Returns a map of videoId → stats for easy merging.
 */
export async function fetchVideoStats(
  videoIds: string[],
  apiKey: string
): Promise<Record<string, { viewCount: number | null; likeCount: number | null; commentCount: number | null }>> {
  const map: Record<string, { viewCount: number | null; likeCount: number | null; commentCount: number | null }> = {};

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/videos`);
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `videos.list failed (${res.status})`);
    }

    const data = await res.json();
    for (const item of data.items ?? []) {
      const s = item.statistics;
      map[item.id] = {
        viewCount: s.viewCount != null ? Number(s.viewCount) : null,
        likeCount: s.likeCount != null ? Number(s.likeCount) : null,
        commentCount: s.commentCount != null ? Number(s.commentCount) : null,
      };
    }
  }

  return map;
}
