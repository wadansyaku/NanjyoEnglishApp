import ScanPage from './pages/ScanPage';
import ReviewPage from './pages/ReviewPage';
import CharacterPage from './pages/CharacterPage';
import { Link, usePath } from './lib/router';

export default function App() {
  const { path, navigate } = usePath();
  const normalizedPath = path === '/' ? '/scan' : path;

  if (path === '/') {
    navigate('/scan');
  }

  let content: JSX.Element = <ScanPage />;
  if (normalizedPath.startsWith('/review/')) {
    const deckId = normalizedPath.replace('/review/', '');
    content = <ReviewPage deckId={deckId} />;
  } else if (normalizedPath === '/character') {
    content = <CharacterPage />;
  } else if (normalizedPath === '/scan') {
    content = <ScanPage />;
  }

  return (
    <main>
      <header>
        <h1>学習フロー（ローカル）</h1>
        <p>辞書→デッキ→SRS→XP→キャラを端末内だけで回します。</p>
        <nav className="pill-group">
          <Link className="pill" to="/scan">
            /scan
          </Link>
          <Link className="pill" to="/character">
            /character
          </Link>
        </nav>
      </header>

      {content}
    </main>
  );
}
