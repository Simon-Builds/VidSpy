"use client";

import { useState, useEffect, useCallback } from "react";
import {
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
  Zap,
  MoreHorizontal,
  Activity,
  Swords,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  trackChannelWithData,
  removeTrackedChannel,
  getTrackedChannels,
  getTrackedChannelData,
  getVideoVphHistory,
  type TrackedChannel,
  type VideoVphChartData,
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
  engagementRate: number | null;
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

type NavItem = "search" | "tracked" | "competitor";

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
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// StatCard — matches the reference image metric card style
// ---------------------------------------------------------------------------

function StatCard({
  label,
  icon,
  value,
  description,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  description: string;
}) {
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <span className="text-muted-foreground/50 shrink-0">{icon}</span>
      </div>
      <p className="text-3xl font-bold text-foreground tracking-tight leading-none">
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MultiLineVphChart — per-video VPH trend lines (replaces single area chart)
// ---------------------------------------------------------------------------

const LINE_COLORS = [
  "#a78bfa", "#60a5fa", "#34d399", "#fb923c", "#f472b6",
  "#c084fc", "#38bdf8", "#4ade80", "#fbbf24", "#f87171",
];

function VelocityChartSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold text-foreground">Video Velocity</p>
        <p className="text-xs text-muted-foreground mt-0.5">VPH per video — top 10 most active</p>
      </div>
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-xs text-muted-foreground/50">
          Collecting data — check back after the next hourly poll
        </p>
      </div>
    </div>
  );
}

