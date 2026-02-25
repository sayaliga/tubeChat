'use client';

import { useState, useRef, useEffect } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
};

type Source = {
  title: string;
  videoId: string;
  url: string;
  timestamp: string;
};

type IndexedVideo = {
  title: string;
  videoId: string;
  youtubeId: string;
  status: 'indexed' | 'ready' | 'failed';
  error?: string;
};

export default function Home() {
  const [url, setUrl] = useState('');
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexedVideos, setIndexedVideos] = useState<IndexedVideo[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const isChannelUrl = (url: string) => {
    return url.includes('/@') || url.includes('/channel/') || url.includes('/user/') || url.includes('/c/');
  };

  const handleIndex = async () => {
    if (!url.trim()) return;

    setIsIndexing(true);
    setError(null);

    try {
      const endpoint = isChannelUrl(url)
        ? '/api/ingest/channel'
        : '/api/ingest/video';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to index');
      }

      if (isChannelUrl(url)) {
        setIndexedVideos(prev => [
          ...prev,
          ...data.results.map((r: { videoId: string; youtubeId: string; title: string; status: string; error?: string }) => ({
            title: r.title,
            videoId: r.videoId,
            youtubeId: r.youtubeId,
            status: r.status,
            error: r.error,
          })),
        ]);
      } else {
        setIndexedVideos(prev => [
          ...prev,
          {
            title: data.title,
            videoId: data.videoId,
            youtubeId: data.youtubeId,
            status: data.alreadyIndexed ? 'ready' : 'indexed',
          },
        ]);
      }

      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to index content');
    } finally {
      setIsIndexing(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      // Get youtube IDs from session videos
      const youtubeIds = indexedVideos
        .filter(v => v.status === 'indexed' || v.status === 'ready')
        .map(v => v.youtubeId);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: messages.slice(-6),
          youtubeIds,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response');
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.response,
          sources: data.sources,
        },
      ]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Get the current video title (most recently added)
  const currentVideo = indexedVideos.length > 0 ? indexedVideos[indexedVideos.length - 1] : null;

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 flex flex-col">
      {/* Header */}
      <header className="bg-white/70 backdrop-blur-sm border-b border-purple-100 flex-shrink-0">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            <span className="text-purple-600">Tube</span>
            <span className="text-pink-500">Chat</span>
          </h1>
          {/* Google Ads Placeholder - Header Banner */}
          <div className="hidden md:flex w-[728px] h-[90px] bg-purple-50/50 border border-dashed border-purple-200 rounded-lg items-center justify-center text-purple-300 text-sm">
            Ad Space
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden max-w-6xl mx-auto px-4 py-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-full">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            {/* Add Video Section */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-purple-100 p-5">
              <h2 className="font-semibold text-purple-800 mb-1">Add a Video</h2>
              <p className="text-sm text-purple-500 mb-4">Paste a YouTube link and hit Go!</p>
              <div className="space-y-3">
                <input
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="Paste YouTube URL here..."
                  className="w-full px-4 py-3 bg-purple-50/50 border border-purple-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent placeholder:text-purple-300"
                  onKeyDown={e => e.key === 'Enter' && handleIndex()}
                />
                <button
                  onClick={handleIndex}
                  disabled={isIndexing || !url.trim()}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 px-4 rounded-xl text-sm font-medium hover:from-purple-600 hover:to-pink-600 disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  {isIndexing ? 'Adding...' : 'Go!'}
                </button>
              </div>
              {error && (
                <p className="mt-3 text-sm text-pink-600 bg-pink-50 p-2 rounded-lg">{error}</p>
              )}
              {currentVideo && (
                <p className="mt-3 text-sm text-green-600 bg-green-50 p-2 rounded-lg">
                  Chat is ready!
                </p>
              )}
            </div>

            {/* Sidebar Ad Space */}
            <div className="bg-purple-50/50 border border-dashed border-purple-200 rounded-2xl h-[250px] flex items-center justify-center text-purple-300 text-sm">
              Ad Space
            </div>
          </div>

          {/* Chat Area */}
          <div className="lg:col-span-3 bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-purple-100 flex flex-col h-full overflow-hidden">
            {/* Video Title Header */}
            {currentVideo && (
              <div className="border-b border-purple-100 px-5 py-3 flex-shrink-0">
                <p className="text-sm font-medium text-purple-800 truncate">
                  {currentVideo.title}
                </p>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <h3 className="text-xl font-semibold text-purple-800 mb-2">Hey there!</h3>
                    <p className="text-purple-500 max-w-md">
                      Add a YouTube video on the left, then ask me anything about it.
                      I&apos;ll search through the video to find your answers!
                    </p>
                    <div className="mt-6 space-y-2 text-sm text-purple-400">
                      <p className="font-medium">Try asking:</p>
                      <p className="italic bg-purple-50 rounded-lg py-2 px-4 inline-block">&quot;What was the main topic?&quot;</p>
                      <p className="italic bg-pink-50 rounded-lg py-2 px-4 inline-block">&quot;Summarize the key points&quot;</p>
                    </div>
                  </div>
                </div>
              ) : (
                messages.map((message, idx) => (
                  <div
                    key={idx}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl p-4 ${
                        message.role === 'user'
                          ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                          : 'bg-purple-50 text-purple-900 border border-purple-100'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      {message.sources && message.sources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-purple-200/50">
                          <p className="text-xs font-medium mb-2 text-purple-600">Watch these moments:</p>
                          <div className="space-y-1">
                            {message.sources.map((source, sidx) => (
                              <a
                                key={sidx}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-xs text-purple-600 hover:text-pink-600 hover:underline truncate"
                              >
                                {source.title} @ {source.timestamp}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-purple-50 rounded-2xl p-4 border border-purple-100">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-pink-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-purple-100 p-4 flex-shrink-0">
              <div className="flex space-x-3">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ask me anything about your videos..."
                  className="flex-1 px-4 py-3 bg-purple-50/50 border border-purple-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent placeholder:text-purple-300"
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  disabled={isLoading}
                />
                <button
                  onClick={handleSend}
                  disabled={isLoading || !input.trim()}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-3 rounded-xl font-medium hover:from-purple-600 hover:to-pink-600 disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white/50 backdrop-blur-sm border-t border-purple-100 flex-shrink-0">
        <div className="max-w-6xl mx-auto px-4 py-4 text-center text-sm text-purple-400">
          TubeChat - Chat with your favorite YouTube videos
        </div>
      </footer>
    </div>
  );
}
