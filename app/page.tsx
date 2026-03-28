"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Clock,
  BarChart2,
  Zap,
  MoreHorizontal,
  Activity,
  Swords,
  Download,
  Menu,
  X,
  SlidersHorizontal,
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  trackChannelWithData,
  removeTrackedChannel,
  getTrackedChannels,
  getTrackedChannelsWithMetrics,
  getTrackedChannelData,
  getVideoHistory,
  type TrackedChannel,
  type VideoHistoryPoint,
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
  durationSeconds: number | null;
  isShort: boolean;
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
  return Math.round(n).toLocaleString();
}

function getChannelValue(
  ch: TrackedChannel,
  metric: "VPH" | "VIEWS" | "VIDEOS" | "SUBS",
  type: "TOTAL" | "LONG" | "SHORTS",
): number | null {
  if (metric === "VPH") {
    if (type === "LONG")   return ch.avgVphLong   ?? null;
    if (type === "SHORTS") return ch.avgVphShort  ?? null;
    return ch.avgVphTotal ?? null;
  }
  if (metric === "VIEWS") {
    if (type === "LONG")   return ch.avgViewsLong   ?? null;
    if (type === "SHORTS") return ch.avgViewsShort  ?? null;
    return ch.avgViewsTotal ?? null;
  }
  if (metric === "SUBS") return ch.subscriberCount ?? null;
  return ch.videosLast30Days ?? null;
}

