import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateEmbedding, chatCompletion } from '@/lib/openai';
import { formatTimestamp, getTimestampUrl } from '@/lib/youtube';

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions about YouTube video content.
You have access to transcript excerpts from videos that have been indexed.

When answering questions:
1. Base your answers ONLY on the provided transcript context
2. If the context doesn't contain enough information, say so
3. Always cite your sources by mentioning the video title and timestamp
4. Use the format [Video Title @ timestamp] when citing
5. If asked which video covers a topic, list the relevant videos with timestamps
6. Be concise but thorough

The user is trying to find specific content across one or more YouTube videos.`;

export async function POST(request: NextRequest) {
  try {
    const { message, conversationHistory = [], youtubeIds = [] } = await request.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (!youtubeIds || youtubeIds.length === 0) {
      return NextResponse.json({
        response: "Please add a YouTube video first before asking questions.",
        sources: [],
      });
    }

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(message);

    // Search for relevant chunks using cosine similarity
    // Using Supabase's pgvector extension
    const { data: allChunks, error: searchError } = await supabaseAdmin.rpc(
      'match_chunks',
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.3,
        match_count: 20, // Fetch more to filter
      }
    );

    if (searchError) {
      console.error('Search error:', searchError);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    // Filter to only include chunks from session videos
    const chunks = (allChunks || [])
      .filter((chunk: { youtube_id: string }) => youtubeIds.includes(chunk.youtube_id))
      .slice(0, 8);

    if (!chunks || chunks.length === 0) {
      return NextResponse.json({
        response: "I couldn't find any relevant content in your videos. Try rephrasing your question.",
        sources: [],
      });
    }

    // Format context with video info
    const context = chunks
      .map((chunk: {
        content: string;
        video_title: string;
        youtube_id: string;
        start_time: number;
        similarity: number;
      }) => {
        const timestamp = formatTimestamp(chunk.start_time);
        const url = getTimestampUrl(chunk.youtube_id, chunk.start_time);
        return `[${chunk.video_title} @ ${timestamp}](${url}):\n"${chunk.content}"`;
      })
      .join('\n\n---\n\n');

    // Build conversation context
    const previousContext = conversationHistory
      .slice(-4) // Keep last 4 messages for context
      .map((msg: { role: string; content: string }) => `${msg.role}: ${msg.content}`)
      .join('\n');

    const fullContext = previousContext
      ? `Previous conversation:\n${previousContext}\n\n---\n\nRelevant transcript excerpts:\n${context}`
      : `Relevant transcript excerpts:\n${context}`;

    // Generate response
    const response = await chatCompletion(SYSTEM_PROMPT, message, fullContext);

    // Extract unique video sources
    const sources = [...new Map(
      chunks.map((chunk: {
        video_title: string;
        youtube_id: string;
        start_time: number;
      }) => [
        chunk.youtube_id,
        {
          title: chunk.video_title,
          videoId: chunk.youtube_id,
          url: getTimestampUrl(chunk.youtube_id, chunk.start_time),
          timestamp: formatTimestamp(chunk.start_time),
        },
      ])
    ).values()];

    return NextResponse.json({
      response,
      sources,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process chat' },
      { status: 500 }
    );
  }
}
