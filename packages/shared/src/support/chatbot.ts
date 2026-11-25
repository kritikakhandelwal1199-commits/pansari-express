/**
 * Support chatbot — a small, local intent engine (no external AI calls in API-hold
 * mode). It understands simple English and Hinglish, answers from fixed help
 * text, asks the app to fetch live data through "actions", and escalates to a
 * human by creating a support_tickets document.
 *
 * An LLM can later be plugged in behind `fallback` without changing the widget.
 */
import type { Role } from '../roles.js';

export type ChatAction =
  | { type: 'ORDER_STATUS'; orderId?: string }
  | { type: 'STOCK_CHECK'; query: string }
  | { type: 'LOW_STOCK' }
  | { type: 'HSN_LOOKUP'; query: string }
  | { type: 'ESCALATE'; category: TicketCategory; summary: string }
  | { type: 'OPEN'; path: string; label: string };

export type TicketCategory = 'ORDER' | 'PAYMENT' | 'INVOICE' | 'DAMAGED_ITEM' | 'STOCK' | 'KYC' | 'OTHER';

export type IntentId =
  | 'greet'
  | 'thanks'
  | 'order_status'
  | 'cancel_order'
  | 'refund'
  | 'damaged'
  | 'missing_item'
  | 'delivery_time'
  | 'delivery_fee'
  | 'payment_failed'
  | 'cod'
  | 'wallet'
  | 'invoice'
  | 'gst_explain'
  | 'walkin_qr'
  | 'stock_check'
  | 'low_stock'
  | 'hsn_help'
  | 'pos_help'
  | 'inward_help'
  | 'price_help'
  | 'human'
  | 'unknown';

export interface BotReply {
  intent: IntentId;
  text: string;
  actions: ChatAction[];
  suggestions: string[];
  escalate: boolean;
}

export interface BotContext {
  role: Role | 'anonymous';
  /** Count of consecutive turns the bot could not help with. */
  misses: number;
  lastOrderId?: string | null;
}

type Audience = 'customer' | 'operator' | 'any';

interface Intent {
  id: IntentId;
  audience: Audience;
  /** Each group is one idea; any word in a group matching scores the group once. */
  keywords: string[][];
  /** Phrases that clearly mean this intent (big boost). */
  phrases?: string[];
}

