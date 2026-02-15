import { useEffect, useState } from 'react';

const PREFERRED_BASE_PATH = '/aiyume_english';
const FORCE_BASE_HOST_PATTERN = /(^|\.)ai-yu-me\.com$/i;

const detectBasePath = () => {
  const pathname = window.location.pathname || '/';
  const hostname = window.location.hostname || '';
  if (FORCE_BASE_HOST_PATTERN.test(hostname)) {
    return PREFERRED_BASE_PATH;
  }
  if (pathname === PREFERRED_BASE_PATH || pathname.startsWith(`${PREFERRED_BASE_PATH}/`)) {
    return PREFERRED_BASE_PATH;
  }
  return '';
};

const ACTIVE_BASE_PATH = detectBasePath();

const ensureLeadingSlash = (value: string) => (value.startsWith('/') ? value : `/${value}`);
const normalizeAppPath = (value: string) => {
  const withLeadingSlash = ensureLeadingSlash(value || '/');
  if (withLeadingSlash === '/') return '/';
  return withLeadingSlash.replace(/\/+$/, '') || '/';
};

const stripBasePath = (pathname: string) => {
  const normalizedPath = ensureLeadingSlash(pathname || '/');
  if (!ACTIVE_BASE_PATH) return normalizeAppPath(normalizedPath);
  if (normalizedPath === ACTIVE_BASE_PATH) return '/';
  if (normalizedPath.startsWith(`${ACTIVE_BASE_PATH}/`)) {
    const stripped = normalizedPath.slice(ACTIVE_BASE_PATH.length);
    return normalizeAppPath(stripped || '/');
  }
  return normalizeAppPath(normalizedPath);
};

const applyBasePath = (path: string) => {
  const normalized = normalizeAppPath(path || '/');
  if (!ACTIVE_BASE_PATH) return normalized;
  if (normalized === ACTIVE_BASE_PATH || normalized.startsWith(`${ACTIVE_BASE_PATH}/`)) {
    return normalized;
  }
  if (normalized === '/') return `${ACTIVE_BASE_PATH}/`;
  return `${ACTIVE_BASE_PATH}${normalized}`;
};

export const usePath = () => {
  const [path, setPath] = useState(() => normalizeAppPath(stripBasePath(window.location.pathname || '/')));

  useEffect(() => {
    if (ACTIVE_BASE_PATH) {
      const pathname = window.location.pathname || '/';
      const alreadyUnderBase =
        pathname === ACTIVE_BASE_PATH || pathname.startsWith(`${ACTIVE_BASE_PATH}/`);
      if (!alreadyUnderBase) {
        const nextPath = applyBasePath(pathname || '/');
        const nextUrl = `${nextPath}${window.location.search || ''}${window.location.hash || ''}`;
        window.history.replaceState({}, '', nextUrl);
        setPath(stripBasePath(nextPath));
      }
    }

    const onPop = () => setPath(normalizeAppPath(stripBasePath(window.location.pathname || '/')));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (to: string) => {
    const appPath = normalizeAppPath(to || '/');
    const browserPath = applyBasePath(appPath);
    if (browserPath === window.location.pathname) return;
    window.history.pushState({}, '', browserPath);
    setPath(appPath);
  };

  return { path, navigate };
};

type LinkProps = {
  to: string;
  className?: string;
  children: React.ReactNode;
};

export const Link = ({ to, className, children }: LinkProps) => (
  <a
    href={applyBasePath(ensureLeadingSlash(to))}
    className={className}
    onClick={(event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;
      event.preventDefault();
      window.history.pushState({}, '', applyBasePath(ensureLeadingSlash(to)));
      window.dispatchEvent(new PopStateEvent('popstate'));
    }}
  >
    {children}
  </a>
);
