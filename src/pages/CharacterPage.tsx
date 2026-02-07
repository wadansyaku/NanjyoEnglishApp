import { useEffect, useState } from 'react';
import {
  getXpSummary,
  listEventCounters,
  getXpToNextLevel,
  getXpRequiredForLevel,
  type EventCounter,
  type XpSummary
} from '../db';

const getTitleForLevel = (level: number) => {
  if (level >= 20) return '伝説の学習者 🏆';
  if (level >= 15) return '英語マスター 👑';
  if (level >= 10) return 'ぐんぐんチャレンジャー 🚀';
  if (level >= 5) return '単語トレーナー 💪';
  return 'はじめの一歩 🌱';
};

const getMascotMessage = (level: number, dailyEarned: number) => {
  // 日替わり + 状態に応じたメッセージ
  const messages = {
    greeting: [
      '今日も一緒に頑張ろう！',
      '英語って楽しいね！',
      'いつも頑張ってて偉いよ！'
    ],
    progress: [
      'いい調子！この調子で続けよう',
      'すごい！どんどん覚えてるね',
      '今日も成長してるよ！'
    ],
    encouragement: [
      'ちょっとだけでも大丈夫！',
      '復習すると覚えやすくなるよ',
      '少しずつで大丈夫だよ'
    ]
  };

  if (dailyEarned >= 100) {
    const idx = new Date().getDate() % messages.progress.length;
    return messages.progress[idx];
  } else if (dailyEarned > 0) {
    const idx = new Date().getDate() % messages.greeting.length;
    return messages.greeting[idx];
  } else {
    const idx = new Date().getDate() % messages.encouragement.length;
    return messages.encouragement[idx];
  }
};

const eventLabelMap: Record<string, { label: string; icon: string }> = {
  scan_started: { label: '写真読み取りを開始', icon: '📷' },
  ocr_done: { label: '文字認識完了', icon: '✅' },
  deck_created: { label: '単語帳を作成', icon: '📓' },
  review_done: { label: '復習カードに回答', icon: '⭐' }
};

export default function CharacterPage() {
  const [summary, setSummary] = useState<XpSummary | null>(null);
  const [counters, setCounters] = useState<EventCounter[]>([]);
  const [xpProgress, setXpProgress] = useState({ current: 0, required: 100, progress: 0 });

  const load = async () => {
    const data = await getXpSummary();
    const events = await listEventCounters();
    const progress = getXpToNextLevel(data.xpTotal);
    setSummary(data);
    setCounters(events);
    setXpProgress(progress);
  };

  useEffect(() => {
    void load();
  }, []);

  if (!summary) {
    return (
      <section className="section-grid">
        <div className="card">
          <h2>自分の記録</h2>
          <p>読み込み中...</p>
        </div>
      </section>
    );
  }

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
            src="/mascot.png"
            alt="えいたんの妖精"
            className="mascot"
          />
          <div className="mascot-speech">
            「{getMascotMessage(summary.level, summary.dailyEarned)}」
          </div>
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
            <span>あと {xpProgress.required - xpProgress.current} ポイント</span>
          </div>
          <div className="xp-bar">
            <div
              className="xp-bar-fill"
              style={{ width: `${Math.min(xpProgress.progress * 100, 100)}%` }}
            />
          </div>
          <div className="xp-bar-detail">
            <span>{xpProgress.current} / {xpProgress.required}</span>
          </div>
        </div>

        {/* Daily XP Progress */}
        <div className="xp-bar-container" style={{ marginTop: 16 }}>
          <div className="xp-bar-label">
            <span>今日のポイント</span>
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
            <span className="stat-label">累計ポイント</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{summary.dailyRemaining}</span>
            <span className="stat-label">今日の残り</span>
          </div>
        </div>

        {/* Level Milestones */}
        <details className="level-milestones">
          <summary>レベル目安</summary>
          <div className="milestone-list">
            <div className="milestone-item">
              <span>Lv.5</span>
              <span>{getXpRequiredForLevel(5)} pt〜</span>
              <span>単語トレーナー 💪</span>
            </div>
            <div className="milestone-item">
              <span>Lv.10</span>
              <span>{getXpRequiredForLevel(10)} pt〜</span>
              <span>チャレンジャー 🚀</span>
            </div>
            <div className="milestone-item">
              <span>Lv.15</span>
              <span>{getXpRequiredForLevel(15)} pt〜</span>
              <span>英語マスター 👑</span>
            </div>
          </div>
        </details>
      </div>

      <div className="card">
        <h2>学習ログ</h2>
        {counters.length === 0 && (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
            まだログがありません。
            <br />
            写真から単語を拾ってみよう！ 📸
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
