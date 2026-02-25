import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Client for browser usage
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client for server-side operations (with service role key)
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : supabase;

export type Video = {
  id: string;
  youtube_id: string;
  title: string;
  channel_name: string;
  url: string;
  thumbnail_url?: string;
  duration?: number;
  created_at: string;
};

export type Chunk = {
  id: string;
  video_id: string;
  content: string;
  start_time: number;
  end_time: number;
  embedding?: number[];
  created_at: string;
};

export type ChunkWithVideo = Chunk & {
  video: Video;
};
