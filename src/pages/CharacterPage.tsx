import { useEffect, useState } from 'react';
import {
  getXpSummary,
  listEventCounters,
  getXpToNextLevel,
  getXpRequiredForLevel,
  getWeeklyXpHistory,
  type EventCounter,
  type XpSummary,
  type DailyXp
} from '../db';

const getTitleForLevel = (level: number) => {
  if (level >= 20) return '伝説の学習者 🏆';
  if (level >= 15) return '英語マスター 👑';
  if (level >= 10) return 'ぐんぐんチャレンジャー 🚀';
  if (level >= 5) return '単語トレーナー 💪';
  return 'はじめの一歩 🌱';
};

const getMascotMessage = (level: number, dailyEarned: number, diffFromYesterday: number) => {
  // 成長実感メッセージを優先
  if (dailyEarned > 0 && diffFromYesterday > 0) {
    return `昨日より +${diffFromYesterday}pt も成長してるよ！すごい！`;
  }

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
  const [history, setHistory] = useState<DailyXp[]>([]);

  useEffect(() => {
    const loadData = async () => {
      const s = await getXpSummary();
      const c = await listEventCounters();
      const h = await getWeeklyXpHistory();
      setSummary(s);
      setCounters(c);
      setHistory(h);
    };
    void loadData();
  }, []);
  const [xpProgress, setXpProgress] = useState({ current: 0, required: 100, progress: 0 });

  const load = async () => {
    const s = await getXpSummary();
    const c = await listEventCounters();
    const h = await getWeeklyXpHistory();
    const next = getXpToNextLevel(s.xpTotal);

    setSummary(s);
    setCounters(c);
    setHistory(h);
    setXpProgress(next);
  };

  useEffect(() => {
    void load();
  }, []);

  if (!summary) return <div>Loading...</div>;

  // 昨日のXPとの差分
  const todayEarned = history[6]?.earned || 0;
  const yesterdayEarned = history[5]?.earned || 0;
  const diffFromYesterday = todayEarned - yesterdayEarned;

  // グラフ用: 最大値（最低50pt）
  const maxVal = Math.max(...history.map(h => h.earned), 50);

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
          <div className="mascot-speech">
            「{getMascotMessage(summary.level, summary.dailyEarned, diffFromYesterday)}」
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
            <span>{xpProgress.current} / {xpProgress.required} pt</span>
          </div>
          <div className="xp-bar">
            <div
              className="xp-bar-fill"
              style={{ width: `${xpProgress.progress * 100}%` }}
            />
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
                width: `${Math.min(summary.dailyEarned / summary.dailyLimit * 100, 100)}%`,
                background: 'linear-gradient(90deg, #95D5B2, #8ECAE6)'
              }}
            />
          </div>
        </div>

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-value">{summary.xpTotal}</span>
            <span className="stat-label">累計pt</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{summary.dailyEarned}</span>
            <span className="stat-label">今日</span>
          </div>
        </div>

        {/* 週間グラフ */}
        {history.length > 0 && (
          <div style={{ marginTop: 24, padding: '16px 0 0', borderTop: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: 16 }}>📊 今週の成長</h3>
            <div style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              height: 120,
              paddingTop: 20
            }}>
              {history.map((day, i) => {
                const height = Math.min(100, (day.earned / maxVal) * 100);
                const date = new Date(day.date);
                const label = date.toLocaleDateString('ja-JP', { weekday: 'short' });
                const isToday = i === 6;

                return (
                  <div key={day.date} style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4
                  }}>
                    <div style={{
                      width: '60%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'flex-end',
                      position: 'relative'
                    }}>
                      <div style={{
                        width: '100%',
                        height: `${Math.max(height, 5)}%`, // 最低5%の高さ
                        background: isToday ? 'var(--primary)' : 'rgba(0,0,0,0.1)',
                        borderRadius: '4px 4px 0 0',
                        transition: 'height 0.3s ease'
                      }}></div>
                      {day.earned > 0 && (
                        <span style={{
                          position: 'absolute',
                          bottom: `${Math.max(height, 5) + 5}%`,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          fontSize: '0.65rem',
                          color: '#666'
                        }}>{day.earned}</span>
                      )}
                    </div>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: isToday ? 'bold' : 'normal',
                      color: isToday ? 'var(--primary)' : '#888'
                    }}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
