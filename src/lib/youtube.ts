import { YoutubeTranscript } from 'youtube-transcript';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

export interface TranscriptItem {
  text: string;
  offset: number;
  duration: number;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  channelName: string;
  url: string;
}

// Extract video ID from various YouTube URL formats
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/, // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Extract channel identifier from URL
export function extractChannelId(url: string): { type: 'handle' | 'id' | 'user'; value: string } | null {
  const patterns: { pattern: RegExp; type: 'handle' | 'id' | 'user' }[] = [
    { pattern: /youtube\.com\/@([^\/\?]+)/, type: 'handle' },
    { pattern: /youtube\.com\/channel\/([^\/\?]+)/, type: 'id' },
    { pattern: /youtube\.com\/user\/([^\/\?]+)/, type: 'user' },
    { pattern: /youtube\.com\/c\/([^\/\?]+)/, type: 'handle' },
  ];

  for (const { pattern, type } of patterns) {
    const match = url.match(pattern);
    if (match) return { type, value: match[1] };
  }
  return null;
}

// Languages to try when fetching transcripts (in order of preference)
const TRANSCRIPT_LANGUAGES = ['en', 'en-US', 'en-GB', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh'];

// Fetch transcript using youtube-transcript with language fallback
async function fetchTranscriptWithLanguageFallback(videoId: string): Promise<TranscriptItem[]> {
  let lastError: Error | null = null;

  // First try without specifying language (gets default/auto-generated)
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (transcript.length === 0) {
      throw new Error('Transcript returned empty');
    }
    return transcript.map(item => ({
      text: item.text,
      offset: item.offset / 1000,
      duration: item.duration / 1000,
    }));
  } catch (error) {
    lastError = error as Error;
    console.log(`Default transcript not available for ${videoId}, trying specific languages...`);
  }

  // Try each language
  for (const lang of TRANSCRIPT_LANGUAGES) {
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      if (transcript.length === 0) {
        continue; // Try next language
      }
      console.log(`Found transcript in language: ${lang}`);
      return transcript.map(item => ({
        text: item.text,
        offset: item.offset / 1000,
        duration: item.duration / 1000,
      }));
    } catch {
      // Continue to next language
    }
  }

  throw lastError || new Error('No transcript available');
}

// Parse VTT subtitle file into TranscriptItems
function parseVTT(vttContent: string): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const lines = vttContent.split('\n');

  let i = 0;
  // Skip header
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // Look for timestamp line (e.g., "00:00:01.000 --> 00:00:04.000")
    if (line.includes('-->')) {
      const [startStr, endStr] = line.split('-->').map(s => s.trim().split(' ')[0]);

      const parseTime = (timeStr: string): number => {
        const parts = timeStr.split(':');
        if (parts.length === 3) {
          const [h, m, s] = parts;
          return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
        } else if (parts.length === 2) {
          const [m, s] = parts;
          return parseInt(m) * 60 + parseFloat(s);
        }
        return 0;
      };

      const startTime = parseTime(startStr);
      const endTime = parseTime(endStr);

      // Collect text lines until empty line or next timestamp
      const textLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() && !lines[i].includes('-->')) {
        // Remove VTT formatting tags like <c> </c>
        const cleanText = lines[i].replace(/<[^>]+>/g, '').trim();
        if (cleanText) {
          textLines.push(cleanText);
        }
        i++;
      }

      if (textLines.length > 0) {
        items.push({
          text: textLines.join(' '),
          offset: startTime,
          duration: endTime - startTime,
        });
      }
    } else {
      i++;
    }
  }

  return items;
}

// Fetch transcript using yt-dlp (fallback method)
async function fetchTranscriptWithYtDlp(videoId: string): Promise<TranscriptItem[]> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const tempDir = os.tmpdir();
  const tempFileBase = path.join(tempDir, `transcript_${videoId}`);

  try {
    // Try to download auto-generated subtitles first, then manual subs
    // --write-auto-sub: auto-generated, --write-sub: manual
    await execAsync(
      `yt-dlp --write-auto-sub --write-sub --sub-lang "en.*,en" --sub-format vtt --skip-download -o "${tempFileBase}" "${url}"`,
      { timeout: 60000 }
    );

    // Find the downloaded subtitle file
    const possibleFiles = [
      `${tempFileBase}.en.vtt`,
      `${tempFileBase}.en-US.vtt`,
      `${tempFileBase}.en-GB.vtt`,
    ];

    // Also check for any .vtt file with our prefix
    const tempFiles = fs.readdirSync(tempDir);
    const matchingFiles = tempFiles.filter(f =>
      f.startsWith(`transcript_${videoId}`) && f.endsWith('.vtt')
    );

    let subtitleFile: string | null = null;

    for (const file of possibleFiles) {
      if (fs.existsSync(file)) {
        subtitleFile = file;
        break;
      }
    }

    if (!subtitleFile && matchingFiles.length > 0) {
      subtitleFile = path.join(tempDir, matchingFiles[0]);
    }

    if (!subtitleFile) {
      throw new Error('No subtitle file found');
    }

    const vttContent = fs.readFileSync(subtitleFile, 'utf-8');
    const items = parseVTT(vttContent);

    // Clean up
    for (const file of matchingFiles) {
      try {
        fs.unlinkSync(path.join(tempDir, file));
      } catch {}
    }

    if (items.length === 0) {
      throw new Error('Parsed transcript is empty');
    }

    return items;
  } catch (error) {
    // Clean up any files on error
    const tempFiles = fs.readdirSync(tempDir);
    for (const file of tempFiles) {
      if (file.startsWith(`transcript_${videoId}`)) {
        try {
          fs.unlinkSync(path.join(tempDir, file));
        } catch {}
      }
    }
    throw error;
  }
}

