import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateEmbedding } from '@/lib/openai';

// DELETE - Clear all data to allow re-indexing
export async function DELETE() {
  try {
    // Delete chunks first (foreign key constraint)
    const { error: chunksError } = await supabaseAdmin
      .from('chunks')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (chunksError) {
      return NextResponse.json({ error: chunksError.message }, { status: 500 });
    }

    // Delete videos
    const { error: videosError } = await supabaseAdmin
      .from('videos')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (videosError) {
      return NextResponse.json({ error: videosError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'All videos and chunks deleted. You can now re-index videos.'
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to clear data'
    }, { status: 500 });
  }
}

export async function GET() {
  const diagnostics: Record<string, unknown> = {};

  try {
    // 1. Check videos count
    const { data: videos, error: videosError } = await supabaseAdmin
      .from('videos')
      .select('id, youtube_id, title, created_at');

    diagnostics.videos = {
      count: videos?.length ?? 0,
      error: videosError?.message,
      data: videos,
    };

    // 2. Check chunks count and sample
    const { data: chunks, error: chunksError } = await supabaseAdmin
      .from('chunks')
      .select('id, video_id, content, start_time, embedding')
      .limit(3);

    diagnostics.chunks = {
      count: chunks?.length ?? 0,
      error: chunksError?.message,
      samples: chunks?.map(c => ({
        id: c.id,
        video_id: c.video_id,
        content_preview: c.content?.substring(0, 100),
        embedding_type: typeof c.embedding,
        embedding_is_array: Array.isArray(c.embedding),
        embedding_length: Array.isArray(c.embedding) ? c.embedding.length :
                          typeof c.embedding === 'string' ? `string: ${c.embedding.substring(0, 50)}...` : 'null',
      })),
    };

    // 3. Get total chunks count
    const { count: totalChunks } = await supabaseAdmin
      .from('chunks')
      .select('*', { count: 'exact', head: true });

    diagnostics.totalChunks = totalChunks;

    // 4. Test embedding generation
    const testQuery = 'summarize key points';
    const testEmbedding = await generateEmbedding(testQuery);
    diagnostics.embeddingTest = {
      query: testQuery,
      embedding_generated: !!testEmbedding,
      embedding_length: testEmbedding?.length,
      embedding_sample: testEmbedding?.slice(0, 5),
    };

    // 5. Test match_chunks function directly
    const { data: matchResult, error: matchError } = await supabaseAdmin.rpc(
      'match_chunks',
      {
        query_embedding: testEmbedding,
        match_threshold: 0.0, // Very low threshold to catch anything
        match_count: 5,
      }
    );

    diagnostics.matchTest = {
      threshold_used: 0.0,
      results_count: matchResult?.length ?? 0,
      error: matchError?.message,
      results: matchResult?.map((r: { content: string; similarity: number; video_title: string }) => ({
        content_preview: r.content?.substring(0, 100),
        similarity: r.similarity,
        video_title: r.video_title,
      })),
    };

    // 6. Check if embeddings are stored as strings (the bug)
    const { data: rawChunk } = await supabaseAdmin
      .from('chunks')
      .select('embedding')
      .limit(1)
      .single();

    if (rawChunk?.embedding) {
      const embType = typeof rawChunk.embedding;
      const isString = embType === 'string';
      diagnostics.embeddingStorageIssue = {
        stored_as_string: isString,
        actual_type: embType,
        message: isString
          ? 'PROBLEM: Embeddings are stored as strings! Need to re-index videos.'
          : 'OK: Embeddings are stored correctly as arrays/vectors.',
      };
    }

    return NextResponse.json(diagnostics, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Debug failed',
      diagnostics,
    }, { status: 500 });
  }
}
