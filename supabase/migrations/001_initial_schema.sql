-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  duration INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Transcript chunks with embeddings
CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  start_time FLOAT NOT NULL,
  end_time FLOAT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster vector similarity search
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create index for video lookups
CREATE INDEX IF NOT EXISTS chunks_video_id_idx ON chunks(video_id);
CREATE INDEX IF NOT EXISTS videos_youtube_id_idx ON videos(youtube_id);

-- Function to match chunks by similarity
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  video_id UUID,
  content TEXT,
  start_time FLOAT,
  end_time FLOAT,
  video_title TEXT,
  youtube_id TEXT,
  channel_name TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.video_id,
    c.content,
    c.start_time,
    c.end_time,
    v.title AS video_title,
    v.youtube_id,
    v.channel_name,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  JOIN videos v ON c.video_id = v.id
  WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- RLS policies (enable if needed for production)
-- ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
