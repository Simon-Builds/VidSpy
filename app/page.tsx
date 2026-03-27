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
  ChevronUp,
  ChevronDown,
  TrendingUp,
  Clock,
  BarChart2,
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
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  trackChannelWithData,
  removeTrackedChannel,
  getTrackedChannels,
  getTrackedChannelData,
  type TrackedChannel,
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
  momentumLabel: MomentumLabel;
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
type MomentumLabel =
  | "Underperforming"
  | "Steady Growth"
  | "Crushing It"
  | "Viral Velocity"
  | null;

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

function formatTime(d: Date) {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getMomentumLabel(score: number | null): MomentumLabel {
  if (score == null) return null;
  if (score >= 2.5) return "Viral Velocity";
  if (score >= 2.0) return "Crushing It";
  if (score >= 1.0) return "Steady Growth";
  return "Underperforming";
}

// ---------------------------------------------------------------------------
// MomentumBadge — uses Shadcn Badge with tier-appropriate styling
// ---------------------------------------------------------------------------

function MomentumBadge({
  label,
  score,
}: {
  label: MomentumLabel;
  score: number | null;
}) {
  if (!label) return <span className="text-muted-foreground text-sm">—</span>;

  const scoreText = score != null ? ` ${score.toFixed(1)}x` : "";

  if (label === "Viral Velocity") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200 animate-pulse dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800">
        ⚡ Viral Velocity<span className="opacity-60">{scoreText}</span>
      </span>
    );
  }

  if (label === "Crushing It") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 animate-pulse dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
        Crushing It<span className="opacity-60">{scoreText}</span>
      </span>
    );
  }

  if (label === "Steady Growth") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
        Steady Growth<span className="opacity-60">{scoreText}</span>
      </span>
    );
  }

  // Underperforming
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700">
      Underperforming<span className="opacity-60">{scoreText}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// VideoTable — shared table component
// ---------------------------------------------------------------------------

