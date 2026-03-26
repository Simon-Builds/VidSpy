"use client";

import { useState, useEffect, useCallback } from "react";
import {
  PlaySquare,
  Search,
  Loader2,
  BookmarkPlus,
  Check,
  Radio,
  Trash2,
  Eye,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  trackChannelWithData,
  removeTrackedChannel,
  getTrackedChannels,
  getLatestSnapshotsForChannel,
  type TrackedChannel,
  type VideoSnapshot,
} from "@/lib/firestore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VideoItem {
  videoId: string;
  title: string;
  publishedAt: string;
  thumbnail: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  vph: number | null;
  momentumScore: number | null;
  momentumLabel: "Steady Growth" | "Crushing It" | "Viral Velocity" | null;
}

interface ApiResult {
  channelId: string;
  channelTitle: string;
  channelThumbnail: string;
  uploadsPlaylistId: string;
  subscriberCount: number | null;
  totalViews: number | null;
  videos: VideoItem[];
}

type NavItem = "search" | "tracked";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number | null) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getMomentumLabel(
  score: number | null
): "Steady Growth" | "Crushing It" | "Viral Velocity" | null {
  if (score == null) return null;
  if (score >= 2.5) return "Viral Velocity";
  if (score >= 2.0) return "Crushing It";
  if (score >= 1.0) return "Steady Growth";
  return null;
}

function MomentumBadge({
  label,
  score,
}: {
  label: "Steady Growth" | "Crushing It" | "Viral Velocity" | null;
  score: number | null;
}) {
  if (!label) return <span className="text-muted-foreground">—</span>;

  const config = {
    "Steady Growth": {
      styles:
        "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
    },
    "Crushing It": {
      styles:
        "bg-green-50 text-green-700 border border-green-200 animate-pulse dark:bg-green-950/40 dark:text-green-300 dark:border-green-800",
    },
    "Viral Velocity": {
      styles:
        "bg-orange-50 text-orange-700 border border-orange-200 animate-pulse dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800",
    },
  };

  const { styles } = config[label];
  const scoreText = score != null ? ` ${score.toFixed(1)}x` : "";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}
    >
      {label === "Viral Velocity" && "🔥 "}
      {label}
      <span className="opacity-60">{scoreText}</span>
    </span>
  );
}