const INTENTS: Intent[] = [
  { id: 'greet', audience: 'any', keywords: [['hi', 'hello', 'hey', 'namaste', 'namaskar', 'hii', 'helo', 'ram ram', 'jai shree krishna']] },
  { id: 'thanks', audience: 'any', keywords: [['thanks', 'thank', 'thx', 'dhanyavad', 'shukriya', 'ok thanks', 'theek hai']] },
  { id: 'human', audience: 'any', keywords: [['agent', 'human', 'person', 'insaan', 'executive', 'manager', 'complaint', 'shikayat', 'call me', 'baat karni']], phrases: ['talk to', 'speak to', 'customer care', 'real person'] },
  { id: 'order_status', audience: 'customer', keywords: [['order', 'parcel', 'saman', 'samaan', 'delivery'], ['where', 'status', 'kahan', 'kaha', 'track', 'kab', 'aaya', 'pahuncha', 'abhi tak']], phrases: ['where is my order', 'order kahan', 'track order', 'order status'] },
  { id: 'cancel_order', audience: 'customer', keywords: [['cancel', 'radd', 'nahi chahiye', 'band karo']], phrases: ['cancel order', 'cancel my order'] },
  { id: 'refund', audience: 'customer', keywords: [['refund', 'paisa wapas', 'money back', 'paise wapas', 'return money']] },
  { id: 'damaged', audience: 'customer', keywords: [['damaged', 'broken', 'tuta', 'toota', 'leak', 'kharab', 'expired', 'spoiled', 'phata', 'ganda']], phrases: ['damaged', 'broken', 'toota', 'tuta', 'leak', 'kharab', 'expired'] },
  { id: 'missing_item', audience: 'customer', keywords: [['missing', 'nahi aaya', 'kam aaya', 'short', 'less', 'item nahi', 'galat', 'wrong item']], phrases: ['missing', 'nahi aaya', 'kam aaya', 'wrong item'] },
  { id: 'delivery_time', audience: 'customer', keywords: [['how long', 'kitna time', 'kitni der', 'eta', 'minutes', '10 min', 'fast', 'jaldi']] },
  { id: 'delivery_fee', audience: 'customer', keywords: [['delivery fee', 'delivery charge', 'shipping', 'free delivery', 'charges']] },
  { id: 'payment_failed', audience: 'any', keywords: [['payment', 'upi', 'paid', 'card', 'gpay', 'phonepe', 'paytm'], ['failed', 'fail', 'deducted', 'kat gaya', 'cut', 'stuck', 'pending', 'nahi hua']] },
  { id: 'cod', audience: 'customer', keywords: [['cod', 'cash on delivery', 'cash', 'nakad']] },
  { id: 'wallet', audience: 'customer', keywords: [['wallet', 'balance', 'add money', 'topup', 'top up']] },
  { id: 'invoice', audience: 'any', keywords: [['invoice', 'bill', 'receipt', 'pakka bill', 'gst bill', 'tax invoice']] },
  { id: 'gst_explain', audience: 'any', keywords: [['gst', 'cgst', 'sgst', 'igst', 'tax'], ['what', 'why', 'kya', 'kyun', 'explain', 'kitna', 'how']] },
  { id: 'walkin_qr', audience: 'any', keywords: [['qr', 'scan', 'poster', 'walk in', 'walkin', 'counter'], ['store', 'shop', 'dukan', 'cart', 'checkout', 'pay', 'kaise']] },
  { id: 'stock_check', audience: 'any', keywords: [['stock', 'available', 'milega', 'hai kya', 'in stock', 'mil jayega', 'available hai']] },
  { id: 'low_stock', audience: 'operator', keywords: [['low stock', 'reorder', 'khatam', 'running out', 'short stock', 'kam stock']], phrases: ['low stock', 'reorder', 'kam stock', 'khatam'] },
  { id: 'hsn_help', audience: 'operator', keywords: [['hsn', 'sac', 'hsn code', 'tax rate', 'gst rate', 'slab']] },
  { id: 'pos_help', audience: 'operator', keywords: [['pos', 'billing', 'bill banana', 'counter', 'b2b', 'gstin'], ['how', 'kaise', 'help', 'make', 'create', 'banaye']] },
  { id: 'inward_help', audience: 'operator', keywords: [['inward', 'receive', 'purchase', 'maal aaya', 'stock add', 'add stock', 'batch', 'godown']] },
  { id: 'price_help', audience: 'operator', keywords: [['price', 'rate', 'mrp', 'daam', 'selling price'], ['change', 'set', 'update', 'badalna', 'kaise']] },
];

const STOP = new Set(['the', 'a', 'an', 'is', 'my', 'me', 'i', 'to', 'of', 'please', 'pls', 'plz', 'ka', 'ki', 'ke', 'hai', 'mera', 'meri', 'mere', 'ji', 'bhai', 'sir']);

