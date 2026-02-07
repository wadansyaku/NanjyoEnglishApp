import { useEffect, useState } from 'react';
import { getXpSummary, listEventCounters, type EventCounter, type XpSummary } from '../db';

const getTitleForLevel = (level: number) => {
  if (level >= 15) return 'ことばクイーン';
  if (level >= 10) return 'ぐんぐんチャレンジャー';
  if (level >= 5) return 'ことばトレーナー';
  return 'はじめの一歩';
};

const eventLabelMap: Record<string, string> = {
  scan_started: '写真読み取りを開始',
  ocr_done: '読み取り完了',
  deck_created: '単語ノートを作成',
  review_done: '復習カードに回答'
};

export default function CharacterPage() {
  const [summary, setSummary] = useState<XpSummary | null>(null);
  const [counters, setCounters] = useState<EventCounter[]>([]);

  const load = async () => {
    const data = await getXpSummary();
    const events = await listEventCounters();
    setSummary(data);
    setCounters(events);
  };

  useEffect(() => {
    void load();
  }, []);

  if (!summary) {
    return (
      <section className="section-grid">
        <div className="card">
          <h2>がんばり記録</h2>
          <p>読み込み中...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="section-grid">
      <div className="card">
        <h2>マイキャラ</h2>
        <p className="badge">称号: {getTitleForLevel(summary.level)}</p>
        <p>レベル: {summary.level}</p>
        <p>トータルXP: {summary.xpTotal}</p>
        <p>
          今日のXP: {summary.dailyEarned}/{summary.dailyLimit}
        </p>
        <p>今日あともらえるXP: {summary.dailyRemaining}</p>
      </div>
      <div className="card">
        <h2>学習ログ</h2>
        {counters.length === 0 && <p>まだログがありません。</p>}
        {counters.length > 0 && (
          <div className="word-grid">
            {counters.map((counter) => (
              <div key={counter.name} className="word-item">
                <span>{eventLabelMap[counter.name] ?? counter.name}</span>
                <strong>{counter.count}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
