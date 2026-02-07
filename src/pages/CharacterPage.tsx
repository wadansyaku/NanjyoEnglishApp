import { useEffect, useState } from 'react';
import { getXpSummary, listEventCounters, type EventCounter, type XpSummary } from '../db';

const getTitleForLevel = (level: number) => {
  if (level >= 15) return 'ことばクイーン 👑';
  if (level >= 10) return 'ぐんぐんチャレンジャー 🚀';
  if (level >= 5) return 'ことばトレーナー 💪';
  return 'はじめの一歩 🌱';
};

const eventLabelMap: Record<string, { label: string; icon: string }> = {
  scan_started: { label: '写真読み取りを開始', icon: '📷' },
  ocr_done: { label: '読み取り完了', icon: '✅' },
  deck_created: { label: '単語ノートを作成', icon: '📓' },
  review_done: { label: '復習カードに回答', icon: '⭐' }
};

const XP_PER_LEVEL = 100;

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

  const xpForNext = XP_PER_LEVEL;
  const currentLevelXp = summary.xpTotal % XP_PER_LEVEL;
  const xpProgress = xpForNext > 0 ? (currentLevelXp / xpForNext) * 100 : 0;
  const dailyProgress = summary.dailyLimit > 0 
    ? (summary.dailyEarned / summary.dailyLimit) * 100 
    : 0;

  return (
    <section className="section-grid">
      <div className="card">
        <h2>マイキャラ</h2>
        
        {/* Mascot Character */}
        <div className="mascot-container">
          <img 
            src="/mascot.jpg" 
            alt="えいたんの妖精" 
            className="mascot"
          />
        </div>
        
        {/* Title Badge */}
        <div className="title-badge">
          <span>{getTitleForLevel(summary.level)}</span>
        </div>
        
        {/* Level Display */}
        <div className="level-display">
          <span className="level-number">Lv.{summary.level}</span>
        </div>
        
        {/* XP Progress Bar */}
        <div className="xp-bar-container">
          <div className="xp-bar-label">
            <span>次のレベルまで</span>
            <span>{currentLevelXp} / {xpForNext} XP</span>
          </div>
          <div className="xp-bar">
            <div 
              className="xp-bar-fill" 
              style={{ width: `${Math.min(xpProgress, 100)}%` }}
            />
          </div>
        </div>
        
        {/* Daily XP Progress */}
        <div className="xp-bar-container" style={{ marginTop: 20 }}>
          <div className="xp-bar-label">
            <span>今日のXP</span>
            <span>{summary.dailyEarned} / {summary.dailyLimit}</span>
          </div>
          <div className="xp-bar">
            <div 
              className="xp-bar-fill" 
              style={{ 
                width: `${Math.min(dailyProgress, 100)}%`,
                background: 'linear-gradient(90deg, #95D5B2, #8ECAE6)'
              }}
            />
          </div>
        </div>
        
        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-value">{summary.xpTotal}</span>
            <span className="stat-label">トータルXP</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{summary.dailyRemaining}</span>
            <span className="stat-label">今日あともらえるXP</span>
          </div>
        </div>
      </div>
      
      <div className="card">
        <h2>学習ログ</h2>
        {counters.length === 0 && (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
            まだログがありません。
            <br />
            写真から単語をひろってみよう！ 📸
          </p>
        )}
        {counters.length > 0 && (
          <div className="word-grid">
            {counters.map((counter) => {
              const info = eventLabelMap[counter.name] ?? { label: counter.name, icon: '📌' };
              return (
                <div key={counter.name} className="word-item">
                  <span>
                    <span style={{ marginRight: 8 }}>{info.icon}</span>
                    {info.label}
                  </span>
                  <strong>{counter.count}</strong>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