/** Shared video stats table */
function VideoTable({ videos }: { videos: VideoItem[] }) {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">Video Title</TableHead>
            <TableHead className="w-28 text-right">Views</TableHead>
            <TableHead className="w-24 text-right">Likes</TableHead>
            <TableHead className="w-28 text-right">Comments</TableHead>
            <TableHead
              className="w-28 text-right"
              title="Views gained per hour (delta between snapshots)"
            >
              VPH
            </TableHead>
            <TableHead
              className="w-44 text-right"
              title="Relative to channel's 30-day avg VPH. 1.0x = average, 2.0x+ = outperforming"
            >
              Momentum
            </TableHead>
            <TableHead className="w-36 pr-6 text-right">Published</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {videos.map((video) => (
            <TableRow key={video.videoId}>
              <TableCell className="pl-6">
                <a
                  href={`https://www.youtube.com/watch?v=${video.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {video.title}
                </a>
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatNumber(video.viewCount)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatNumber(video.likeCount)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatNumber(video.commentCount)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {video.vph != null
                  ? `${formatNumber(Math.round(video.vph))}/hr`
                  : "—"}
              </TableCell>
              <TableCell className="text-right">
                <MomentumBadge
                  label={video.momentumLabel}
                  score={video.momentumScore}
                />
              </TableCell>
              <TableCell className="pr-6 text-right text-muted-foreground">
                {formatDate(video.publishedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="border-t px-6 py-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="font-medium">Momentum</span>
        <span>= VPH relative to channel&apos;s 30-day avg.</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
          1.0–1.9x Steady Growth
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-green-700 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800">
          2.0–2.4x Crushing It
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 border border-orange-200 px-2 py-0.5 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800">
          🔥 2.5x+ Viral Velocity
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Home() {
  const [activeNav, setActiveNav] = useState<NavItem>("tracked");

  // Search view state
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [trackState, setTrackState] = useState<
    "idle" | "tracking" | "tracked"
  >("idle");

  // Tracked channels state
  const [trackedChannels, setTrackedChannels] = useState<TrackedChannel[]>([]);
  const [loadingTracked, setLoadingTracked] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Selected tracked channel state
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null
  );
  const [selectedData, setSelectedData] = useState<ApiResult | null>(null);
  const [loadingSelected, setLoadingSelected] = useState(false);

  useEffect(() => {
    getTrackedChannels()
      .then((channels) => {
        setTrackedChannels(channels);
        // Auto-select the first channel
        if (channels.length > 0) {
          setSelectedChannelId(channels[0].channelId);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingTracked(false));
  }, []);

  // Fetch video data when a tracked channel is selected
  const fetchChannelData = useCallback(
    async (channelId: string) => {
      setLoadingSelected(true);
      setSelectedData(null);
      try {
        const res = await fetch("/api/youtube", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelInput: channelId }),
        });
        const data = await res.json();
        if (!res.ok) return;

        // Enrich with Firestore snapshots
        let enrichedVideos: VideoItem[] = data.videos;
        try {
          const snapshots: Map<string, VideoSnapshot> =
            await getLatestSnapshotsForChannel(data.channelId);
          if (snapshots.size > 0) {
            enrichedVideos = data.videos.map((v: VideoItem) => {
              const snap = snapshots.get(v.videoId);
              if (!snap) return v;
              return {
                ...v,
                vph: snap.vph,
                momentumScore: snap.momentumScore,
                momentumLabel: getMomentumLabel(snap.momentumScore),
              };
            });
          }
        } catch {
          // Non-fatal
        }

        setSelectedData({ ...data, videos: enrichedVideos });
      } catch {
        // Silently fail — user can re-click
      } finally {
        setLoadingSelected(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedChannelId) {
      fetchChannelData(selectedChannelId);
    }
  }, [selectedChannelId, fetchChannelData]);

  // -- Handlers --

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setTrackState("idle");

    try {
      const res = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelInput: input.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      // Enrich with Firestore snapshots if available
      let enrichedVideos: VideoItem[] = data.videos;
      try {
        const snapshots: Map<string, VideoSnapshot> =
          await getLatestSnapshotsForChannel(data.channelId);
        if (snapshots.size > 0) {
          enrichedVideos = data.videos.map((v: VideoItem) => {
            const snap = snapshots.get(v.videoId);
            if (!snap) return v;
            return {
              ...v,
              vph: snap.vph,
              momentumScore: snap.momentumScore,
              momentumLabel: getMomentumLabel(snap.momentumScore),
            };
          });
        }
      } catch {
        // Non-fatal
      }

      setResult({ ...data, videos: enrichedVideos });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTrack() {
    if (!result || trackState !== "idle") return;
    setTrackState("tracking");
    try {
      const snapshotMap = await trackChannelWithData(
        result.channelId,
        result.channelTitle,
        result.channelThumbnail,
        result.uploadsPlaylistId,
        result.subscriberCount,
        result.totalViews,
        result.videos.map((v) => ({
          videoId: v.videoId,
          publishedAt: v.publishedAt,
          viewCount: v.viewCount,
          likeCount: v.likeCount,
          commentCount: v.commentCount,
        }))
      );

      const enrichedVideos = result.videos.map((v) => {
        const snap = snapshotMap.get(v.videoId);
        if (!snap) return v;
        return {
          ...v,
          vph: snap.vph,
          momentumScore: snap.momentumScore,
          momentumLabel: getMomentumLabel(snap.momentumScore),
        };
      });
      setResult({ ...result, videos: enrichedVideos });

      setTrackState("tracked");
      const updated = await getTrackedChannels();
      setTrackedChannels(updated);
      // Auto-select the newly tracked channel
      setSelectedChannelId(result.channelId);
    } catch (err) {
      console.error("Failed to track channel:", err);
      setTrackState("idle");
    }
  }

  async function handleRemove(channelId: string) {
    setRemovingId(channelId);
    try {
      await removeTrackedChannel(channelId);
      const updated = trackedChannels.filter(
        (c) => c.channelId !== channelId
      );
      setTrackedChannels(updated);

      // If we removed the selected channel, select the next one
      if (selectedChannelId === channelId) {
        if (updated.length > 0) {
          setSelectedChannelId(updated[0].channelId);
        } else {
          setSelectedChannelId(null);
          setSelectedData(null);
        }
      }
    } catch (err) {
      console.error("Failed to remove channel:", err);
    } finally {
      setRemovingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Sidebar nav items
  // ---------------------------------------------------------------------------

  const navItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
    {
      id: "tracked",
      label: "Tracked Channels",
      icon: <Radio className="h-4 w-4" />,
    },
    {
      id: "search",
      label: "Analyse",
      icon: <Search className="h-4 w-4" />,
    },
  ];

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  const SearchView = (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          Analyse a Channel
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter a YouTube channel URL, handle, or ID to fetch recent videos.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="@MrBeast  or  https://youtube.com/@MrBeast  or  UC..."
              disabled={loading}
              className="flex-1"
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {loading ? "Fetching…" : "Fetch"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              {result.channelThumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.channelThumbnail}
                  alt={result.channelTitle}
                  className="h-8 w-8 rounded-full"
                />
              )}
              {result.channelTitle}
              <span className="text-sm font-normal text-muted-foreground">
                {result.videos.length} videos in last 30 days
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={handleTrack}
                disabled={trackState !== "idle"}
              >
                {trackState === "tracking" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : trackState === "tracked" ? (
                  <Check className="mr-1.5 h-3.5 w-3.5 text-green-500" />
                ) : (
                  <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
                )}
                {trackState === "tracking"
                  ? "Tracking…"
                  : trackState === "tracked"
                  ? "Tracked"
                  : "Track Channel"}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <VideoTable videos={result.videos} />
          </CardContent>
        </Card>
      )}
    </div>
  );

  const TrackedView = (
    <div className="flex gap-6 h-full">
      {/* Center — stats panel */}
      <div className="flex-1 min-w-0">
        {loadingTracked ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : trackedChannels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Radio className="h-10 w-10 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium">No channels tracked yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Go to <strong>Analyse</strong>, search for a channel, and click{" "}
              <strong>Track Channel</strong> to start monitoring.
            </p>
          </div>
        ) : !selectedChannelId ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-muted-foreground">
              Select a channel from the list to view stats.
            </p>
          </div>
        ) : loadingSelected ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : selectedData ? (
          <div className="space-y-6">
            {/* Channel header with stats */}
            <div className="flex items-center gap-4">
              {selectedData.channelThumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedData.channelThumbnail}
                  alt={selectedData.channelTitle}
                  className="h-12 w-12 rounded-full"
                />
              )}
              <div>
                <h2 className="text-xl font-semibold tracking-tight">
                  {selectedData.channelTitle}
                </h2>
                <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {formatNumber(selectedData.subscriberCount)} subscribers
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" />
                    {formatNumber(selectedData.totalViews)} total views
                  </span>
                  <span>
                    {selectedData.videos.length} videos in last 30 days
                  </span>
                </div>
              </div>
            </div>

            {/* Video stats table */}
            <Card>
              <CardContent className="p-0">
                <VideoTable videos={selectedData.videos} />
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      {/* Right sidebar — channel list */}
      {trackedChannels.length > 0 && (
        <div className="w-56 shrink-0">
          <div className="sticky top-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Channels
            </h3>
            <div className="space-y-1">
              {trackedChannels.map((ch) => (
                <div
                  key={ch.channelId}
                  className={`group flex items-center gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                    selectedChannelId === ch.channelId
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                  onClick={() => setSelectedChannelId(ch.channelId)}
                >
                  {ch.channelThumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ch.channelThumbnail}
                      alt={ch.channelTitle}
                      className="h-8 w-8 rounded-full shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {ch.channelTitle}
                    </p>
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <Radio className="h-2.5 w-2.5" /> Active
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(ch.channelId);
                    }}
                    disabled={removingId === ch.channelId}
                  >
                    {removingId === ch.channelId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r flex flex-col">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b">
          <PlaySquare className="h-6 w-6 text-red-500" />
          <span className="text-lg font-bold tracking-tight">VidSpy</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                activeNav === item.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 px-8 py-8 overflow-auto">
        <div className={activeNav === "tracked" ? "" : "mx-auto max-w-5xl"}>
          {activeNav === "search" ? SearchView : TrackedView}
        </div>
      </main>
    </div>
  );
}
