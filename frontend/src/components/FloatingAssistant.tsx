'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { siteConfig } from '@/lib/siteConfig';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function FloatingAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: `Hey! I'm the ${siteConfig.businessName} assistant ${siteConfig.mascotEmoji} Ask me what to order or how much protein you have left today.` },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Admin/delivery are staff accounts, not customers — the assistant
  // endpoint is customer-only, so don't show the widget on those pages.
  if (pathname?.startsWith('/admin') || pathname?.startsWith('/delivery')) return null;

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('pp_token') : null;
    if (!token) {
      setError('Log in to chat with the assistant.');
      return;
    }

    const next: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      const { reply } = await api.aiChat(next);
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <div className="mb-3 flex h-[420px] w-[320px] flex-col overflow-hidden rounded-2xl border border-brand-grey bg-brand-white shadow-2xl sm:w-[360px]">
          <div className="flex items-center justify-between bg-brand-black px-4 py-3">
            <span className="text-sm font-bold text-brand-white">{siteConfig.mascotEmoji} {siteConfig.assistantName}</span>
            <button onClick={() => setOpen(false)} className="text-brand-white/70 hover:text-brand-white">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="flex flex-col gap-2">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                      m.role === 'user' ? 'bg-brand-primary text-brand-white' : 'bg-brand-bg text-brand-black'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-brand-bg px-3 py-2 text-sm text-brand-body">Thinking…</div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {error && (
            <p className="border-t border-brand-grey px-3 py-2 text-xs text-red-600">
              {error} {error.includes('Log in') && <a href="/login" className="underline">Go to login</a>}
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 border-t border-brand-grey p-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me anything…"
              className="flex-1 rounded-full border border-brand-grey px-3 py-2 text-sm text-brand-black outline-none focus:border-brand-primary"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
            >
              Send
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Open ${siteConfig.assistantName}`}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-primary text-3xl shadow-xl transition-transform hover:scale-105 hover:bg-brand-accent"
      >
        🐼
      </button>
    </div>
  );
}
