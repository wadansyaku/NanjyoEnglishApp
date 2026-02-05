import { useEffect, useState } from 'react';

export const usePath = () => {
  const [path, setPath] = useState(() => window.location.pathname || '/');

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState({}, '', to);
    setPath(to);
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
    href={to}
    className={className}
    onClick={(event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;
      event.preventDefault();
      window.history.pushState({}, '', to);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }}
  >
    {children}
  </a>
);
