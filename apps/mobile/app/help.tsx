import * as React from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { reply, suggestionsFor, type ChatAction } from '@pansari/shared';
import { rs } from '@/components/ui';
import { useData } from '@/lib/data';
import { ORDER_STATUS } from '@/lib/labels';
import { useShop } from '@/lib/shop';

interface Msg { from: 'user' | 'bot'; text: string; at: number; open?: string }
const ROUTES: Record<string, string> = { '/orders': '/orders', '/account': '/account', '/shop/orders': '/orders' };

export default function Help() {
  const { client, user } = useData();
  const shop = useShop();
  const role = user?.role ?? 'anonymous';
  const [msgs, setMsgs] = React.useState<Msg[]>([{ from: 'bot', at: Date.now(), text: 'Namaste! Ask me about your order, payment, bill or delivery. Hindi-English mix is fine.' }]);
  const [text, setText] = React.useState('');
  const [misses, setMisses] = React.useState(0);
  const [ticketed, setTicketed] = React.useState(false);
  const push = (m: Omit<Msg, 'at'>) => setMsgs((x) => [...x, { ...m, at: Date.now() }]);

  async function act(a: ChatAction, transcript: Msg[]) {
    if (a.type === 'ORDER_STATUS') {
      if (!shop.isCustomer) return push({ from: 'bot', text: 'Sign in to see your orders.' });
      const o = a.orderId ? await client.getOrder(a.orderId) : (await client.myOrders())[0];
      if (!o) return push({ from: 'bot', text: 'You have no delivery orders yet.' });
      push({ from: 'bot', text: `Order ${o.orderId} (${rs(o.grandTotal)}) is ${ORDER_STATUS[o.status].label.toLowerCase()}.${o.deliveryOtp ? ` Your delivery code is ${o.deliveryOtp}.` : ''}`, open: `/order/${o.orderId}` });
    } else if (a.type === 'STOCK_CHECK') {
      const hits = shop.catalog.filter((r) => `${r.product.name} ${r.product.nameHi ?? ''}`.toLowerCase().includes(a.query.toLowerCase())).slice(0, 4);
      push({ from: 'bot', text: hits.length ? hits.map((h) => `${h.product.name}: ${h.onHand > 0 ? `${h.onHand} in stock at ${rs(h.sellingPrice)}` : 'out of stock'}`).join('\n') : `I could not find "${a.query}".` });
    } else if (a.type === 'ESCALATE') {
      if (ticketed) return push({ from: 'bot', text: 'A ticket is already open for this chat.' });
      try {
        const r = await client.createSupportTicket({ category: a.category, subject: a.summary || 'Help request', storeId: shop.storeId, transcript });
        setTicketed(true);
        push({ from: 'bot', text: `Ticket ${r.ticketId} created. Someone from the shop will contact you.` });
      } catch {
        push({ from: 'bot', text: 'Please sign in first so the shop can contact you.' });
      }
    } else if (a.type === 'OPEN' && ROUTES[a.path]) {
      push({ from: 'bot', text: a.label, open: ROUTES[a.path] });
    }
  }

  async function send(q: string) {
    if (!q.trim()) return;
    setText('');
    const userMsg: Msg = { from: 'user', text: q.trim(), at: Date.now() };
    const r = reply(q, { role, misses });
    setMisses(r.intent === 'unknown' ? misses + 1 : 0);
    const bot: Msg = { from: 'bot', text: r.text, at: Date.now() };
    const transcript = [...msgs, userMsg, bot];
    setMsgs(transcript);
    for (const a of r.actions) await act(a, transcript);
  }

  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        data={msgs}
        keyExtractor={(m, i) => `${i}-${m.at}`}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item: m }) => (
          <Pressable disabled={!m.open} onPress={() => m.open && router.push(m.open as never)} className={`max-w-[85%] rounded-2xl px-3 py-2 ${m.from === 'user' ? 'self-end bg-[#fbe7a6]' : 'self-start bg-surface-2'}`}>
            <Text className="text-[14px] text-ink">{m.text}</Text>
            {m.open ? <Text className="mt-1 text-xs font-bold text-kum">Open ›</Text> : null}
          </Pressable>
        )}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="max-h-12 border-t border-line" contentContainerStyle={{ gap: 6, padding: 8 }}>
        {suggestionsFor(role).map((s) => (
          <Pressable key={s} onPress={() => void send(s)} className="h-8 justify-center rounded-full border border-line px-3">
            <Text className="text-xs font-semibold text-ink">{s}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View className="flex-row gap-2 border-t border-line p-3">
        <TextInput value={text} onChangeText={setText} onSubmitEditing={() => void send(text)} placeholder="Type your question…" placeholderTextColor="#b3a090" className="h-11 flex-1 rounded-xl border border-line bg-surface px-3 text-ink" />
        <Pressable onPress={() => void send(text)} className="h-11 justify-center rounded-xl bg-kum px-4">
          <Text className="font-bold text-white">Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