function getFormatter(metric: "VPH" | "VIEWS" | "VIDEOS" | "SUBS") {
  return (v: unknown): string => {
    const n = typeof v === "number" ? v : null;
    const base = formatNumber(n);
    if (metric === "VPH") return base === "—" ? "—" : `${base} VPH`;
    return base;
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isShort(v: { isShort: boolean }): boolean {
  return v.isShort;
}

function exportCsv(videos: VideoItem[], channelTitle: string, filterLabel: string) {
  const headers = ["Title", "Views", "Likes", "Comments", "VPH", "Engagement %", "Published", "Type"];
  const rows = videos.map((v) => [
    `"${v.title.replace(/"/g, '""')}"`,
    v.viewCount ?? "",
    v.likeCount ?? "",
    v.commentCount ?? "",
    v.vph != null ? v.vph.toFixed(1) : "",
    v.engagementRate != null ? `${v.engagementRate}%` : "",
    v.publishedAt ? new Date(v.publishedAt).toLocaleDateString("en-US") : "",
    v.isShort ? "Short" : "Video",
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${channelTitle.replace(/[^a-zA-Z0-9]/g, "_")}_${filterLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
    <div className="flex-1 min-w-0 rounded-lg border border-border bg-card p-3 md:p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <span className="text-muted-foreground/50 shrink-0">{icon}</span>
      </div>
      <p className="text-2xl md:text-3xl font-bold text-foreground tracking-tight leading-none">
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SingleVideoPulse — area chart showing VPH over time for one video
// ---------------------------------------------------------------------------

function SingleVideoPulse({
  history,
  loading,
  videoTitle,
}: {
  history: VideoHistoryPoint[];
  loading: boolean;
  videoTitle: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold text-foreground">Video Pulse</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-full sm:max-w-[480px]">
          {videoTitle ?? "Select a video below"}
        </p>
      </div>

      {loading ? (
        <div className="h-[220px] flex items-center justify-center">
          <p className="text-xs text-muted-foreground/50">Loading…</p>
        </div>
      ) : history.length === 0 ? (
        <div className="h-[220px] flex items-center justify-center">
          <p className="text-xs text-muted-foreground/50">
            Not enough data yet — check back after the next hourly poll
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={history} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="pulseGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
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
            <RechartsTooltip
              contentStyle={{
                backgroundColor: "var(--card)",
                borderColor: "var(--border)",
                borderRadius: "var(--radius)",
                fontSize: "11px",
                color: "var(--foreground)",
              }}
              formatter={(v: unknown) => [
                `${formatNumber(typeof v === "number" ? v : null)}/hr`,
                "VPH",
              ]}
            />
            <Area
              type="monotone"
              dataKey="vph"
              stroke="var(--primary)"
              strokeWidth={2}
              fill="url(#pulseGradient)"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: "var(--primary)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MiniSparkline — tiny VPH trend line for each table row
// ---------------------------------------------------------------------------

function MiniSparkline({ channelId, videoId }: { channelId: string; videoId: string }) {
  const [data, setData] = useState<VideoHistoryPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVideoHistory(channelId, videoId).then((h) => {
      if (!cancelled) setData(h);
    }).catch(() => {
      if (!cancelled) setData([]);
    });
    return () => { cancelled = true; };
  }, [channelId, videoId]);

  if (data === null) return <span className="text-muted-foreground/30 text-xs">…</span>;
  if (data.length < 2) return <span className="text-muted-foreground/30 text-xs">—</span>;

  return (
    <LineChart width={96} height={32} data={data}>
      <Line
        type="monotone"
        dataKey="vph"
        stroke="var(--primary)"
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}

function ChannelIconTick({
  x, y, payload, thumbnailMap,
}: {
  x?: number | string; y?: number | string;
  payload?: { value: string };
  thumbnailMap: Map<string, string>;
  [key: string]: unknown;
}) {
  if (!payload) return null;
  const src = thumbnailMap.get(payload.value) ?? "";
  const cx = Number(x);
  const cy = Number(y);
  const size = 28;
  const clipId = `clip-ch-${payload.value.replace(/\s+/g, "-")}`;
  return (
    <g transform={`translate(${cx},${cy})`}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={0} cy={size / 2 + 6} r={size / 2} />
        </clipPath>
      </defs>
      <image
        href={src}
        x={-size / 2}
        y={6}
        width={size}
        height={size}
        clipPath={`url(#${clipId})`}
      />
    </g>
  );
}

function CompetitorTooltip({
  active,
  payload,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; value: number; thumbnail: string } }>;
  formatter?: (v: unknown) => string;
}) {
  if (!active || !payload?.length) return null;
  const { name, value, thumbnail } = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg flex items-center gap-2.5">
      {thumbnail && (
        <img src={thumbnail} alt={name} className="h-7 w-7 rounded-full shrink-0 object-cover" />
      )}
      <div>
        <p className="text-xs font-medium text-foreground">{name}</p>
        <p className="text-sm font-semibold text-primary">
          {formatter ? formatter(value) : value.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

// VideoTable
// ---------------------------------------------------------------------------

type SortKey = "viewCount" | "likeCount" | "commentCount" | "vph" | "engagementRate" | "publishedAt";

function VideoTable({
  videos,
  showVph = true,
  selectedVideoId,
  onVideoSelect,
  channelId,
}: {
  videos: VideoItem[];
  showVph?: boolean;
  selectedVideoId?: string | null;
  onVideoSelect?: (videoId: string) => void;
  channelId?: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null);

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

  // Count visible columns for colSpan on expandable row
  const visibleCols = 2 + (channelId ? 1 : 0) + (showVph ? 2 : 0) + 3;

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b border-border hover:bg-transparent">
          <TableHead className="pl-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Video
          </TableHead>
          {channelId && (
            <TableHead className="w-28 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
              Trend
            </TableHead>
          )}
          {sortableHead("viewCount",     "Views",    "w-28 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider")}
          {sortableHead("likeCount",     "Likes",    "w-24 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell")}
          {sortableHead("commentCount",  "Comments", "w-28 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell")}
          {showVph && sortableHead("vph",            "VPH",        "w-36 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider")}
          {showVph && sortableHead("engagementRate", "Engagement", "w-32 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell")}
          {sortableHead("publishedAt",   "Published", "w-36 pr-6 text-right py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell")}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((video) => {
          const isAboveAvg = avgVph != null && video.vph != null && video.vph > avgVph;
          const isExpanded = expandedVideoId === video.videoId;
          return (
            <React.Fragment key={video.videoId}>
              <TableRow
                onClick={() => {
                  onVideoSelect?.(video.videoId);
                  setExpandedVideoId(isExpanded ? null : video.videoId);
                }}
                className={`border-b border-border/50 transition-colors ${
                  onVideoSelect ? "cursor-pointer" : ""
                } ${
                  selectedVideoId === video.videoId
                    ? "bg-primary/10 hover:bg-primary/10"
                    : "hover:bg-white/[0.03]"
                }`}
              >
                <TableCell className="pl-4 md:pl-6 py-4">
                  <div className="flex items-center gap-3 md:gap-4">
                    {/* Mobile expand indicator */}
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform lg:hidden ${isExpanded ? "rotate-90" : ""}`} />
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
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-medium text-foreground hover:text-primary transition-colors line-clamp-2 leading-snug"
                    >
                      {video.title}
                    </a>
                  </div>
                </TableCell>
                {channelId && (
                  <TableCell className="py-4 hidden md:table-cell">
                    <MiniSparkline channelId={channelId} videoId={video.videoId} />
                  </TableCell>
                )}
                <TableCell className="text-right py-4">
                  <span className="text-base font-bold text-foreground tabular-nums">
                    {formatNumber(video.viewCount)}
                  </span>
                </TableCell>
                <TableCell className="text-right py-4 text-sm text-muted-foreground tabular-nums hidden lg:table-cell">
                  {formatNumber(video.likeCount)}
                </TableCell>
                <TableCell className="text-right py-4 text-sm text-muted-foreground tabular-nums hidden lg:table-cell">
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
                  <TableCell className="text-right py-4 hidden xl:table-cell">
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
                <TableCell className="pr-6 text-right py-4 text-sm text-muted-foreground hidden lg:table-cell">
                  {formatDate(video.publishedAt)}
                </TableCell>
              </TableRow>
              {/* Expandable detail row — mobile/tablet only */}
              {isExpanded && (
                <TableRow className="lg:hidden border-b border-border/50 bg-white/[0.02]">
                  <TableCell colSpan={visibleCols} className="px-6 py-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">Likes</span>
                        <p className="font-medium text-foreground">{formatNumber(video.likeCount)}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">Comments</span>
                        <p className="font-medium text-foreground">{formatNumber(video.commentCount)}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">Engagement</span>
                        <p className="font-medium text-foreground">{video.engagementRate != null ? `${video.engagementRate.toFixed(2)}%` : "—"}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">Published</span>
                        <p className="font-medium text-foreground">{formatDate(video.publishedAt)}</p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedData, setSelectedData] = useState<ApiResult | null>(null);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [videoHistory, setVideoHistory] = useState<VideoHistoryPoint[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [videoFilter, setVideoFilter] = useState<"all" | "videos" | "shorts">("videos");
  const [searchQuery, setSearchQuery] = useState("");
  const [minViews, setMinViews] = useState("");
  const [maxViews, setMaxViews] = useState("");
  const [minVph, setMinVph] = useState("");
  const [maxVph, setMaxVph] = useState("");
  const [minLikes, setMinLikes] = useState("");
  const [maxLikes, setMaxLikes] = useState("");
  const [minComments, setMinComments] = useState("");
  const [maxComments, setMaxComments] = useState("");
  const [minEngagement, setMinEngagement] = useState("");
  const [maxEngagement, setMaxEngagement] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [competitorSearch, setCompetitorSearch] = useState("");
  const [selectedMetric, setSelectedMetric] = useState<"VPH" | "VIEWS" | "VIDEOS" | "SUBS">("VPH");
  const [selectedType, setSelectedType] = useState<"TOTAL" | "LONG" | "SHORTS">("TOTAL");

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const initialFetch = useRef(true);

  function toggleSidebar(next: boolean) {
    setIsCollapsed(next);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 310);
  }

  // Restore all persisted state on mount
  useEffect(() => {
    const saved = localStorage.getItem("activeNav") as NavItem | null;
    if (saved === "search" || saved === "tracked" || saved === "competitor") {
      setActiveNav(saved);
    }
    const savedCollapsed = localStorage.getItem("vidspy-sidebar-collapsed");
    if (savedCollapsed === "true") setIsCollapsed(true);
    const savedInput = sessionStorage.getItem("searchInput");
    const savedResult = sessionStorage.getItem("searchResult");
    if (savedInput) setInput(savedInput);
    if (savedResult) {
      try { setResult(JSON.parse(savedResult)); } catch { /* ignore */ }
    }
    const savedFilter = sessionStorage.getItem("videoFilter") as "all" | "videos" | "shorts" | null;
    if (savedFilter === "all" || savedFilter === "videos" || savedFilter === "shorts") {
      setVideoFilter(savedFilter);
    }
    const savedSearchQuery = sessionStorage.getItem("videoSearchQuery");
    if (savedSearchQuery) setSearchQuery(savedSearchQuery);
    setHydrated(true);
  }, []);

  // Persist state changes (skip until hydration render is complete)
  useEffect(() => {
    if (!hydrated) return;
    sessionStorage.setItem("searchInput", input);
  }, [hydrated, input]);

  useEffect(() => {
    if (!hydrated) return;
    sessionStorage.setItem("videoFilter", videoFilter);
  }, [hydrated, videoFilter]);

  useEffect(() => {
    if (!hydrated) return;
    if (selectedChannelId) sessionStorage.setItem("selectedChannelId", selectedChannelId);
  }, [hydrated, selectedChannelId]);

  useEffect(() => {
    if (!hydrated) return;
    if (result) sessionStorage.setItem("searchResult", JSON.stringify(result));
    else sessionStorage.removeItem("searchResult");
  }, [hydrated, result]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("vidspy-sidebar-collapsed", String(isCollapsed));
  }, [hydrated, isCollapsed]);

  useEffect(() => {
    if (!hydrated) return;
    sessionStorage.setItem("videoSearchQuery", searchQuery);
  }, [hydrated, searchQuery]);

  useEffect(() => {
    getTrackedChannelsWithMetrics()
      .then((channels) => {
        setTrackedChannels(channels);
        const savedChannel = sessionStorage.getItem("selectedChannelId");
        const match = savedChannel && channels.some((c) => c.channelId === savedChannel);
        setSelectedChannelId(match ? savedChannel : (channels[0]?.channelId ?? null));
        setSelectedChannelIds(channels.slice(0, 5).map((c) => c.channelId));
      })
      .catch(console.error)
      .finally(() => setLoadingTracked(false));
  }, []);

  const fetchVideoHistory = useCallback(async (channelId: string, videoId: string) => {
    setLoadingHistory(true);
    try {
      const history = await getVideoHistory(channelId, videoId);
      setVideoHistory(history);
    } catch {
      setVideoHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const handleVideoSelect = useCallback((videoId: string) => {
    if (!selectedChannelId) return;
    setSelectedVideoId(videoId);
    fetchVideoHistory(selectedChannelId, videoId);
  }, [selectedChannelId, fetchVideoHistory]);

  const fetchChannelData = useCallback(async (channelId: string, keepFilter = false) => {
    setLoadingSelected(true);
    setSelectedData(null);
    setSelectedVideoId(null);
    setVideoHistory([]);
    setSearchQuery("");
    if (!keepFilter) setVideoFilter("videos");
    try {
      const cached = await getTrackedChannelData(channelId);
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
      setLastSynced(new Date());
      // Auto-select the top-VPH video
      const topVideo = videos
        .filter((v) => v.vph != null)
        .sort((a, b) => (b.vph ?? 0) - (a.vph ?? 0))[0];
      if (topVideo) {
        setSelectedVideoId(topVideo.videoId);
        fetchVideoHistory(channelId, topVideo.videoId);
      }
    } catch {
      /* silent */
    } finally {
      setLoadingSelected(false);
    }
  }, [fetchVideoHistory]);

  useEffect(() => {
    if (selectedChannelId) {
      fetchChannelData(selectedChannelId, initialFetch.current);
      initialFetch.current = false;
    }
  }, [selectedChannelId, fetchChannelData]);

  useEffect(() => {
    if (!selectedChannelId || !selectedData) return;
    setSelectedVideoId(null);
    setVideoHistory([]);
    const filtered =
      videoFilter === "all"    ? selectedData.videos :
      videoFilter === "shorts" ? selectedData.videos.filter(isShort) :
                                 selectedData.videos.filter((v) => !isShort(v));
    const top = filtered
      .filter((v) => v.vph != null)
      .sort((a, b) => (b.vph ?? 0) - (a.vph ?? 0))[0];
    if (top) {
      setSelectedVideoId(top.videoId);
      fetchVideoHistory(selectedChannelId, top.videoId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoFilter]);

  // Centralized filtered videos — replaces inline IIFEs
  const filteredVideos = useMemo(() => {
    if (!selectedData) return [];
    let videos = selectedData.videos;

    // Content type
    if (videoFilter === "shorts") videos = videos.filter(v => v.isShort);
    else if (videoFilter === "videos") videos = videos.filter(v => !v.isShort);

    // Title search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      videos = videos.filter(v => v.title.toLowerCase().includes(q));
    }

    // Range filter helper
    const rangeFilter = (field: (v: VideoItem) => number | null, min: string, max: string) => {
      const minN = Number(min);
      const maxN = Number(max);
      if (min && !isNaN(minN)) videos = videos.filter(v => (field(v) ?? 0) >= minN);
      if (max && !isNaN(maxN)) videos = videos.filter(v => (field(v) ?? 0) <= maxN);
    };

    rangeFilter(v => v.viewCount, minViews, maxViews);
    rangeFilter(v => v.vph, minVph, maxVph);
    rangeFilter(v => v.likeCount, minLikes, maxLikes);
    rangeFilter(v => v.commentCount, minComments, maxComments);
    rangeFilter(v => v.engagementRate, minEngagement, maxEngagement);

    return videos;
  }, [selectedData, videoFilter, searchQuery, minViews, maxViews, minVph, maxVph, minLikes, maxLikes, minComments, maxComments, minEngagement, maxEngagement]);

  const filterLabel = videoFilter === "all" ? "all" : videoFilter === "shorts" ? "shorts" : "videos";
  const advancedFilterValues = [minViews, maxViews, minVph, maxVph, minLikes, maxLikes, minComments, maxComments, minEngagement, maxEngagement];
  const activeFilterCount = advancedFilterValues.filter(v => v !== "").length;
  const hasAnyFilter = searchQuery !== "" || activeFilterCount > 0;

  function clearAllFilters() {
    setSearchQuery("");
    setMinViews(""); setMaxViews("");
    setMinVph(""); setMaxVph("");
    setMinLikes(""); setMaxLikes("");
    setMinComments(""); setMaxComments("");
    setMinEngagement(""); setMaxEngagement("");
    setShowAdvancedFilters(false);
  }

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
          durationSeconds: v.durationSeconds ?? null,
          isShort: v.isShort ?? false,
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
          durationSeconds: v.durationSeconds ?? null,
          isShort: v.isShort ?? false,
        }))
      );
      const enriched = result.videos.map((v) => {
        const snap = snapshotMap.get(v.videoId);
        if (!snap) return v;
        return { ...v, vph: snap.vph, engagementRate: snap.engagementRate };
      });
      setResult({ ...result, videos: enriched });
      setTrackState("tracked");
      const updated = await getTrackedChannelsWithMetrics();
      setTrackedChannels(updated);
      setSelectedChannelId(result.channelId);
    } catch (err) {
      console.error("Failed to track channel:", err);
      setTrackState("idle");
    }
  }

  function handleClear() {
    setResult(null);
    setInput("");
    setError(null);
    setTrackState("idle");
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
    { id: "search",     label: "Search",              icon: <Search className="h-4 w-4" /> },
    { id: "tracked",    label: "Tracked Channels",    icon: <Radio className="h-4 w-4" /> },
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
    <div className="flex flex-col items-center justify-center min-h-0 md:min-h-[calc(100vh-8rem)] max-w-2xl mx-auto text-center gap-5 md:gap-8">

      {/* Hero icon */}
      <div className="rounded-2xl bg-primary/10 p-4 md:p-6 ring-1 ring-primary/20">
        <Activity className="w-14 h-14 md:w-20 md:h-20 text-primary/40" />
      </div>

      {/* Heading */}
      <div className="space-y-2">
        <h2 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">Discover a Channel</h2>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-3 w-full mt-2">
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
      <div className="rounded-lg border border-border bg-card p-3 md:p-4 flex flex-col gap-3">
        {searchForm}
        <button
          onClick={handleClear}
          className="self-start flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to search
        </button>
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
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <div className="flex items-center gap-3 px-4 md:px-6 py-3 md:py-4 border-b border-border">
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
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 h-full min-h-0">
      {/* Center panel */}
      <div className="flex-1 min-w-0 order-2 lg:order-1">
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
                <h2 className="text-lg md:text-xl font-bold tracking-tight text-foreground truncate">
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
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 md:gap-3">
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
                  const withViews = filteredVideos.filter(
                    (v) => v.viewCount != null
                  );
                  if (!withViews.length) return "—";
                  const avg =
                    withViews.reduce((s, v) => s + (v.viewCount ?? 0), 0) /
                    withViews.length;
                  return formatNumber(Math.round(avg));
                })()}
                description={`per video (${filterLabel})`}
              />
              <StatCard
                label="Videos / 30 days"
                icon={<BarChart2 className="h-4 w-4" />}
                value={String(filteredVideos.length)}
                description={`recent ${filterLabel}`}
              />
              <StatCard
                label="Avg VPH"
                icon={<Zap className="h-4 w-4" />}
                value={(() => {
                  const vals = filteredVideos
                    .map((v) => v.vph)
                    .filter((v): v is number => v != null);
                  if (!vals.length) return "—";
                  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
                  return `${formatNumber(Math.round(avg))}/hr`;
                })()}
                description={`${filterLabel} speed`}
              />
            </div>

            {/* Content-type tabs + Filters + Export */}
            <div className="space-y-2">
              {/* Row 1: toggle + search + filters button + export */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1 w-fit border border-border">
                  {(["videos", "shorts", "all"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setVideoFilter(f)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        videoFilter === f
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {f === "all" ? "All" : f === "shorts" ? "Shorts" : "Videos"}
                    </button>
                  ))}
                </div>

                {/* Search input */}
                <div className="relative flex-1 min-w-[160px] max-w-[240px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search videos..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 pr-7 text-xs bg-muted/30 border-border"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Filters toggle */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Filters
                  {activeFilterCount > 0 && (
                    <Badge className="h-4 min-w-4 px-1 flex items-center justify-center text-[10px] rounded-full bg-primary text-primary-foreground">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>

                {/* Export CSV — pushed right */}
                <div className="ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filteredVideos.length === 0}
                    className="h-8 text-xs gap-1.5"
                    onClick={() => exportCsv(filteredVideos, selectedData.channelTitle, filterLabel)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export CSV
                  </Button>
                </div>
              </div>

              {/* Row 2: advanced filters (conditional) */}
              {showAdvancedFilters && (
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {([
                      { label: "Views", min: minViews, setMin: setMinViews, max: maxViews, setMax: setMaxViews, numeric: true },
                      { label: "VPH", min: minVph, setMin: setMinVph, max: maxVph, setMax: setMaxVph, numeric: true },
                      { label: "Likes", min: minLikes, setMin: setMinLikes, max: maxLikes, setMax: setMaxLikes, numeric: true },
                      { label: "Comments", min: minComments, setMin: setMinComments, max: maxComments, setMax: setMaxComments, numeric: true },
                      { label: "Engagement %", min: minEngagement, setMin: setMinEngagement, max: maxEngagement, setMax: setMaxEngagement, numeric: false },
                    ] as const).map(({ label, min, setMin, max, setMax, numeric }) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground font-medium w-[80px] shrink-0">{label}</span>
                        <Input
                          placeholder="Min"
                          inputMode={numeric ? "numeric" : "decimal"}
                          value={min}
                          onChange={(e) => setMin(numeric ? e.target.value.replace(/[^0-9]/g, "") : e.target.value.replace(/[^0-9.]/g, ""))}
                          className="h-7 w-[72px] text-xs bg-muted/30 border-border px-2"
                        />
                        <span className="text-[10px] text-muted-foreground">–</span>
                        <Input
                          placeholder="Max"
                          inputMode={numeric ? "numeric" : "decimal"}
                          value={max}
                          onChange={(e) => setMax(numeric ? e.target.value.replace(/[^0-9]/g, "") : e.target.value.replace(/[^0-9.]/g, ""))}
                          className="h-7 w-[72px] text-xs bg-muted/30 border-border px-2"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Active filter pills + clear all */}
                  {activeFilterCount > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {minViews && <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => setMinViews("")}>Views &ge; {minViews} <X className="h-3 w-3" /></Badge>}
                      {maxViews && <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => setMaxViews("")}>Views &le; {maxViews} <X className="h-3 w-3" /></Badge>}
                      {minVph && <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => setMinVph("")}>VPH &ge; {minVph} <X className="h-3 w-3" /></Badge>}
                      {maxVph && <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => setMaxVph("")}>VPH &le; {maxVph} <X className="h-3 w-3" /></Badge>}
                      {minLikes && <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => setMinLikes("")}>Likes &ge; {minLikes} <X className="h-3 w-3" /></Badge>}
                      {maxLikes && <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => setMaxLikes("")}>Likes &le; {maxLikes} <X className="h-3 w-3" /></Badge>}
                      {minComments && <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => setMinComments("")}>Comments &ge; {minComments} <X className="h-3 w-3" /></Badge>}
                      {maxComments && <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => setMaxComments("")}>Comments &le; {maxComments} <X className="h-3 w-3" /></Badge>}
                      {minEngagement && <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => setMinEngagement("")}>Eng &ge; {minEngagement}% <X className="h-3 w-3" /></Badge>}
                      {maxEngagement && <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => setMaxEngagement("")}>Eng &le; {maxEngagement}% <X className="h-3 w-3" /></Badge>}
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground underline ml-1"
                        onClick={() => { setMinViews(""); setMaxViews(""); setMinVph(""); setMaxVph(""); setMinLikes(""); setMaxLikes(""); setMinComments(""); setMaxComments(""); setMinEngagement(""); setMaxEngagement(""); }}
                      >
                        Clear all
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Result count when filters active */}
              {hasAnyFilter && selectedData && (
                <p className="text-xs text-muted-foreground">
                  Showing {filteredVideos.length} of {selectedData.videos.length} videos
                </p>
              )}
            </div>

            {/* Single Video Pulse */}
            <SingleVideoPulse
              history={videoHistory}
              loading={loadingHistory}
              videoTitle={
                selectedVideoId
                  ? (filteredVideos.find((v) => v.videoId === selectedVideoId)?.title ?? null)
                  : null
              }
            />

            {/* Video table or empty state */}
            {filteredVideos.length === 0 && hasAnyFilter ? (
              <div className="rounded-lg border border-border bg-card flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground">No videos match your filters</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={clearAllFilters}>
                  Clear all filters
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card overflow-x-auto">
                <VideoTable
                  videos={filteredVideos}
                  selectedVideoId={selectedVideoId}
                  onVideoSelect={handleVideoSelect}
                  channelId={selectedChannelId ?? undefined}
                />
              </div>
            )}

            {/* VPH legend */}
            <p className="text-xs text-muted-foreground/60 px-1">
              <span className="text-emerald-400 font-medium">Green</span> VPH = above this channel&apos;s current average
            </p>
          </div>
        ) : null}
      </div>

      {/* Channel list — horizontal strip on mobile, vertical sidebar on desktop */}
      {trackedChannels.length > 0 && (
        <div className="w-full lg:w-60 shrink-0 order-1 lg:order-2">
          {/* Mobile: horizontal scrollable strip */}
          <div className="lg:hidden flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
            {trackedChannels.map((ch) => (
              <button
                key={ch.channelId}
                onClick={() => setSelectedChannelId(ch.channelId)}
                className={`shrink-0 flex flex-col items-center gap-1 p-1.5 rounded-lg min-w-[52px] transition-colors ${
                  selectedChannelId === ch.channelId
                    ? "bg-primary/10 ring-1 ring-primary/30"
                    : "hover:bg-white/[0.04]"
                }`}
              >
                <Avatar className="h-10 w-10 border-2 border-border">
                  <AvatarImage src={ch.channelThumbnail} alt={ch.channelTitle} />
                  <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                    {ch.channelTitle[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[10px] text-muted-foreground truncate max-w-[56px]">
                  {ch.channelTitle.split(" ")[0]}
                </span>
              </button>
            ))}
          </div>

          {/* Desktop: vertical card list */}
          <div className="hidden lg:block sticky top-0 rounded-lg border border-border bg-card overflow-hidden">
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
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(ch.channelId); }}
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

  const competitorFilteredChannels = trackedChannels.filter((ch) =>
    ch.channelTitle.toLowerCase().includes(competitorSearch.toLowerCase())
  );

  const competitorChartData = trackedChannels
    .filter((ch) => selectedChannelIds.includes(ch.channelId))
    .map((ch) => {
      const raw = getChannelValue(ch, selectedMetric, selectedType);
      return {
        name: ch.channelTitle,
        value: raw ?? 0,
        hasData: raw != null,
        thumbnail: ch.channelThumbnail,
        subscribers: ch.subscriberCount ?? 0,
      };
    })
    .sort((a, b) => b.value - a.value);

  const competitorThumbnailMap = new Map(
    competitorChartData.map((ch) => [ch.name, ch.thumbnail])
  );


  const yAxisMax = competitorChartData.length > 0
    ? Math.ceil(Math.max(...competitorChartData.map((d) => d.value)) * 1.2)
    : 0;


  const metricLabel =
    selectedMetric === "VPH" ? "Avg VPH" :
    selectedMetric === "VIEWS" ? "Avg Views" :
    selectedMetric === "SUBS" ? "Subscribers" : "Videos / 30d";

  const typeLabel =
    selectedType === "TOTAL" ? "Total" :
    selectedType === "LONG" ? "Long-form" : "Shorts";

  const typeDisabled = selectedMetric === "VIDEOS" || selectedMetric === "SUBS";

  const competitorHeading =
    typeDisabled
      ? `${metricLabel} Comparison`
      : `${metricLabel} Comparison (${typeLabel} content)`;

  const [competitorPanelOpen, setCompetitorPanelOpen] = useState(false);

  const CompetitorChannelList = (
    <>
      <Input
        placeholder="Filter channels..."
        value={competitorSearch}
        onChange={(e) => setCompetitorSearch(e.target.value)}
        className="h-8 text-xs mb-3"
      />
      <div className="max-h-[calc(100vh-250px)] overflow-y-auto -mr-2 pr-2 space-y-0.5">
        {competitorFilteredChannels.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">
            {trackedChannels.length === 0 ? "No tracked channels yet." : "No channels match your filter."}
          </p>
        )}
        {competitorFilteredChannels.map((ch) => {
          const selected = selectedChannelIds.includes(ch.channelId);
          return (
            <button
              key={ch.channelId}
              onClick={() =>
                setSelectedChannelIds((prev) =>
                  selected ? prev.filter((id) => id !== ch.channelId) : [...prev, ch.channelId]
                )
              }
              className={`w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${
                selected
                  ? "bg-primary/10 border border-primary/20"
                  : "hover:bg-white/[0.04] border border-transparent"
              }`}
            >
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={ch.channelThumbnail} alt={ch.channelTitle} />
                <AvatarFallback className="text-[10px]">{ch.channelTitle.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="flex-1 min-w-0 text-xs font-medium text-foreground truncate">
                {ch.channelTitle}
              </span>
              <div
                className={`h-4 w-4 rounded shrink-0 flex items-center justify-center transition-colors ${
                  selected ? "bg-primary border border-primary" : "border border-border bg-transparent"
                }`}
              >
                {selected && <Check className="h-3 w-3 text-primary-foreground" />}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );

  const CompetitorView = (
    <div className="flex flex-col lg:flex-row h-auto lg:h-[calc(100vh-4rem)] gap-4 lg:gap-0">
      {/* Chart panel */}
      <div className="flex-1 lg:flex-[3] flex flex-col gap-4 lg:pr-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-primary/10 p-2 ring-1 ring-primary/20 shrink-0">
              <Swords className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm md:text-lg font-semibold text-foreground truncate">{competitorHeading}</h2>
              <p className="text-xs text-muted-foreground">
                {selectedChannelIds.length} channel{selectedChannelIds.length !== 1 ? "s" : ""} selected
              </p>
            </div>
          </div>
          {/* Mobile: button to open channel selector */}
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden h-8 text-xs gap-1.5 shrink-0"
            onClick={() => setCompetitorPanelOpen(true)}
          >
            <Users className="h-3.5 w-3.5" />
            Channels
          </Button>
        </div>

        {/* Metric Selector Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 md:gap-4">
          {/* Left: Content Type segmented control */}
          <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1 border border-border">
            {(["TOTAL", "LONG", "SHORTS"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                disabled={typeDisabled}
                className={`px-2.5 md:px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  selectedType === t && !typeDisabled
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "TOTAL" ? "Total" : t === "LONG" ? "Long-form" : "Shorts"}
              </button>
            ))}
          </div>

          {/* Right: Metric Select dropdown */}
          <Select
            value={selectedMetric}
            onValueChange={(v) => setSelectedMetric(v as "VPH" | "VIEWS" | "VIDEOS" | "SUBS")}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="VPH">Avg VPH</SelectItem>
              <SelectItem value="VIEWS">Avg Views</SelectItem>
              <SelectItem value="SUBS">Subscribers</SelectItem>
              <SelectItem value="VIDEOS">Videos / 30d</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Chart or empty state */}
        {competitorChartData.length === 0 ? (
          <div className="h-[300px] lg:flex-1 lg:h-auto flex flex-col items-center justify-center text-center gap-3">
            <Users className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              <span className="hidden lg:inline">Select channels from the right panel to compare</span>
              <span className="lg:hidden">Tap &quot;Channels&quot; to select channels to compare</span>
            </p>
          </div>
        ) : (
          <div className="h-[300px] lg:flex-1 lg:h-auto">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={competitorChartData} margin={{ top: 28, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  height={44}
                  tick={(props) => <ChannelIconTick {...props} thumbnailMap={competitorThumbnailMap} />}
                />
                <YAxis
                  width={50}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => formatNumber(v)}
                  domain={[0, yAxisMax || "auto"]}
                />
                <RechartsTooltip
                  content={<CompetitorTooltip formatter={getFormatter(selectedMetric)} />}
                  cursor={{ fill: "var(--primary)", opacity: 0.06 }}
                />
                <Bar
                  dataKey="value"
                  fill="var(--primary)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={80}
                  isAnimationActive={false}
                  label={
                    selectedChannelIds.length <= 10
                      ? {
                          position: "top" as const,
                          formatter: getFormatter(selectedMetric),
                          fill: "var(--muted-foreground)",
                          fontSize: 12,
                          offset: 6,
                        }
                      : false
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Right panel — Channel selector (desktop only) */}
      <div className="hidden lg:flex flex-[1] border-l border-border pl-6 flex-col">
        <h3 className="text-sm font-semibold text-foreground mb-3">Channels</h3>
        {CompetitorChannelList}
      </div>

      {/* Mobile channel selector sheet */}
      {competitorPanelOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setCompetitorPanelOpen(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] bg-card border-t border-border rounded-t-xl flex flex-col animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Select Channels</h3>
              <button
                onClick={() => setCompetitorPanelOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-4 py-3 flex-1 overflow-y-auto">
              {CompetitorChannelList}
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
      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 border-b border-border bg-card">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="rounded-md p-2.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/10 p-1.5 ring-1 ring-primary/20">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <span className="font-mono tracking-tighter">
            <span className="text-sm font-bold text-foreground">VID</span>
            <span className="text-sm font-normal text-primary">SPY</span>
          </span>
        </div>
        <div className="w-10" />
      </div>

      {/* Left sidebar — hidden on mobile */}
      <aside className={`shrink-0 border-r border-border bg-card hidden md:flex flex-col transition-all duration-300 ease-in-out ${isCollapsed ? "w-[70px]" : "w-56"}`}>
        {/* Logo / collapse toggle */}
        {isCollapsed ? (
          <button
            onClick={() => toggleSidebar(false)}
            className="flex items-center justify-center w-full h-[65px] border-b border-border hover:bg-white/[0.04] transition-colors"
          >
            <div className="rounded-md bg-primary/10 p-1.5 ring-1 ring-primary/20">
              <Activity className="h-4 w-4 text-primary" />
            </div>
          </button>
        ) : (
          <div className="flex items-center justify-between px-4 border-b border-border h-[65px]">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-primary/10 p-1.5 ring-1 ring-primary/20 shrink-0">
                <Activity className="h-4 w-4 text-primary" />
              </div>
              <span className="font-mono tracking-tighter drop-shadow-[0_0_10px_rgba(155,110,255,0.2)]">
                <span className="text-sm font-bold text-foreground">VID</span>
                <span className="text-sm font-normal text-primary">SPY</span>
              </span>
            </div>
            <button
              onClick={() => toggleSidebar(true)}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Nav */}
        <TooltipProvider delayDuration={0}>
          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {navItems.map((item) => (
              <Tooltip key={item.id} disableHoverableContent>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (isCollapsed && item.id === "search") {
                        toggleSidebar(false);
                        setActiveNav("search");
                        localStorage.setItem("activeNav", "search");
                        return;
                      }
                      setActiveNav(item.id);
                      localStorage.setItem("activeNav", item.id);
                    }}
                    className={`w-full flex items-center rounded-md transition-all duration-300 ${
                      isCollapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
                    } text-sm font-medium ${
                      activeNav === item.id
                        ? "bg-white/[0.07] text-foreground border border-border"
                        : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground border border-transparent"
                    }`}
                  >
                    {item.icon}
                    <span className={`overflow-hidden transition-all duration-300 whitespace-nowrap ${
                      isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                    }`}>
                      {item.label}
                    </span>
                  </button>
                </TooltipTrigger>
                {isCollapsed && (
                  <TooltipContent side="right" className="text-xs">
                    {item.label}
                  </TooltipContent>
                )}
              </Tooltip>
            ))}
          </nav>
        </TooltipProvider>

        {/* Bottom VidMetrics section */}
        <div className="px-3 py-3 border-t border-border">
          <TooltipProvider delayDuration={0}>
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <div className={`flex items-center rounded-md px-2 py-2 ${isCollapsed ? "justify-center" : "gap-2.5"}`}>
                  <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                    <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className={`flex-1 min-w-0 overflow-hidden transition-all duration-300 ${isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"}`}>
                    <p className="text-xs font-medium text-foreground leading-none whitespace-nowrap">VidMetrics</p>
                  </div>
                  {!isCollapsed && (
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  )}
                </div>
              </TooltipTrigger>
              {isCollapsed && (
                <TooltipContent side="right" className="text-xs">VidMetrics</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 px-4 md:px-8 pt-[72px] md:pt-8 pb-4 md:pb-8 overflow-y-auto overflow-x-hidden bg-background">
        {activeNav === "search" ? SearchView : activeNav === "competitor" ? CompetitorView : TrackedView}
      </main>

      {/* Mobile sidebar overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="absolute top-0 left-0 bottom-0 w-64 bg-card border-r border-border flex flex-col animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between px-4 h-14 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-primary/10 p-1.5 ring-1 ring-primary/20">
                  <Activity className="h-4 w-4 text-primary" />
                </div>
                <span className="font-mono tracking-tighter">
                  <span className="text-sm font-bold text-foreground">VID</span>
                  <span className="text-sm font-normal text-primary">SPY</span>
                </span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveNav(item.id);
                    localStorage.setItem("activeNav", item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
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
          </aside>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId && (() => {
        const ch = trackedChannels.find((c) => c.channelId === confirmDeleteId);
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
              <h2 className="text-base font-semibold text-foreground mb-1">Remove channel?</h2>
              <p className="text-sm text-muted-foreground mb-6">
                <span className="text-foreground font-medium">{ch?.channelTitle}</span> will be removed from your tracked channels. This cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDeleteId(null)}
                  disabled={removingId === confirmDeleteId}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={removingId === confirmDeleteId}
                  onClick={async () => {
                    await handleRemove(confirmDeleteId);
                    setConfirmDeleteId(null);
                  }}
                >
                  {removingId === confirmDeleteId
                    ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Removing…</>
                    : "Remove"}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