function VideoTable({
  videos,
  showMomentum = true,
}: {
  videos: VideoItem[];
  showMomentum?: boolean;
}) {
  const [vphSort, setVphSort] = useState<"asc" | "desc" | null>(null);

  // Compute channel avg VPH for the up-arrow indicator
  const vphValues = videos.map((v) => v.vph).filter((v): v is number => v != null);
  const avgVph =
    vphValues.length > 0
      ? vphValues.reduce((sum, v) => sum + v, 0) / vphValues.length
      : null;

  const sortedVideos = vphSort
    ? [...videos].sort((a, b) => {
        const aVal = a.vph ?? -1;
        const bVal = b.vph ?? -1;
        return vphSort === "desc" ? bVal - aVal : aVal - bVal;
      })
    : videos;

  const cycleSort = () =>
    setVphSort((prev) =>
      prev === null ? "desc" : prev === "desc" ? "asc" : null
    );

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b bg-muted/30 hover:bg-muted/30">
          <TableHead className="pl-6 font-semibold text-foreground">
            Video
          </TableHead>
          <TableHead className="w-28 text-right font-semibold text-foreground">
            Views
          </TableHead>
          <TableHead className="w-24 text-right font-semibold text-foreground">
            Likes
          </TableHead>
          <TableHead className="w-28 text-right font-semibold text-foreground">
            Comments
          </TableHead>
          {showMomentum && (
            <>
              <TableHead
                className="w-36 text-right font-semibold text-foreground cursor-pointer select-none hover:text-primary transition-colors"
                title="Views gained per hour (delta between snapshots) — click to sort"
                onClick={cycleSort}
              >
                <span className="inline-flex items-center justify-end gap-1">
                  VPH
                  {vphSort === "desc" ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : vphSort === "asc" ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <span className="flex flex-col opacity-30">
                      <ChevronUp className="h-2.5 w-2.5 -mb-1" />
                      <ChevronDown className="h-2.5 w-2.5" />
                    </span>
                  )}
                </span>
              </TableHead>
              <TableHead
                className="w-44 text-right font-semibold text-foreground"
                title="Relative to channel's 30-day avg VPH"
              >
                Momentum
              </TableHead>
            </>
          )}
          <TableHead className="w-36 pr-6 text-right font-semibold text-foreground">
            Published
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedVideos.map((video) => {
          const isAboveAvg =
            avgVph != null && video.vph != null && video.vph > avgVph;

          return (
            <TableRow
              key={video.videoId}
              className="hover:bg-muted/50 transition-colors"
            >
              <TableCell className="pl-6 py-3">
                <div className="flex items-center gap-3">
                  {video.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.thumbnail}
                      alt=""
                      className="h-10 w-[72px] rounded object-cover shrink-0 hidden sm:block"
                    />
                  )}
                  <a
                    href={`https://www.youtube.com/watch?v=${video.videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium hover:text-primary hover:underline line-clamp-2 leading-snug"
                  >
                    {video.title}
                  </a>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <span className="font-semibold tabular-nums">
                  {formatNumber(video.viewCount)}
                </span>
              </TableCell>
              <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                {formatNumber(video.likeCount)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                {formatNumber(video.commentCount)}
              </TableCell>
              {showMomentum && (
                <>
                  <TableCell className="text-right">
                    {video.vph != null ? (
                      <span className="inline-flex items-center justify-end gap-1">
                        <span className="font-bold tabular-nums">
                          {formatNumber(Math.round(video.vph))}/hr
                        </span>
                        {isAboveAvg && (
                          <TrendingUp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right pr-2">
                    <MomentumBadge
                      label={video.momentumLabel}
                      score={video.momentumScore}
                    />
                  </TableCell>
                </>
              )}
              <TableCell className="pr-6 text-right text-muted-foreground text-sm">
                {formatDate(video.publishedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// StatPill — small stat chip used in channel header
// ---------------------------------------------------------------------------

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground leading-none mb-0.5">{label}</p>
        <p className="text-sm font-semibold leading-none">{value}</p>
      </div>
    </div>
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
  const [trackState, setTrackState] = useState<"idle" | "tracking" | "tracked">(
    "idle"
  );

  // Tracked channels state
  const [trackedChannels, setTrackedChannels] = useState<TrackedChannel[]>([]);
  const [loadingTracked, setLoadingTracked] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Selected tracked channel state
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedData, setSelectedData] = useState<ApiResult | null>(null);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  useEffect(() => {
    getTrackedChannels()
      .then((channels) => {
        setTrackedChannels(channels);
        if (channels.length > 0) {
          setSelectedChannelId(channels[0].channelId);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingTracked(false));
  }, []);

  const fetchChannelData = useCallback(async (channelId: string) => {
    setLoadingSelected(true);
    setSelectedData(null);
    try {
      const cached = await getTrackedChannelData(channelId);
      if (!cached) return;

      const videos: VideoItem[] = cached.videos.map((v) => ({
        ...v,
        momentumLabel: getMomentumLabel(v.momentumScore),
      }));

      setSelectedData({
        channelId: cached.channelId,
        channelTitle: cached.channelTitle,
        channelThumbnail: cached.channelThumbnail,
        uploadsPlaylistId: "",
        subscriberCount: cached.subscriberCount,
        totalViews: cached.totalViews,
        videos,
      });
      setLastSynced(new Date());
    } catch {
      // Silently fail — user can re-click
    } finally {
      setLoadingSelected(false);
    }
  }, []);

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

      setResult(data);
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
          title: v.title,
          thumbnail: v.thumbnail,
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
      const updated = trackedChannels.filter((c) => c.channelId !== channelId);
      setTrackedChannels(updated);

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
  // Nav items
  // ---------------------------------------------------------------------------

  const navItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
    {
      id: "tracked",
      label: "Tracked Channels",
      icon: <Radio className="h-4 w-4" />,
    },
    {
      id: "search",
      label: "Search",
      icon: <Search className="h-4 w-4" />,
    },
  ];

  // ---------------------------------------------------------------------------
  // Search View
  // ---------------------------------------------------------------------------

  const SearchView = (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Search a Channel</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter a YouTube channel URL, handle, or ID to fetch recent videos.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="@MrBeast  ·  youtube.com/@MrBeast  ·  UC..."
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
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {result && (
        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="flex items-center gap-3">
              <Avatar className="h-10 w-10 border">
                <AvatarImage
                  src={result.channelThumbnail}
                  alt={result.channelTitle}
                />
                <AvatarFallback>{result.channelTitle[0]}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold leading-tight truncate">
                  {result.channelTitle}
                </p>
                <p className="text-xs font-normal text-muted-foreground">
                  {result.videos.length} videos in last 30 days
                </p>
              </div>
              {(() => {
                const alreadyTracked = trackedChannels.some(
                  (ch) => ch.channelId === result.channelId
                );
                return alreadyTracked ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="opacity-50 cursor-not-allowed shrink-0"
                    disabled
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Tracked
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
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
                );
              })()}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <VideoTable videos={result.videos} showMomentum={false} />
          </CardContent>
        </Card>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Tracked View
  // ---------------------------------------------------------------------------

  const TrackedView = (
    <div className="flex gap-6 h-full min-h-0">
      {/* Center — stats panel */}
      <div className="flex-1 min-w-0">
        {loadingTracked ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : trackedChannels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Radio className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h3 className="text-lg font-semibold">No channels tracked yet</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              Go to <strong>Search</strong>, find a channel, and click{" "}
              <strong>Track Channel</strong> to start monitoring.
            </p>
          </div>
        ) : !selectedChannelId ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm text-muted-foreground">
              Select a channel to view stats.
            </p>
          </div>
        ) : loadingSelected ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : selectedData ? (
          <div className="space-y-5">
            {/* Channel header card */}
            <Card className="shadow-sm overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-5 border-b bg-muted/20">
                <Avatar className="h-14 w-14 border-2 border-border shadow">
                  <AvatarImage
                    src={selectedData.channelThumbnail}
                    alt={selectedData.channelTitle}
                  />
                  <AvatarFallback className="text-lg font-bold">
                    {selectedData.channelTitle[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight truncate">
                    {selectedData.channelTitle}
                  </h2>
                  {lastSynced && (
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Last synced at {formatTime(lastSynced)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 p-5">
                <StatPill
                  icon={<Users className="h-4 w-4" />}
                  label="Subscribers"
                  value={formatNumber(selectedData.subscriberCount)}
                />
                <StatPill
                  icon={<Eye className="h-4 w-4" />}
                  label="Total Views"
                  value={formatNumber(selectedData.totalViews)}
                />
                <StatPill
                  icon={<BarChart2 className="h-4 w-4" />}
                  label="Videos (30 days)"
                  value={String(selectedData.videos.length)}
                />
                <StatPill
                  icon={<TrendingUp className="h-4 w-4" />}
                  label="Avg VPH"
                  value={(() => {
                    const vals = selectedData.videos
                      .map((v) => v.vph)
                      .filter((v): v is number => v != null);
                    if (!vals.length) return "—";
                    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
                    return `${formatNumber(Math.round(avg))}/hr`;
                  })()}
                />
              </div>
            </Card>

            {/* Video stats table */}
            <Card className="shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <VideoTable videos={selectedData.videos} />
              </CardContent>
            </Card>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground px-1">
              <span className="font-medium text-foreground">Momentum</span>
              <span>= VPH relative to channel&apos;s 30-day avg.</span>
              <Badge variant="outline" className="bg-zinc-100 text-zinc-500 border-zinc-200 font-normal">
                Underperforming
              </Badge>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 font-normal">
                1.0–1.9x Steady Growth
              </Badge>
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 font-normal">
                2.0–2.4x Crushing It
              </Badge>
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 font-normal">
                ⚡ 2.5x+ Viral Velocity
              </Badge>
            </div>
          </div>
        ) : null}
      </div>

      {/* Right panel — tracked channel list */}
      {trackedChannels.length > 0 && (
        <div className="w-60 shrink-0">
          <div className="sticky top-0">
            <div className="rounded-xl border bg-slate-50 dark:bg-zinc-900 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b bg-white/50 dark:bg-zinc-800/50">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tracking {trackedChannels.length} Channel{trackedChannels.length !== 1 ? "s" : ""}
                </h3>
              </div>
              <div className="p-2 space-y-0.5">
                {trackedChannels.map((ch) => (
                  <div
                    key={ch.channelId}
                    className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer transition-all ${
                      selectedChannelId === ch.channelId
                        ? "bg-white dark:bg-zinc-800 shadow-sm border border-border"
                        : "hover:bg-white/70 dark:hover:bg-zinc-800/70"
                    }`}
                    onClick={() => setSelectedChannelId(ch.channelId)}
                  >
                    <Avatar className="h-8 w-8 shrink-0 border">
                      <AvatarImage src={ch.channelThumbnail} alt={ch.channelTitle} />
                      <AvatarFallback className="text-xs">
                        {ch.channelTitle[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate leading-tight">
                        {ch.channelTitle}
                      </p>
                      <span className="flex items-center gap-1 text-xs text-emerald-600">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Live
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(ch.channelId);
                      }}
                      disabled={removingId === ch.channelId}
                    >
                      {removingId === ch.channelId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
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
      {/* Left Sidebar */}
      <aside className="w-56 shrink-0 border-r bg-slate-50 dark:bg-zinc-900 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500 shadow">
            <PlaySquare className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">VidSpy</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                activeNav === item.id
                  ? "bg-white dark:bg-zinc-800 shadow-sm border border-border text-foreground"
                  : "text-muted-foreground hover:bg-white/70 dark:hover:bg-zinc-800/70 hover:text-foreground"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t">
          <p className="text-xs text-muted-foreground">
            Polls every hour · 30-day window
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 px-8 py-8 overflow-auto">
        {activeNav === "search" ? SearchView : TrackedView}
      </main>
    </div>
  );
}
