"use client";

import { useState } from "react";
import { PlaySquare, Search, Loader2 } from "lucide-react";
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

interface VideoItem {
  videoId: string;
  title: string;
  publishedAt: string;
  thumbnail: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

interface ApiResult {
  channelTitle: string;
  channelThumbnail: string;
  videos: VideoItem[];
}

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

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelInput: input.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <PlaySquare className="h-8 w-8 text-red-500" />
          <h1 className="text-2xl font-bold tracking-tight">VidSpy</h1>
        </div>

        {/* Search form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium text-muted-foreground">
              Enter a YouTube channel URL, handle, or ID
            </CardTitle>
          </CardHeader>
          <CardContent>
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

        {/* Error */}
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Results */}
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
                <span className="ml-auto text-sm font-normal text-muted-foreground">
                  {result.videos.length} most recent videos
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Video Title</TableHead>
                    <TableHead className="w-28 text-right">Views</TableHead>
                    <TableHead className="w-24 text-right">Likes</TableHead>
                    <TableHead className="w-28 text-right">Comments</TableHead>
                    <TableHead className="w-36 pr-6 text-right">Published</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.videos.map((video) => (
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
                      <TableCell className="pr-6 text-right text-muted-foreground">
                        {formatDate(video.publishedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
