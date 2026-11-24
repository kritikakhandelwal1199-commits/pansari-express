/**
 * Preview-only stand-ins for next/link and next/navigation: an in-memory router,
 * so the real app pages run inside a single-file artifact without a Next server.
 */
import * as React from 'react';

type Listener = () => void;
let current = '/';
const listeners = new Set<Listener>();
export function navigate(to: string) {
  current = to.startsWith('/') ? to : '/' + to;
  listeners.forEach((l) => l());
  window.scrollTo?.(0, 0);
}
function usePath() {
  return React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
const split = (p: string) => {
  const i = p.indexOf('?');
  return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)];
};

export function usePathname() {
  return split(usePath())[0];
}
export function useSearchParams() {
  const q = split(usePath())[1];
  return React.useMemo(() => new URLSearchParams(q), [q]);
}
export function useParams<T extends Record<string, string>>(): T {
  const p = usePathname();
  const m = /^\/store\/([^/]+)/.exec(p);
  return (m ? { storeId: decodeURIComponent(m[1]!) } : {}) as T;
}
export function useRouter() {
  return { push: navigate, replace: navigate, back: () => navigate('/'), refresh: () => undefined, prefetch: () => undefined };
}
export function redirect(to: string): never {
  navigate(to);
  throw new Error('redirect');
}

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, onClick, ...rest }, ref) {
  return (
    <a
      ref={ref}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        navigate(href);
      }}
      {...rest}
    />
  );
});
export default Link;
