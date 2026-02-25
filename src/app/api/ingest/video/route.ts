import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateEmbeddings } from '@/lib/openai';
import {
  extractVideoId,
  fetchTranscript,
  chunkTranscript,
  fetchVideoMetadata,
} from '@/lib/youtube';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
    }

    // Check if video already indexed
    const { data: existingVideo } = await supabaseAdmin
      .from('videos')
      .select('id')
      .eq('youtube_id', videoId)
      .single();

    if (existingVideo) {
      // Fetch title for already indexed video
      const { data: videoData } = await supabaseAdmin
        .from('videos')
        .select('title')
        .eq('id', existingVideo.id)
        .single();

      return NextResponse.json({
        message: 'Video already indexed',
        videoId: existingVideo.id,
        youtubeId: videoId,
        title: videoData?.title || 'Unknown',
        alreadyIndexed: true,
      });
    }

    // Fetch video metadata
    const metadata = await fetchVideoMetadata(videoId);

    // Fetch transcript
    const transcript = await fetchTranscript(videoId);
    if (transcript.length === 0) {
      return NextResponse.json(
        { error: 'No transcript available for this video' },
        { status: 400 }
      );
    }

    // Chunk the transcript
    const chunks = chunkTranscript(transcript);

    // Generate embeddings for all chunks
    const embeddings = await generateEmbeddings(chunks.map(c => c.content));

    // Insert video record
    const videoUuid = uuidv4();
    const { error: videoError } = await supabaseAdmin.from('videos').insert({
      id: videoUuid,
      youtube_id: videoId,
      title: metadata.title,
      channel_name: metadata.authorName,
      url: `https://youtube.com/watch?v=${videoId}`,
    });

    if (videoError) {
      console.error('Error inserting video:', videoError);
      return NextResponse.json({ error: 'Failed to save video' }, { status: 500 });
    }

    // Insert chunks with embeddings
    const chunkRecords = chunks.map((chunk, index) => ({
      id: uuidv4(),
      video_id: videoUuid,
      content: chunk.content,
      start_time: chunk.startTime,
      end_time: chunk.endTime,
      embedding: embeddings[index],
    }));

    const { error: chunksError } = await supabaseAdmin.from('chunks').insert(chunkRecords);

    if (chunksError) {
      console.error('Error inserting chunks:', chunksError);
      // Clean up video record
      await supabaseAdmin.from('videos').delete().eq('id', videoUuid);
      return NextResponse.json({ error: 'Failed to save transcript chunks' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      videoId: videoUuid,
      youtubeId: videoId,
      title: metadata.title,
      channelName: metadata.authorName,
      chunksCount: chunks.length,
    });
  } catch (error) {
    console.error('Ingest error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process video' },
      { status: 500 }
    );
  }
}