export function normalise(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

const isOperator = (r: BotContext['role']) => r === 'seller' || r === 'staff' || r === 'super_admin' || r === 'compliance';

function has(text: string, kw: string): boolean {
  if (kw.includes(' ')) return text.includes(kw);
  return new RegExp(`(^|\\s)${kw}(\\s|$)`).test(text);
}

export function classify(text: string, role: BotContext['role']): { intent: IntentId; score: number } {
  const t = normalise(text);
  if (!t) return { intent: 'unknown', score: 0 };
  const op = isOperator(role);
  let best: { intent: IntentId; score: number } = { intent: 'unknown', score: 0 };
  for (const it of INTENTS) {
    if (it.audience === 'customer' && op && it.id !== 'stock_check') continue;
    if (it.audience === 'operator' && !op) continue;
    let score = 0;
    for (const g of it.keywords) if (g.some((k) => has(t, k))) score += 1;
    // multi-group intents need every group, unless a phrase matched
    const needAll = it.keywords.length > 1;
    const phrase = (it.phrases ?? []).some((p) => t.includes(p));
    if (phrase) score += 2;
    else if (needAll && score < it.keywords.length) score = score > 0 ? 0.5 : 0;
    score += score > 0 ? it.keywords.length * 0.01 : 0; // prefer more specific intents on ties
    if (score > best.score) best = { intent: it.id, score };
  }
  return best.score >= 1 ? best : { intent: 'unknown', score: best.score };
}

/** Pull an order / invoice reference like "o-3f2ab" or "PX/26-27/000012" out of a message. */
export function extractOrderId(text: string): string | undefined {
  return /\bo-[a-z0-9]{3,24}\b/i.exec(text ?? '')?.[0]?.toLowerCase();
}

/** Words left after removing intent words — used as the product search term. */
export function productQuery(text: string): string {
  const drop = new Set(['stock', 'available', 'milega', 'kya', 'in', 'hai', 'mil', 'jayega', 'do', 'you', 'have', 'check', 'is', 'there', 'any', 'hsn', 'code', 'for', 'gst', 'rate', 'of', 'sac', 'slab', 'what']);
  return normalise(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w) && !drop.has(w))
    .join(' ');
}

const CUSTOMER_SUGGESTIONS = ['Where is my order?', 'Cancel my order', 'Item damaged', 'Delivery charges', 'Talk to a person'];
const OPERATOR_SUGGESTIONS = ['Low stock items', 'How to make a B2B bill', 'Find HSN code', 'Receive stock', 'Talk to a person'];

export function suggestionsFor(role: BotContext['role']): string[] {
  return isOperator(role) ? OPERATOR_SUGGESTIONS : CUSTOMER_SUGGESTIONS;
}

