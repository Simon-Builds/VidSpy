import { NextRequest, NextResponse } from "next/server";
import { fetchUploadsPlaylistId, fetchPlaylistVideos, fetchVideoStats } from "@/lib/youtube";

export async function POST(req: NextRequest) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "YouTube API key is not configured." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const channelInput: string = body.channelInput?.trim() ?? "";

  if (!channelInput) {
    return NextResponse.json(
      { error: "channelInput is required." },
      { status: 400 }
    );
  }

  try {
    const { uploadsPlaylistId, channelTitle, channelThumbnail, subscriberCount, totalViews } =
      await fetchUploadsPlaylistId(channelInput, apiKey);

    const videos = await fetchPlaylistVideos(uploadsPlaylistId, apiKey);

    const videoIds = videos.map((v) => v.videoId);
    const statsMap = await fetchVideoStats(videoIds, apiKey);
    const videosWithStats = videos.map((v) => ({
      ...v,
      ...statsMap[v.videoId],
    }));

    const channelId = uploadsPlaylistId.replace(/^UU/, "UC");
    return NextResponse.json({
      channelId,
      channelTitle,
      channelThumbnail,
      uploadsPlaylistId,
      subscriberCount,
      totalViews,
      videos: videosWithStats,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