// Fetch transcript for a video (tries youtube-transcript first, then yt-dlp fallback)
export async function fetchTranscript(videoId: string): Promise<TranscriptItem[]> {
  try {
    return await fetchTranscriptWithLanguageFallback(videoId);
  } catch (error) {
    console.error(`youtube-transcript failed for ${videoId}:`, error);

    console.log(`Trying yt-dlp for ${videoId}...`);
    try {
      const items = await fetchTranscriptWithYtDlp(videoId);
      console.log(`yt-dlp succeeded: got ${items.length} transcript items`);
      return items;
    } catch (ytdlpError) {
      console.error(`yt-dlp also failed for ${videoId}:`, ytdlpError);
      throw new Error(`Could not fetch transcript for video ${videoId}. No captions available.`);
    }
  }
}

// Chunk transcript into manageable pieces with overlap
export function chunkTranscript(
  transcript: TranscriptItem[],
  maxChunkSize: number = 500, // approximate words
  overlapSize: number = 50
): { content: string; startTime: number; endTime: number }[] {
  const chunks: { content: string; startTime: number; endTime: number }[] = [];

  let currentChunk: TranscriptItem[] = [];
  let wordCount = 0;

  for (const item of transcript) {
    const itemWords = item.text.split(/\s+/).length;

    if (wordCount + itemWords > maxChunkSize && currentChunk.length > 0) {
      // Save current chunk
      chunks.push({
        content: currentChunk.map(i => i.text).join(' '),
        startTime: currentChunk[0].offset,
        endTime: currentChunk[currentChunk.length - 1].offset + currentChunk[currentChunk.length - 1].duration,
      });

      // Keep overlap items for next chunk
      const overlapItems: TranscriptItem[] = [];
      let overlapWords = 0;
      for (let i = currentChunk.length - 1; i >= 0 && overlapWords < overlapSize; i--) {
        overlapItems.unshift(currentChunk[i]);
        overlapWords += currentChunk[i].text.split(/\s+/).length;
      }

      currentChunk = overlapItems;
      wordCount = overlapWords;
    }

    currentChunk.push(item);
    wordCount += itemWords;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.map(i => i.text).join(' '),
      startTime: currentChunk[0].offset,
      endTime: currentChunk[currentChunk.length - 1].offset + currentChunk[currentChunk.length - 1].duration,
    });
  }

  return chunks;
}

// Format seconds to YouTube timestamp format (e.g., "1:23:45" or "12:34")
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Generate YouTube URL with timestamp
export function getTimestampUrl(videoId: string, seconds: number): string {
  return `https://youtube.com/watch?v=${videoId}&t=${Math.floor(seconds)}`;
}

// Fetch video metadata using oEmbed (no API key needed)
export async function fetchVideoMetadata(videoId: string): Promise<{ title: string; authorName: string }> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!response.ok) throw new Error('Failed to fetch metadata');
    const data = await response.json();
    return {
      title: data.title,
      authorName: data.author_name,
    };
  } catch {
    return {
      title: `Video ${videoId}`,
      authorName: 'Unknown Channel',
    };
  }
}

// Fetch channel videos using RSS feed (no API key needed, limited to ~15 recent videos)
export async function fetchChannelVideos(channelIdentifier: { type: 'handle' | 'id' | 'user'; value: string }): Promise<string[]> {
  // For handles and usernames, we need to resolve to channel ID first
  // This is a limitation without the YouTube Data API
  // For now, we'll try the RSS feed which works with channel IDs

  let channelId = channelIdentifier.value;

  // If it's a handle, we need to scrape to get the channel ID
  if (channelIdentifier.type === 'handle') {
    try {
      const response = await fetch(`https://www.youtube.com/@${channelIdentifier.value}`);
      const html = await response.text();
      const match = html.match(/\"channelId\":\"([^\"]+)\"/);
      if (match) {
        channelId = match[1];
      } else {
        throw new Error('Could not resolve channel handle to ID');
      }
    } catch (error) {
      console.error('Failed to resolve channel handle:', error);
      throw new Error(`Could not find channel @${channelIdentifier.value}`);
    }
  }

  // Fetch RSS feed
  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const response = await fetch(rssUrl);
    if (!response.ok) throw new Error('Failed to fetch RSS feed');

    const xml = await response.text();
    const videoIds: string[] = [];

    // Simple regex to extract video IDs from RSS
    const matches = xml.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g);
    for (const match of matches) {
      videoIds.push(match[1]);
    }

    return videoIds;
  } catch (error) {
    console.error('Failed to fetch channel videos:', error);
    throw new Error('Could not fetch videos from this channel. Try using the YouTube Data API for better results.');
  }
}
