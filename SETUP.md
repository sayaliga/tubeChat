# TubeChat Setup Guide

## Quick Start for Same-Day Deployment

### Prerequisites
- Node.js 20+ (required for Next.js 16)
- Supabase account (free tier)
- OpenAI API key
- Vercel account (free tier)

---

## Step 1: Create Supabase Project (5 minutes)

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project (note the password - you'll need it)
3. Wait for the project to be ready (~2 minutes)
4. Go to **Settings > API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

### Run Database Migration

1. Go to **SQL Editor** in your Supabase dashboard
2. Click "New Query"
3. Copy and paste the contents of `supabase/migrations/001_initial_schema.sql`
4. Click "Run" to execute

---

## Step 2: Set Up Environment Variables

Create a `.env.local` file in the project root:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...

# OpenAI
OPENAI_API_KEY=sk-...
```

---

## Step 3: Test Locally

```bash
# Install dependencies (if not done)
npm install

# Run development server
npm run dev
```

Visit http://localhost:3000

---

## Step 4: Deploy to Vercel (5 minutes)

### Option A: Vercel CLI
```bash
npm i -g vercel
vercel
```

### Option B: GitHub Integration
1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your GitHub repository
4. Add environment variables in Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
5. Deploy!

---

## Step 5: Google AdSense Setup (Later)

AdSense approval takes days/weeks. For now, placeholder ads are shown.

When approved:
1. Get your publisher ID (ca-pub-XXXXXXXXXX)
2. Update `src/app/layout.tsx` - uncomment the AdSense script
3. Create ad units in AdSense dashboard
4. Replace placeholder divs with actual ad code

---

## Usage

1. **Index a Video**: Paste a YouTube URL like `https://youtube.com/watch?v=VIDEO_ID`
2. **Index a Channel**: Paste a channel URL like `https://youtube.com/@channelname`
3. **Ask Questions**: "Which video covers OpenClaw setup?"

---

## Cost Estimates

| Service | Free Tier | Your Usage |
|---------|-----------|------------|
| Supabase | 500MB database | Plenty for thousands of videos |
| Vercel | 100GB bandwidth | Good for moderate traffic |
| OpenAI Embeddings | N/A | ~$0.02 per 1M tokens |
| OpenAI Chat | N/A | ~$0.15 per 1M tokens |

**Realistic monthly cost**: $5-20 depending on usage

---

## Troubleshooting

### "No transcript available"
- Some videos don't have captions enabled
- Try a different video

### "Could not find channel"
- Make sure the channel URL is correct
- Try using the channel ID format: `youtube.com/channel/UC...`

### Search not finding content
- Make sure videos are indexed first
- Check Supabase for stored data

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Next.js   │────▶│  Supabase   │────▶│   pgvector  │
│   Frontend  │     │  (Postgres) │     │ (embeddings)│
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       │            ┌─────────────┐            │
       └───────────▶│   OpenAI    │◀───────────┘
                    │ (embeddings │
                    │  + chat)    │
                    └─────────────┘
```
