import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateEmbeddings } from '@/lib/openai';
import {
  extractChannelId,
  fetchChannelVideos,
  fetchTranscript,
  chunkTranscript,
  fetchVideoMetadata,
} from '@/lib/youtube';
import { v4 as uuidv4 } from 'uuid';

export const maxDuration = 60; // Allow longer execution for channel processing

export async function POST(request: NextRequest) {
  try {
    const { url, maxVideos = 15 } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const channelIdentifier = extractChannelId(url);
    if (!channelIdentifier) {
      return NextResponse.json({ error: 'Invalid YouTube channel URL' }, { status: 400 });
    }

    // Fetch video IDs from channel
    const videoIds = await fetchChannelVideos(channelIdentifier);
    const videosToProcess = videoIds.slice(0, Math.min(maxVideos, 15)); // Limit to prevent timeout

    const results: {
      videoId: string;
      title: string;
      status: 'indexed' | 'skipped' | 'failed';
      error?: string;
    }[] = [];

    for (const videoId of videosToProcess) {
      try {
        // Check if already indexed
        const { data: existingVideo } = await supabaseAdmin
          .from('videos')
          .select('id')
          .eq('youtube_id', videoId)
          .single();

        if (existingVideo) {
          const metadata = await fetchVideoMetadata(videoId);
          results.push({
            videoId,
            title: metadata.title,
            status: 'skipped',
          });
          continue;
        }

        // Fetch metadata and transcript
        const metadata = await fetchVideoMetadata(videoId);

        let transcript;
        try {
          transcript = await fetchTranscript(videoId);
        } catch {
          results.push({
            videoId,
            title: metadata.title,
            status: 'failed',
            error: 'No transcript available',
          });
          continue;
        }

        if (transcript.length === 0) {
          results.push({
            videoId,
            title: metadata.title,
            status: 'failed',
            error: 'Empty transcript',
          });
          continue;
        }

        // Chunk and embed
        const chunks = chunkTranscript(transcript);
        const embeddings = await generateEmbeddings(chunks.map(c => c.content));

        // Save to database
        const videoUuid = uuidv4();
        await supabaseAdmin.from('videos').insert({
          id: videoUuid,
          youtube_id: videoId,
          title: metadata.title,
          channel_name: metadata.authorName,
          url: `https://youtube.com/watch?v=${videoId}`,
        });

        const chunkRecords = chunks.map((chunk, index) => ({
          id: uuidv4(),
          video_id: videoUuid,
          content: chunk.content,
          start_time: chunk.startTime,
          end_time: chunk.endTime,
          embedding: JSON.stringify(embeddings[index]),
        }));

        await supabaseAdmin.from('chunks').insert(chunkRecords);

        results.push({
          videoId,
          title: metadata.title,
          status: 'indexed',
        });
      } catch (error) {
        console.error(`Error processing video ${videoId}:`, error);
        results.push({
          videoId,
          title: videoId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const indexed = results.filter(r => r.status === 'indexed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return NextResponse.json({
      success: true,
      summary: {
        total: results.length,
        indexed,
        skipped,
        failed,
      },
      results,
    });
  } catch (error) {
    console.error('Channel ingest error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process channel' },
      { status: 500 }
    );
  }
}
