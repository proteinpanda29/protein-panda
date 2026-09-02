'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { siteConfig } from '@/lib/siteConfig';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const STARTERS = [
  'What should I order to hit my protein goal today?',
  'What can I eat that has no dairy or nuts?',
  'What should I have before a workout?',
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: `Hey, I'm the ${siteConfig.businessName} nutrition assistant ${siteConfig.mascotEmoji} Ask me what to order, how much protein you have left today, or what fits your goal.` },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      // Only user/assistant turns go to the API — strip the initial greeting's
      // exact wording isn't required, but keep payload to real conversation.
      const { reply } = await api.aiChat(nextMessages);
      setMessages([...nextMessages, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mx-auto flex h-[calc(100vh-140px)] max-w-2xl flex-col px-4 py-6">
      <h1 className="mb-4 text-xl font-extrabold uppercase tracking-tight text-brand-black">🐼 Nutrition Assistant</h1>

      <div className="flex-1 overflow-y-auto rounded-2xl border border-brand-grey bg-brand-white p-4">
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                  m.role === 'user' ? 'bg-brand-primary text-brand-white' : 'bg-brand-bg text-brand-black'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-brand-bg px-4 py-2 text-sm text-brand-body">Thinking…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {messages.length === 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-brand-grey px-3 py-2 text-xs font-semibold text-brand-body hover:border-brand-primary hover:text-brand-primary"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your nutrition, goals, or the menu…"
          className="flex-1 rounded-full border border-brand-grey bg-brand-white px-4 py-3 text-sm text-brand-black outline-none focus:border-brand-primary"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-brand-primary px-5 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </section>
  );
}
