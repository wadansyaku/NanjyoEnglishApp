import { useEffect, useState } from 'react';
import { getXpSummary, type XpSummary } from '../db';

const getTitleForLevel = (level: number) => {
  if (level >= 15) return '語彙マスター';
  if (level >= 10) return '挑戦者';
  if (level >= 5) return '見習い';
  return '芽生え';
};

export default function CharacterPage() {
  const [summary, setSummary] = useState<XpSummary | null>(null);

  const load = async () => {
    const data = await getXpSummary();
    setSummary(data);
  };

  useEffect(() => {
    void load();
  }, []);

  if (!summary) {
    return (
      <section className="section-grid">
        <div className="card">
          <h2>キャラクター</h2>
          <p>読み込み中...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="section-grid">
      <div className="card">
        <h2>キャラクター</h2>
        <p className="badge">称号: {getTitleForLevel(summary.level)}</p>
        <p>Level: {summary.level}</p>
        <p>XP: {summary.xpTotal}</p>
        <p>
          今日のXP: {summary.dailyEarned}/{summary.dailyLimit}
        </p>
        <p>残り獲得可能: {summary.dailyRemaining} XP</p>
      </div>
    </section>
  );
}