function MultiLineVphChart({ data }: { data: VideoVphChartData }) {
  const { series, timestamps } = data;

  // Pivot: one row per timestamp, videoId keys hold VPH values
  const chartData = timestamps.map((time) => {
    const row: Record<string, string | number> = { time };
    for (const s of series) {
      const point = s.data.find((p) => p.time === time);
      if (point) row[s.videoId] = point.vph;
    }
    return row;
  });

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Video Velocity</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            VPH per video — top {series.length} most active · last 24h
          </p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#6b7280" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#6b7280" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatNumber(v)}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card)",
              borderColor: "var(--border)",
              borderRadius: "var(--radius)",
              fontSize: "11px",
              color: "var(--foreground)",
            }}
            formatter={(v: unknown, key: string | number | undefined) => {
              const keyStr = String(key ?? "");
              const video = series.find((s) => s.videoId === keyStr);
              const title = video?.title ?? keyStr;
              const label = title.length > 45 ? title.slice(0, 45) + "…" : title;
              return [`${formatNumber(typeof v === "number" ? v : null)}/hr`, label];
            }}
          />
          <Legend
            iconType="line"
            wrapperStyle={{ fontSize: "10px", color: "#6b7280", paddingTop: "12px" }}
            formatter={(value: string) => {
              const video = series.find((s) => s.videoId === value);
              const title = video?.title ?? value;
              return title.length > 35 ? title.slice(0, 35) + "…" : title;
            }}
          />
          {series.map((s, i) => (
            <Line
              key={s.videoId}
              type="monotone"
              dataKey={s.videoId}
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VideoTable
// ---------------------------------------------------------------------------

type SortKey = "viewCount" | "likeCount" | "commentCount" | "vph" | "engagementRate" | "publishedAt";

function VideoTable({ videos, showVph = true }: { videos: VideoItem[]; showVph?: boolean }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  const vphValues = videos.map((v) => v.vph).filter((v): v is number => v != null);
  const avgVph = vphValues.length > 0
    ? vphValues.reduce((s, v) => s + v, 0) / vphValues.length
    : null;

  const erValues = videos.map((v) => v.engagementRate).filter((v): v is number => v != null);
  const avgEr = erValues.length > 0
    ? erValues.reduce((s, v) => s + v, 0) / erValues.length
    : null;

  const cycleSort = (key: SortKey) =>
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "desc" };
      if (prev.dir === "desc") return { key, dir: "asc" };
      return null;
    });

  const sorted = sort
    ? [...videos].sort((a, b) => {
        const av =
          sort.key === "publishedAt"
            ? new Date(a.publishedAt).getTime()
            : (a[sort.key] as number | null) ?? -1;
        const bv =
          sort.key === "publishedAt"
            ? new Date(b.publishedAt).getTime()
            : (b[sort.key] as number | null) ?? -1;
        return sort.dir === "desc" ? bv - av : av - bv;
      })
    : videos;

  const SortIndicator = ({ col }: { col: SortKey }) =>
    sort?.key === col ? (
      sort.dir === "desc" ? (
        <ChevronDown className="h-3.5 w-3.5" />
      ) : (
        <ChevronUp className="h-3.5 w-3.5" />
      )
    ) : (
      <span className="flex flex-col opacity-30">
        <ChevronUp className="h-2.5 w-2.5 -mb-0.5" />
        <ChevronDown className="h-2.5 w-2.5" />
      </span>
    );

  const sortableHead = (col: SortKey, label: string, className: string) => (
    <TableHead
      className={`${className} cursor-pointer select-none hover:text-foreground transition-colors ${sort?.key === col ? "text-foreground" : ""}`}
      onClick={() => cycleSort(col)}
    >
      <span className="inline-flex items-center justify-end gap-1">
        {label}
        <SortIndicator col={col} />
      </span>
    </TableHead>
  );

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b border-border hover:bg-transparent">
          <TableHead className="pl-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Video
          </TableHead>
          {sortableHead("viewCount",     "Views",    "w-28 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider")}
          {sortableHead("likeCount",     "Likes",    "w-24 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider")}
          {sortableHead("commentCount",  "Comments", "w-28 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider")}
          {showVph && sortableHead("vph",            "VPH",        "w-36 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider")}
          {showVph && sortableHead("engagementRate", "Engagement", "w-32 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider")}
          {sortableHead("publishedAt",   "Published", "w-36 pr-6 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider")}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((video) => {
          const isAboveAvg = avgVph != null && video.vph != null && video.vph > avgVph;
          return (
            <TableRow
              key={video.videoId}
              className="border-b border-border/50 hover:bg-white/[0.03] transition-colors"
            >
              <TableCell className="pl-6 py-4">
                <div className="flex items-center gap-4">
                  {video.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.thumbnail}
                      alt=""
                      className="h-10 w-[72px] rounded-md object-cover shrink-0 hidden sm:block opacity-90"
                    />
                  )}
                  <a
                    href={`https://www.youtube.com/watch?v=${video.videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-foreground hover:text-primary transition-colors line-clamp-2 leading-snug"
                  >
                    {video.title}
                  </a>
                </div>
              </TableCell>
              <TableCell className="text-right py-4">
                <span className="text-base font-bold text-foreground tabular-nums">
                  {formatNumber(video.viewCount)}
                </span>
              </TableCell>
              <TableCell className="text-right py-4 text-sm text-muted-foreground tabular-nums">
                {formatNumber(video.likeCount)}
              </TableCell>
              <TableCell className="text-right py-4 text-sm text-muted-foreground tabular-nums">
                {formatNumber(video.commentCount)}
              </TableCell>
              {showVph && (
                <TableCell className="text-right py-4">
                  {video.vph != null ? (
                    <span
                      className={`text-base font-bold tabular-nums ${
                        isAboveAvg ? "text-emerald-400" : "text-foreground"
                      }`}
                    >
                      {formatNumber(Math.round(video.vph))}/hr
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
              )}
              {showVph && (
                <TableCell className="text-right py-4">
                  {video.engagementRate != null ? (
                    <div className="flex flex-col items-end gap-0.5">
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          avgEr != null && video.engagementRate > avgEr
                            ? "text-sky-400"
                            : "text-foreground"
                        }`}
                      >
                        {video.engagementRate.toFixed(2)}%
                      </span>
                      {avgEr != null && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          Avg: {avgEr.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
              )}
              <TableCell className="pr-6 text-right py-4 text-sm text-muted-foreground">
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
// Main component
// ---------------------------------------------------------------------------

export default function Home() {
  const [activeNav, setActiveNav] = useState<NavItem>("tracked");

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [trackState, setTrackState] = useState<"idle" | "tracking" | "tracked">("idle");

  const [trackedChannels, setTrackedChannels] = useState<TrackedChannel[]>([]);
  const [loadingTracked, setLoadingTracked] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedData, setSelectedData] = useState<ApiResult | null>(null);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [videoVphHistory, setVideoVphHistory] = useState<VideoVphChartData | null>(null);

  useEffect(() => {
    getTrackedChannels()
      .then((channels) => {
        setTrackedChannels(channels);
        if (channels.length > 0) setSelectedChannelId(channels[0].channelId);
      })
      .catch(console.error)
      .finally(() => setLoadingTracked(false));
  }, []);

  const fetchChannelData = useCallback(async (channelId: string) => {
    setLoadingSelected(true);
    setSelectedData(null);
    setVideoVphHistory(null);
    try {
      const [cached, vphData] = await Promise.all([
        getTrackedChannelData(channelId),
        getVideoVphHistory(channelId),
      ]);
      if (!cached) return;
      const videos: VideoItem[] = cached.videos;
      setSelectedData({
        channelId: cached.channelId,
        channelTitle: cached.channelTitle,
        channelThumbnail: cached.channelThumbnail,
        uploadsPlaylistId: "",
        subscriberCount: cached.subscriberCount,
        totalViews: cached.totalViews,
        videos,
      });
      setVideoVphHistory(vphData);
      setLastSynced(new Date());
    } catch {
      /* silent */
    } finally {
      setLoadingSelected(false);
    }
  }, []);

  useEffect(() => {
    if (selectedChannelId) fetchChannelData(selectedChannelId);
  }, [selectedChannelId, fetchChannelData]);

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
      if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
      setResult({
        ...data,
        videos: (data.videos ?? []).map((v: Omit<VideoItem, "engagementRate">) => ({
          ...v,
          engagementRate:
            v.viewCount != null && v.viewCount > 0
              ? Math.round(
                  (((v.likeCount ?? 0) + (v.commentCount ?? 0)) / v.viewCount) * 10000
                ) / 100
              : null,
        })),
      });
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
      const enriched = result.videos.map((v) => {
        const snap = snapshotMap.get(v.videoId);
        if (!snap) return v;
        return { ...v, vph: snap.vph, engagementRate: snap.engagementRate };
      });
      setResult({ ...result, videos: enriched });
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
        if (updated.length > 0) { setSelectedChannelId(updated[0].channelId); }
        else { setSelectedChannelId(null); setSelectedData(null); }
      }
    } catch (err) {
      console.error("Failed to remove channel:", err);
    } finally {
      setRemovingId(null);
    }
  }

  const navItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
    { id: "tracked",    label: "Tracked Channels",    icon: <Radio className="h-4 w-4" /> },
    { id: "search",     label: "Search",              icon: <Search className="h-4 w-4" /> },
    { id: "competitor", label: "Competitor Analysis", icon: <Swords className="h-4 w-4" /> },
  ];

  // ---------------------------------------------------------------------------
  // Search View
  // ---------------------------------------------------------------------------

  const SUGGESTED_CHANNELS = ["@MKBHD", "@veritasium", "@LexFridman", "@Fireship"];

  async function handleChipSearch(handle: string) {
    setInput(handle);
    setLoading(true);
    setError(null);
    setResult(null);
    setTrackState("idle");
    try {
      const res = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelInput: handle }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
      setResult({
        ...data,
        videos: (data.videos ?? []).map((v: Omit<VideoItem, "engagementRate">) => ({
          ...v,
          engagementRate:
            v.viewCount != null && v.viewCount > 0
              ? Math.round((((v.likeCount ?? 0) + (v.commentCount ?? 0)) / v.viewCount) * 10000) / 100
              : null,
        })),
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const searchForm = (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter a YouTube channel URL, handle, or ID…"
        disabled={loading}
        className="flex-1 bg-background border-border text-foreground placeholder:text-muted-foreground"
      />
      <Button type="submit" disabled={loading || !input.trim()}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        {loading ? "Fetching…" : "Fetch"}
      </Button>
    </form>
  );

  const SearchView = !result && !loading ? (
    /* ── Discovery / empty state ── */
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] max-w-2xl mx-auto text-center gap-8">

      {/* Hero icon */}
      <div className="rounded-2xl bg-primary/10 p-6 ring-1 ring-primary/20">
        <Activity className="w-20 h-20 text-primary/40" />
      </div>

      {/* Heading */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Discover a Channel</h2>
        <p className="text-sm text-muted-foreground">
          Enter a YouTube channel URL, handle, or ID to analyse recent performance.
        </p>
      </div>

      {/* Search bar */}
      <div className="w-full rounded-lg border border-border bg-card p-4">
        {searchForm}
      </div>

      {/* Suggested chips */}
      <div className="flex flex-wrap justify-center gap-2">
        <span className="text-xs text-muted-foreground/60 w-full mb-1">Try a channel →</span>
        {SUGGESTED_CHANNELS.map((handle) => (
          <button
            key={handle}
            onClick={() => handleChipSearch(handle)}
            disabled={loading}
            className="px-3 py-1.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground hover:bg-primary/20 hover:text-primary border border-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {handle}
          </button>
        ))}
      </div>

      {error && (
        <p className="w-full rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Feature cards */}
      <div className="grid grid-cols-3 gap-3 w-full mt-2">
        {[
          {
            icon: <Zap className="h-4 w-4 text-primary" />,
            title: "Real-time Velocity",
            desc: "Views Per Hour computed from live deltas — not lifetime averages.",
          },
          {
            icon: <BarChart2 className="h-4 w-4 text-primary" />,
            title: "Engagement Ratios",
            desc: "Likes + comments over views, surfaced per video and averaged across the channel.",
          },
          {
            icon: <TrendingUp className="h-4 w-4 text-primary" />,
            title: "Smart Polling",
            desc: "3-phase engine boosts viral videos to hourly tracking automatically.",
          },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="rounded-lg border border-border bg-card p-4 text-left space-y-2">
            <div className="flex items-center gap-2">
              {icon}
              <p className="text-xs font-semibold text-foreground">{title}</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  ) : (
    /* ── Results / loading state ── */
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="rounded-lg border border-border bg-card p-4">
        {searchForm}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
            <Avatar className="h-10 w-10 border border-border">
              <AvatarImage src={result.channelThumbnail} alt={result.channelTitle} />
              <AvatarFallback className="bg-muted text-muted-foreground">
                {result.channelTitle[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-foreground truncate">{result.channelTitle}</p>
              <p className="text-xs text-muted-foreground">{result.videos.length} videos in last 30 days</p>
            </div>
            {(() => {
              const alreadyTracked = trackedChannels.some((ch) => ch.channelId === result.channelId);
              return alreadyTracked ? (
                <Button variant="outline" size="sm" className="opacity-40 cursor-not-allowed shrink-0" disabled>
                  <Check className="mr-1.5 h-3.5 w-3.5" /> Tracked
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="shrink-0" onClick={handleTrack} disabled={trackState !== "idle"}>
                  {trackState === "tracking" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : trackState === "tracked" ? (
                    <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {trackState === "tracking" ? "Tracking…" : trackState === "tracked" ? "Tracked" : "Track Channel"}
                </Button>
              );
            })()}
          </div>
          <VideoTable videos={result.videos} showVph={false} />
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Tracked View
  // ---------------------------------------------------------------------------

  const TrackedView = (
    <div className="flex gap-5 h-full min-h-0">
      {/* Center panel */}
      <div className="flex-1 min-w-0">
        {loadingTracked ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : trackedChannels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="rounded-full bg-muted/50 border border-border p-4 mb-4">
              <Radio className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">No channels tracked yet</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              Go to <strong className="text-foreground">Search</strong>, find a channel, and click{" "}
              <strong className="text-foreground">Track Channel</strong> to start monitoring.
            </p>
          </div>
        ) : !selectedChannelId ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm text-muted-foreground">Select a channel to view stats.</p>
          </div>
        ) : loadingSelected ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : selectedData ? (
          <div className="space-y-4">
            {/* Channel identity row */}
            <div className="flex items-center gap-3 mb-1">
              <Avatar className="h-11 w-11 border-2 border-border">
                <AvatarImage src={selectedData.channelThumbnail} alt={selectedData.channelTitle} />
                <AvatarFallback className="bg-muted text-muted-foreground font-bold">
                  {selectedData.channelTitle[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold tracking-tight text-foreground truncate">
                  {selectedData.channelTitle}
                </h2>
                {lastSynced && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="h-3 w-3" />
                    Last synced at {formatTime(lastSynced)}
                  </p>
                )}
              </div>
            </div>

            {/* Stat cards — reference image style */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <StatCard
                label="Subscribers"
                icon={<Users className="h-4 w-4" />}
                value={formatNumber(selectedData.subscriberCount)}
                description="channel audience"
              />
              <StatCard
                label="Avg Views / Video"
                icon={<Eye className="h-4 w-4" />}
                value={(() => {
                  const withViews = selectedData.videos.filter(
                    (v) => v.viewCount != null
                  );
                  if (!withViews.length) return "—";
                  const avg =
                    withViews.reduce((s, v) => s + (v.viewCount ?? 0), 0) /
                    withViews.length;
                  return formatNumber(Math.round(avg));
                })()}
                description="per video (last 30 days)"
              />
              <StatCard
                label="Videos / 30 days"
                icon={<BarChart2 className="h-4 w-4" />}
                value={String(selectedData.videos.length)}
                description="recent uploads"
              />
              <StatCard
                label="Avg VPH"
                icon={<Zap className="h-4 w-4" />}
                value={(() => {
                  const vals = selectedData.videos
                    .map((v) => v.vph)
                    .filter((v): v is number => v != null);
                  if (!vals.length) return "—";
                  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
                  return `${formatNumber(Math.round(avg))}/hr`;
                })()}
                description="channel speed"
              />
            </div>

            {/* Per-video VPH comparison chart */}
            {videoVphHistory && videoVphHistory.series.length > 0 ? (
              <MultiLineVphChart data={videoVphHistory} />
            ) : (
              <VelocityChartSkeleton />
            )}

            {/* Video table */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <VideoTable videos={selectedData.videos} />
            </div>

            {/* VPH legend */}
            <p className="text-xs text-muted-foreground/60 px-1">
              <span className="text-emerald-400 font-medium">Green</span> VPH = above this channel&apos;s current average
            </p>
          </div>
        ) : null}
      </div>

      {/* Right channel list */}
      {trackedChannels.length > 0 && (
        <div className="w-60 shrink-0">
          <div className="sticky top-0 rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tracking {trackedChannels.length} Channel{trackedChannels.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="p-2 space-y-0.5">
              {trackedChannels.map((ch) => (
                <div
                  key={ch.channelId}
                  className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2.5 cursor-pointer transition-colors ${
                    selectedChannelId === ch.channelId
                      ? "bg-white/[0.07] border border-border"
                      : "hover:bg-white/[0.04] border border-transparent"
                  }`}
                  onClick={() => setSelectedChannelId(ch.channelId)}
                >
                  <Avatar className="h-8 w-8 shrink-0 border border-border">
                    <AvatarImage src={ch.channelThumbnail} alt={ch.channelTitle} />
                    <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                      {ch.channelTitle[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate leading-tight">
                      {ch.channelTitle}
                    </p>
                    <span className="flex items-center gap-1 text-xs text-emerald-500">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Live
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); handleRemove(ch.channelId); }}
                    disabled={removingId === ch.channelId}
                  >
                    {removingId === ch.channelId
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Trash2 className="h-3 w-3" />}
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
  // Competitor Analysis View
  // ---------------------------------------------------------------------------

  const CompetitorView = (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center gap-4">
      <div className="rounded-2xl bg-primary/10 p-5 ring-1 ring-primary/20">
        <Swords className="w-10 h-10 text-primary/60" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight text-foreground">Competitor Analysis</h2>
      <p className="text-sm text-muted-foreground">Coming soon.</p>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left sidebar */}
      <aside className="w-56 shrink-0 border-r border-border bg-card flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5 border-b border-border">
          <div className="rounded-md bg-primary/10 p-1.5 ring-1 ring-primary/20 shrink-0">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <span className="font-mono tracking-tighter drop-shadow-[0_0_10px_rgba(155,110,255,0.2)]">
            <span className="text-sm font-bold text-foreground">VID</span>
            <span className="text-sm font-normal text-primary">SPY</span>
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all ${
                activeNav === item.id
                  ? "bg-white/[0.07] text-foreground border border-border"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground border border-transparent"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Bottom user-style section */}
        <div className="px-3 py-3 border-t border-border">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
            <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground leading-none">Smart Polling</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-none">Hourly · 30-day window</p>
            </div>
            <MoreHorizontal className="h-4 w-4 text-muted-foreground/50 shrink-0" />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 px-8 py-8 overflow-auto bg-background">
        {activeNav === "search" ? SearchView : activeNav === "competitor" ? CompetitorView : TrackedView}
      </main>
    </div>
  );
}
