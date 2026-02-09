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

const stripBasePath = (pathname: string) => {
  if (!ACTIVE_BASE_PATH) return pathname || '/';
  if (pathname === ACTIVE_BASE_PATH) return '/';
  if (pathname.startsWith(`${ACTIVE_BASE_PATH}/`)) {
    const stripped = pathname.slice(ACTIVE_BASE_PATH.length);
    return stripped || '/';
  }
  return pathname || '/';
};

const applyBasePath = (path: string) => {
  const normalized = ensureLeadingSlash(path || '/');
  if (!ACTIVE_BASE_PATH) return normalized;
  if (normalized === ACTIVE_BASE_PATH || normalized.startsWith(`${ACTIVE_BASE_PATH}/`)) {
    return normalized;
  }
  if (normalized === '/') return `${ACTIVE_BASE_PATH}/`;
  return `${ACTIVE_BASE_PATH}${normalized}`;
};

export const usePath = () => {
  const [path, setPath] = useState(() => stripBasePath(window.location.pathname || '/'));

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

    const onPop = () => setPath(stripBasePath(window.location.pathname || '/'));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (to: string) => {
    const appPath = ensureLeadingSlash(to || '/');
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