export function reply(text: string, ctx: BotContext): BotReply {
  const op = isOperator(ctx.role);
  const { intent } = classify(text, ctx.role);
  const base = { intent, actions: [] as ChatAction[], suggestions: suggestionsFor(ctx.role), escalate: false };
  const orderId = extractOrderId(text) ?? ctx.lastOrderId ?? undefined;
  const summary = normalise(text).slice(0, 140);

  switch (intent) {
    case 'greet':
      return { ...base, text: op ? 'Namaste! I can help with billing, stock, HSN codes and QR posters. What do you need?' : 'Namaste! I can help with your orders, payments, bills and delivery. What do you need?' };
    case 'thanks':
      return { ...base, text: 'Happy to help. Anything else?' };
    case 'human':
      return { ...base, text: 'I am creating a support ticket so a person from the shop can call you back.', escalate: true, actions: [{ type: 'ESCALATE', category: 'OTHER', summary }] };
    case 'order_status':
      return { ...base, text: orderId ? 'Checking that order for you…' : 'Checking your latest order…', actions: [{ type: 'ORDER_STATUS', orderId }] };
    case 'cancel_order':
      return {
        ...base,
        text: 'You can cancel an order yourself until the store starts packing it. Open the order and tap "Cancel order". If you paid online, the money goes back to your Pansari wallet instantly.',
        actions: [{ type: 'OPEN', path: '/orders', label: 'Open my orders' }],
      };
    case 'refund':
      return { ...base, text: 'Refunds for cancelled orders go to your Pansari wallet right away and can be used on the next order. For a problem with a delivered order, I will raise a ticket.', actions: [{ type: 'OPEN', path: '/account', label: 'See wallet' }, { type: 'ESCALATE', category: 'PAYMENT', summary }] };
    case 'damaged':
      return { ...base, text: 'Sorry about that. I am raising a damaged-item ticket for the shop. Please keep the item and packet — the shop will call you within a few hours to replace or refund it.', escalate: true, actions: [{ type: 'ESCALATE', category: 'DAMAGED_ITEM', summary }] };
    case 'missing_item':
      return { ...base, text: 'Sorry, something is missing or wrong. I am raising a ticket with the shop so they can check the packing record and fix it.', escalate: true, actions: [{ type: 'ESCALATE', category: 'ORDER', summary }] };
    case 'delivery_time':
      return { ...base, text: 'Most orders reach you in 10–20 minutes from the nearest store. You can see the live time on the checkout page and on the order page.' };
    case 'delivery_fee':
      return { ...base, text: 'A small delivery charge applies on small orders and is free above the amount shown in your cart. The charge appears on your GST invoice as a separate line.' };
    case 'payment_failed':
      return { ...base, text: 'If money was taken but the order failed, it is returned automatically (in test mode nothing is really charged). If it still looks wrong, I will raise a payment ticket.', actions: [{ type: 'ESCALATE', category: 'PAYMENT', summary }] };
    case 'cod':
      return { ...base, text: 'Cash on delivery is available on orders up to ₹3,000. Please keep change ready and share the 4-digit delivery code with the rider.' };
    case 'wallet':
      return { ...base, text: 'Your wallet holds refunds and money you add. You can pay a whole order from it at checkout.', actions: [{ type: 'OPEN', path: '/account', label: 'Open wallet' }] };
    case 'invoice':
      return op
        ? { ...base, text: 'All bills are under Invoices. You can download A4 or thermal PDFs and the GSTR-1 summary for any date range.', actions: [{ type: 'OPEN', path: '/seller/invoices', label: 'Open invoices' }] }
        : { ...base, text: 'Your GST invoice is ready once the order leaves the store. Open the order to download it.', actions: [{ type: 'OPEN', path: '/orders', label: 'Open my orders' }] };
    case 'gst_explain':
      return { ...base, text: 'GST depends on each product\'s HSN code. Inside Rajasthan the tax is split half CGST and half SGST; delivery to another state is charged as IGST. Prices on the shelf already include GST unless marked otherwise.' };
    case 'walkin_qr':
      return op
        ? { ...base, text: 'Print the store poster from "Store QR". Customers scan it, add items on their phone and show a checkout QR. At the POS tap "Scan customer QR" to load their cart and bill it.', actions: [{ type: 'OPEN', path: '/seller/qr', label: 'Store QR posters' }] }
        : { ...base, text: 'In the shop, scan the QR poster, add items on your phone, then show the checkout QR at the counter — or pay by UPI on your phone. You get a GST bill either way.' };
    case 'stock_check': {
      const q = productQuery(text);
      return q ? { ...base, text: `Looking for "${q}"…`, actions: [{ type: 'STOCK_CHECK', query: q }] } : { ...base, text: 'Which item should I check? For example: "is kesar available".' };
    }
    case 'low_stock':
      return { ...base, text: 'Fetching items at or below their reorder level…', actions: [{ type: 'LOW_STOCK' }] };
    case 'hsn_help': {
      const q = productQuery(text);
      return { ...base, text: q ? `Searching the tax master for "${q}"…` : 'Tell me the item or HSN, e.g. "hsn for almonds".', actions: q ? [{ type: 'HSN_LOOKUP', query: q }] : [] };
    }
    case 'pos_help':
      return { ...base, text: 'Open POS, scan or search items, then tap "Bill & pay". For a business buyer, enter their GSTIN — the bill becomes B2B with an IRN (test mode). Cash, UPI and card are supported.', actions: [{ type: 'OPEN', path: '/pos', label: 'Open POS' }] };
    case 'inward_help':
      return { ...base, text: 'Go to Inventory → Receive stock. Enter batch number, expiry, quantity, purchase price, MRP and the supplier bill number. Stock is sold oldest-expiry first automatically.', actions: [{ type: 'OPEN', path: '/seller/inventory', label: 'Open inventory' }] };
    case 'price_help':
      return { ...base, text: 'Only the shop owner can change selling prices, in Inventory. The price can never be above MRP.', actions: [{ type: 'OPEN', path: '/seller/inventory', label: 'Open inventory' }] };
    case 'unknown':
    default: {
      const misses = ctx.misses + 1;
      if (misses >= 2) return { ...base, intent: 'unknown', text: 'I could not understand that, so I am passing it to a person at the shop. They will reply soon.', escalate: true, actions: [{ type: 'ESCALATE', category: 'OTHER', summary }] };
      return { ...base, intent: 'unknown', text: 'Sorry, I did not get that. Try one of these, or write it differently:' };
    }
  }
}
