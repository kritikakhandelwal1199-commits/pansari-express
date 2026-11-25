'use client';
/**
 * Help chat for every surface (shop, walk-in store, seller portal).
 * Answers come from the shared local intent engine; live answers (order status,
 * stock, HSN) are fetched through the DataClient; "talk to a person" raises a
 * support ticket with the transcript.
 */
import * as React from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, MessageCircleQuestion, Send, X } from 'lucide-react';
import { reply as botReply, suggestionsFor, type ChatAction, type Role, type TicketCategory } from '@pansari/shared';
import { useData } from '@/lib/data/provider';
import { ORDER_STATUS } from '@/lib/labels';
import { cn, errMsg, rs } from '@/lib/utils';

interface Msg {
  from: 'user' | 'bot';
  text: string;
  at: number;
  links?: { path: string; label: string }[];
}

export function ChatWidget({ role, storeId, className, lift }: { role: Role | 'anonymous'; storeId?: string | null; className?: string; lift?: boolean }) {
  const data = useData();
  const [open, setOpen] = React.useState(false);
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [misses, setMisses] = React.useState(0);
  const [lastOrderId, setLastOrderId] = React.useState<string | null>(null);
  const [ticketed, setTicketed] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const operator = role === 'seller' || role === 'staff' || role === 'super_admin' || role === 'compliance';

  React.useEffect(() => {
    if (open && msgs.length === 0) setMsgs([{ from: 'bot', at: Date.now(), text: operator ? 'Namaste! Ask me about billing, stock, HSN codes or QR posters.' : 'Namaste! Ask me about your order, payment, bill or delivery. Hindi-English mix is fine.' }]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pages can open the chat from their own button (the shop header on phones).
  React.useEffect(() => {
    const on = () => setOpen((v) => !v);
    window.addEventListener('px-help-toggle', on);
    return () => window.removeEventListener('px-help-toggle', on);
  }, []);
  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  const add = (m: Omit<Msg, 'at'>) => setMsgs((x) => [...x, { ...m, at: Date.now() }]);

  async function escalate(category: TicketCategory, summary: string, transcript: Msg[]) {
    if (ticketed) return 'A ticket is already open for this chat — the shop will reply soon.';
    try {
      const r = await data.createSupportTicket({ category, subject: summary || 'Help request', orderId: lastOrderId, storeId: storeId ?? null, transcript: transcript.map((m) => ({ from: m.from, text: m.text, at: m.at })) });
      setTicketed(true);
      return `Ticket ${r.ticketId} created. Someone from the shop will contact you.`;
    } catch (e) {
      const m = errMsg(e);
      return /sign in/i.test(m) ? 'Please sign in first so the shop can contact you, then ask again.' : `Could not create a ticket: ${m}`;
    }
  }

  async function runAction(a: ChatAction, transcript: Msg[]): Promise<Omit<Msg, 'at'> | null> {
    switch (a.type) {
      case 'OPEN':
        return null;
      case 'ORDER_STATUS': {
        if (operator) return { from: 'bot', text: 'Open "Online orders" to see every order for your store.', links: [{ path: '/seller/orders', label: 'Online orders' }] };
        try {
          const o = a.orderId ? await data.getOrder(a.orderId) : (await data.myOrders())[0] ?? null;
          if (!o) return { from: 'bot', text: a.orderId ? 'I could not find that order on your account.' : 'You have no delivery orders yet.' };
          setLastOrderId(o.orderId);
          const st = ORDER_STATUS[o.status].label;
          const eta = o.etaMinutes && !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status) ? ` Expected within about ${o.etaMinutes} minutes of placing.` : '';
          const otp = o.deliveryOtp ? ` Your delivery code is ${o.deliveryOtp}.` : '';
          return { from: 'bot', text: `Order ${o.orderId} (${rs(o.grandTotal)}) is ${st.toLowerCase()}.${eta}${otp}`, links: [{ path: `/shop/orders/view?id=${o.orderId}`, label: 'Open order' }] };
        } catch {
          return { from: 'bot', text: 'Sign in to see your orders.', links: [{ path: '/login?next=/shop/orders', label: 'Sign in' }] };
        }
      }
      case 'STOCK_CHECK': {
        try {
          const rows = operator && storeId ? await data.listInventory(storeId) : storeId ? await data.shopCatalog(storeId) : [];
          const q = a.query.toLowerCase();
          const hits = rows.filter((r) => `${r.product.name} ${r.product.nameHi ?? ''} ${r.product.brand ?? ''}`.toLowerCase().includes(q)).slice(0, 4);
          if (!hits.length) return { from: 'bot', text: `I could not find "${a.query}" here. Try another name, or ask a person.` };
          return { from: 'bot', text: hits.map((h) => `${h.product.name}: ${h.onHand > 0 ? `${h.onHand} in stock at ${rs(h.sellingPrice)}` : 'out of stock'}`).join('\n') };
        } catch (e) {
          return { from: 'bot', text: errMsg(e) };
        }
      }
      case 'LOW_STOCK': {
        if (!storeId) return { from: 'bot', text: 'Choose a store first.' };
        const rows = (await data.listInventory(storeId)).filter((r) => r.lowStock);
        return { from: 'bot', text: rows.length ? rows.slice(0, 8).map((r) => `${r.product.name}: ${r.onHand} left (reorder at ${r.reorderThreshold})`).join('\n') : 'Nothing is below its reorder level. 👍', links: [{ path: '/seller/inventory', label: 'Open stock' }] };
      }
      case 'HSN_LOOKUP': {
        const list = await data.listHsn();
        const q = a.query.toLowerCase();
        const hits = list.filter((h) => h.hsnCode.startsWith(q) || h.description.toLowerCase().includes(q) || q.split(' ').some((w) => w.length > 3 && h.description.toLowerCase().includes(w))).slice(0, 5);
        return { from: 'bot', text: hits.length ? hits.map((h) => `${h.hsnCode} — ${h.description}: GST ${h.gstSlab}%`).join('\n') : `No HSN in the tax master matches "${a.query}". Ask the admin to add it with its GST rate.` };
      }
      case 'ESCALATE':
        return { from: 'bot', text: await escalate(a.category, a.summary, transcript) };
    }
  }

  async function send(t: string) {
    const q = t.trim();
    if (!q || busy) return;
    setText('');
    const userMsg: Msg = { from: 'user', text: q, at: Date.now() };
    const transcript = [...msgs, userMsg];
    setMsgs(transcript);
    setBusy(true);
    try {
      const r = botReply(q, { role, misses, lastOrderId });
      setMisses(r.intent === 'unknown' ? misses + 1 : 0);
      const links = r.actions.filter((a): a is Extract<ChatAction, { type: 'OPEN' }> => a.type === 'OPEN').map((a) => ({ path: a.path, label: a.label }));
      const botMsg: Msg = { from: 'bot', text: r.text, at: Date.now(), links };
      setMsgs((x) => [...x, botMsg]);
      for (const a of r.actions) {
        const out = await runAction(a, [...transcript, botMsg]);
        if (out) add(out);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn('no-print fixed right-4 z-40 flex h-12 items-center gap-2 rounded-full bg-kum px-4 font-bold text-kum-ink shadow-xl', lift ? 'bottom-6 hidden sm:flex' : 'bottom-6', className)}
        aria-expanded={open}
        aria-label="Help"
      >
        {open ? <X className="size-5" /> : <MessageCircleQuestion className="size-5" />}
        <span className="hidden sm:inline">{open ? 'Close' : 'Help'}</span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className={cn('no-print fixed inset-x-3 z-50 flex max-h-[70dvh] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl sm:left-auto sm:right-4 sm:w-[380px]', lift ? 'top-16 bottom-auto sm:top-auto sm:bottom-20' : 'bottom-20')}
            aria-label="Help chat"
          >
            <header className="flex items-center justify-between bg-kum px-4 py-3 text-kum-ink">
              <div>
                <div className="font-bold">Pansari help</div>
                <div className="text-[12px] text-white/80">Instant answers · a person if needed</div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close help" className="rounded-full p-1.5 hover:bg-white/10">
                <X className="size-5" />
              </button>
            </header>
            <div ref={listRef} className="grid flex-1 content-start gap-2 overflow-y-auto p-3" aria-live="polite">
              {msgs.map((m, i) => (
                <div key={i} className={cn('max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-[14px]', m.from === 'user' ? 'justify-self-end bg-haldi/30' : 'justify-self-start bg-surface-2')}>
                  {m.text}
                  {m.links?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.links.map((l) => (
                        <Link key={l.path} href={l.path} onClick={() => setOpen(false)} className="rounded-full border border-kum px-2.5 py-1 text-[12px] font-bold text-kum">
                          {l.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {busy ? <Loader2 className="size-4 animate-spin text-muted" aria-label="Thinking" /> : null}
            </div>
            <div className="flex gap-1.5 overflow-x-auto border-t border-line px-3 py-2">
              {suggestionsFor(role).map((s) => (
                <button key={s} onClick={() => send(s)} className="h-8 shrink-0 rounded-full border border-line px-3 text-[12px] font-semibold hover:border-haldi">
                  {s}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
            >
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={400} placeholder="Type your question…" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3" aria-label="Your question" />
              <button type="submit" disabled={!text.trim() || busy} className="grid size-11 place-items-center rounded-xl bg-kum text-kum-ink disabled:opacity-40" aria-label="Send">
                <Send className="size-4" />
              </button>
            </form>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </>
  );
}
