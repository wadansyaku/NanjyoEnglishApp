import { useEffect, useState } from 'react';
import {
  createOrUpdateSystemDeck,
  getXpSummary,
  listEventCounters,
  getXpToNextLevel,
  getXpRequiredForLevel,
  getWeeklyXpHistory,
  type EventCounter,
  type XpSummary,
  type DailyXp
} from '../db';
import { usePath } from '../lib/router';
import { ensureAuth } from '../lib/auth';
import { getUsageMinutesToday } from '../lib/usage';
import { Modal } from '../components/ui';

// ============================================
// 進化システム定義
// ============================================

// 進化段階（5段階）
type EvolutionStage = {
  id: string;
  name: string;
  minLevel: number;
  color: string;
  emoji: string;
  description: string;
  image: string;
};

const toPublicAssetUrl = (fileName: string) => {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedFile = fileName.startsWith('/') ? fileName.slice(1) : fileName;
  return `${normalizedBase}${normalizedFile}`;
};

const EVOLUTION_STAGES: EvolutionStage[] = [
  { id: 'egg', name: 'たまご', minLevel: 1, color: '#FFE5B4', emoji: '🥚', description: 'まだ眠っているよ', image: toPublicAssetUrl('evolution_egg.png') },
  { id: 'chick', name: 'ひよこ', minLevel: 5, color: '#FFF59D', emoji: '🐣', description: '英語に目覚めた！', image: toPublicAssetUrl('evolution_chick.png') },
  { id: 'bird', name: 'ことり', minLevel: 15, color: '#81D4FA', emoji: '🐦', description: '羽ばたき始めた！', image: toPublicAssetUrl('evolution_bird.png') },
  { id: 'phoenix', name: 'フェニックス', minLevel: 30, color: '#FFAB91', emoji: '🔥', description: '炎のように輝く！', image: toPublicAssetUrl('evolution_phoenix.png') },
  { id: 'dragon', name: 'ドラゴン', minLevel: 50, color: '#CE93D8', emoji: '🐉', description: '伝説の領域へ！', image: toPublicAssetUrl('evolution_dragon.png') }
];

const getEvolutionStage = (level: number): EvolutionStage => {
  for (let i = EVOLUTION_STAGES.length - 1; i >= 0; i--) {
    if (level >= EVOLUTION_STAGES[i].minLevel) {
      return EVOLUTION_STAGES[i];
    }
  }
  return EVOLUTION_STAGES[0];
};

const getNextEvolution = (level: number): EvolutionStage | null => {
  const current = getEvolutionStage(level);
  const idx = EVOLUTION_STAGES.findIndex(s => s.id === current.id);
  return idx < EVOLUTION_STAGES.length - 1 ? EVOLUTION_STAGES[idx + 1] : null;
};

// 称号システム（レベルに応じた称号）
type TitleInfo = {
  title: string;
  minLevel: number;
  schoolLevel: string;
};

const TITLE_MILESTONES: TitleInfo[] = [
  { title: 'はじめの一歩', minLevel: 1, schoolLevel: '入門' },
  { title: 'ことばトレーナー', minLevel: 5, schoolLevel: '中1前半' },
  { title: 'ぐんぐんチャレンジャー', minLevel: 10, schoolLevel: '中1後半' },
  { title: 'ことばクイーン', minLevel: 15, schoolLevel: '中2' },
  { title: 'マスターへの道', minLevel: 20, schoolLevel: '中2後半' },
  { title: 'ワードハンター', minLevel: 25, schoolLevel: '中3' },
  { title: '英語の達人', minLevel: 30, schoolLevel: '中3後半' },
  { title: 'ハイスクールスター', minLevel: 40, schoolLevel: '高1〜高2' },
  { title: 'アカデミックエース', minLevel: 50, schoolLevel: '高3' },
  { title: 'ユニバーシティマスター', minLevel: 70, schoolLevel: '大学2年' },
  { title: 'レジェンド', minLevel: 100, schoolLevel: '達人' }
];

const getTitleForLevel = (level: number): string => {
  for (let i = TITLE_MILESTONES.length - 1; i >= 0; i--) {
    if (level >= TITLE_MILESTONES[i].minLevel) {
      return TITLE_MILESTONES[i].title;
    }
  }
  return 'はじめの一歩';
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
  ocr_done: { label: '読み取り完了', icon: '✅' },
  deck_created: { label: '単語ノートを作成', icon: '📓' },
  review_done: { label: '復習カードに回答', icon: '⭐' }
};

const getGardenPhase = (clearedCount: number, totalTasks: number) => {
  if (totalTasks <= 0 || clearedCount <= 0) {
    return {
      label: 'たねまき',
      description: 'まずは最初のことばの芽を植えよう。'
    };
  }

  const ratio = clearedCount / totalTasks;
  if (ratio >= 1) {
    return {
      label: '収穫',
      description: '今日のお庭は育ちきったよ。収穫ノートで仕上げよう。'
    };
  }
  if (ratio >= 0.66) {
    return {
      label: '仕上げの手入れ',
      description: 'あと少しで収穫。最後までお世話しよう。'
    };
  }
  if (ratio >= 0.33) {
    return {
      label: '水やり中',
      description: '芽が育ってきたよ。このまま続けよう。'
    };
  }
  return {
    label: '芽が出た',
    description: 'いいスタート。毎日少しずつ育てよう。'
  };
};

const getGardenTaskLabel = (taskType: string) => {
  if (taskType === 'proofread') return '水やりチェック';
  if (taskType === 'propose') return '植えかえ提案';
  return 'お世話タスク';
};

type GardenQuiz = {
  promptMeaningJa: string;
  choices: Array<{
    headwordNorm: string;
    label: string;
  }>;
};

type GardenTask = {
  taskId: string;
  type: string;
  headwordNorm: string;
  status: string;
  attempts: number;
  quiz: GardenQuiz | null;
};

export default function CharacterPage() {
  const { navigate } = usePath();
  const [summary, setSummary] = useState<XpSummary | null>(null);
  const [counters, setCounters] = useState<EventCounter[]>([]);
  const [history, setHistory] = useState<DailyXp[]>([]);
  const [adventure, setAdventure] = useState<{
    dungeonId: string;
    title: string;
    description: string;
    totalTasks: number;
    clearedCount: number;
    unlockReady: boolean;
  } | null>(null);
  const [adventureTasks, setAdventureTasks] = useState<GardenTask[]>([]);
  const [proofreadRemaining, setProofreadRemaining] = useState(0);
  const [adventureLoading, setAdventureLoading] = useState(false);
  const [adventureStatus, setAdventureStatus] = useState('');
  const [completingTaskId, setCompletingTaskId] = useState('');
  const [activeQuizTask, setActiveQuizTask] = useState<GardenTask | null>(null);
  const [selectedAnswerNorm, setSelectedAnswerNorm] = useState('');

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

  const loadAdventure = async () => {
    setAdventureLoading(true);
    try {
      const session = await ensureAuth();
      const minutesToday = getUsageMinutesToday();
      const usageResponse = await fetch('/api/v1/usage/report', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session.apiKey}`
        },
        body: JSON.stringify({ minutesToday })
      });
      if (!usageResponse.ok) {
        throw new Error('利用状況の同期に失敗しました。しばらくしてから試してください。');
      }

      const response = await fetch('/api/v1/community/tasks', {
        headers: {
          Authorization: `Bearer ${session.apiKey}`
        }
      });
      if (!response.ok) {
        throw new Error('お庭データの取得に失敗しました。');
      }

      const data = (await response.json()) as {
        ok: boolean;
        dungeon: {
          dungeonId: string;
          title: string;
          description: string;
          totalTasks: number;
          clearedCount: number;
          unlockReady: boolean;
        };
        usage: {
          proofreadRemainingToday: number;
        };
        tasks: GardenTask[];
      };

      setAdventure(data.dungeon);
      setAdventureTasks(data.tasks ?? []);
      setProofreadRemaining(Math.max(0, Number(data.usage?.proofreadRemainingToday ?? 0)));
      setAdventureStatus('');
    } catch (error) {
      setAdventureStatus((error as Error).message || 'お庭データの読み込みに失敗しました。');
      setAdventure(null);
      setAdventureTasks([]);
    } finally {
      setAdventureLoading(false);
    }
  };

  useEffect(() => {
    void loadAdventure();
  }, []);

  const unlockDungeonDeck = async (input: { sourceId: string; headwordNorms: string[] }) => {
    if (!input.headwordNorms.length) return null;
    const session = await ensureAuth();
    const lookupResponse = await fetch('/api/v1/lexemes/lookup', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`
      },
      body: JSON.stringify({ headwords: input.headwordNorms })
    });
    if (!lookupResponse.ok) return null;
    const lookupData = (await lookupResponse.json()) as {
      found: Array<{
        headwordNorm?: string;
        headword?: string;
        entries?: Array<{ meaning_ja?: string }>;
      }>;
    };
    const words = (lookupData.found ?? [])
      .map((item) => {
        const norm = item.headwordNorm ?? '';
        const headword = item.headword ?? norm;
        const meaning = item.entries?.[0]?.meaning_ja ?? '';
        if (!norm || !headword || !meaning) return null;
        return {
          headwordNorm: norm,
          headword,
          meaningJaShort: meaning
        };
      })
      .filter((item): item is { headwordNorm: string; headword: string; meaningJaShort: string } => Boolean(item));

    if (words.length === 0) return null;
    return createOrUpdateSystemDeck({
      sourceId: input.sourceId,
      title: `${adventure?.title ?? '今日のお庭'} 収穫ノート`,
      origin: 'dungeon',
      words
    });
  };

  const handleCompleteTask = async (task: GardenTask, answerHeadwordNorm: string) => {
    if (!task?.taskId || !answerHeadwordNorm) return false;
    setCompletingTaskId(task.taskId);
    setAdventureStatus('');
    try {
      const session = await ensureAuth();
      const response = await fetch(`/api/v1/community/tasks/${encodeURIComponent(task.taskId)}/complete`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session.apiKey}`
        },
        body: JSON.stringify({
          answerHeadwordNorm
        })
      });

      const data = (await response.json()) as {
        ok: boolean;
        correct?: boolean;
        message?: string;
        usage?: { proofreadRemainingToday?: number };
        unlockedDeck?: { sourceId: string; headwordNorms: string[] } | null;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.message || 'タスクを完了できませんでした。');
      }

      if (data.usage?.proofreadRemainingToday != null) {
        setProofreadRemaining(Math.max(0, Number(data.usage.proofreadRemainingToday)));
      }

      if (data.correct === false) {
        setAdventureStatus(data.message || 'ちがうかも。もう一度えらんでみよう。');
        await loadAdventure();
        return false;
      }

      if (data.unlockedDeck && data.unlockedDeck.headwordNorms.length > 0) {
        const deckId = await unlockDungeonDeck(data.unlockedDeck);
        if (deckId) {
          setAdventureStatus('収穫ノートが解放されました。すぐに復習できます。');
          navigate(`/review/${deckId}`);
        } else {
          setAdventureStatus('お世話完了。収穫ノートを準備しています。');
        }
      } else {
        setAdventureStatus('お世話を記録しました。');
      }

      await loadAdventure();
      return true;
    } catch (error) {
      setAdventureStatus((error as Error).message || 'お世話の完了に失敗しました。');
      return false;
    } finally {
      setCompletingTaskId('');
    }
  };

  const openTaskQuiz = (task: GardenTask) => {
    if (task.status === 'done') return;
    if (!task.quiz || task.quiz.choices.length < 2) {
      setAdventureStatus('このお世話は準備中です。しばらくしてから試してください。');
      return;
    }
    setSelectedAnswerNorm('');
    setActiveQuizTask(task);
    setAdventureStatus('');
  };

  const handleSubmitTaskQuiz = async () => {
    if (!activeQuizTask || !selectedAnswerNorm) return;
    const correct = await handleCompleteTask(activeQuizTask, selectedAnswerNorm);
    if (correct) {
      setActiveQuizTask(null);
      setSelectedAnswerNorm('');
    }
  };

  if (!summary) return <div>Loading...</div>;

  // 昨日のXPとの差分
  const todayEarned = history[6]?.earned || 0;
  const yesterdayEarned = history[5]?.earned || 0;
  const diffFromYesterday = todayEarned - yesterdayEarned;

  // グラフ用: 最大値（最低50pt）
  const maxVal = Math.max(...history.map(h => h.earned), 50);
  const gardenPhase = adventure ? getGardenPhase(adventure.clearedCount, adventure.totalTasks) : null;

  return (
    <section className="section-grid">
      <div className="card">
        <h2>マイキャラ</h2>

        {/* Evolution Stage */}
        {(() => {
          const stage = getEvolutionStage(summary.level);
          const nextStage = getNextEvolution(summary.level);
          return (
            <div className="evolution-display" style={{ marginBottom: 16, textAlign: 'center' }}>
              <div className="evolution-badge" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 20,
                background: stage.color,
                fontSize: '0.9rem',
                fontWeight: 600
              }}>
                <span style={{ fontSize: '1.2rem' }}>{stage.emoji}</span>
                <span>{stage.name}</span>
              </div>
              {nextStage && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                  次の進化: Lv.{nextStage.minLevel}で {nextStage.emoji}{nextStage.name} に！
                </p>
              )}
            </div>
          );
        })()}

        {/* Mascot Character with Animation - 進化段階に応じた画像 */}
        <div className="mascot-container">
          <img
            src={getEvolutionStage(summary.level).image}
            alt={`進化段階: ${getEvolutionStage(summary.level).name}`}
            className="mascot mascot-float"
          />
          <div className="mascot-speech">
            「{getMascotMessage(summary.level, summary.dailyEarned, diffFromYesterday)}」
          </div>
        </div>

        {/* Title Badge */}
        <div className="title-badge">
          <span>称号: {getTitleForLevel(summary.level)}</span>
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
            <span>今日のXP</span>
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
            <span className="stat-label">トータルXP</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{summary.dailyRemaining}</span>
            <span className="stat-label">今日あともらえるXP</span>
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

        {/* Level Milestones - 拡張版 */}
        <details className="level-milestones">
          <summary>🎯 レベル目安・称号一覧</summary>
          <div className="milestone-grid" style={{ marginTop: 12 }}>
            {TITLE_MILESTONES.map((m, i) => {
              const isAchieved = summary.level >= m.minLevel;
              const isCurrent = summary.level >= m.minLevel &&
                (i === TITLE_MILESTONES.length - 1 || summary.level < TITLE_MILESTONES[i + 1].minLevel);
              return (
                <div
                  key={m.minLevel}
                  className="milestone-card"
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: isCurrent ? '2px solid var(--primary)' : '1px solid var(--border-light)',
                    background: isAchieved ? 'rgba(255, 126, 179, 0.1)' : '#fff',
                    opacity: isAchieved ? 1 : 0.6
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <strong style={{ color: isAchieved ? 'var(--primary-dark)' : 'var(--text-muted)' }}>
                      Lv.{m.minLevel} {isAchieved ? '✓' : ''}
                    </strong>
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{m.title}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {getXpRequiredForLevel(m.minLevel).toLocaleString()} pt〜
                  </div>
                </div>
              );
            })}
          </div>

          {/* 進化段階表 */}
          <h4 style={{ marginTop: 20, fontSize: '0.9rem' }}>🥚 キャラ進化</h4>
          <div className="evolution-grid" style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {EVOLUTION_STAGES.map((stage) => {
              const isAchieved = summary.level >= stage.minLevel;
              return (
                <div
                  key={stage.id}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 12,
                    background: isAchieved ? stage.color : '#eee',
                    opacity: isAchieved ? 1 : 0.5,
                    textAlign: 'center',
                    fontSize: '0.75rem'
                  }}
                >
                  <div style={{ fontSize: '1.2rem' }}>{stage.emoji}</div>
                  <div style={{ fontWeight: 600 }}>{stage.name}</div>
                  <div style={{ color: 'var(--text-muted)' }}>Lv.{stage.minLevel}〜</div>
                </div>
              );
            })}
          </div>
        </details>
      </div>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>📊 学習ログ</summary>
        {counters.length === 0 && (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
            まだログがありません。
            <br />
            写真から単語を拾ってみよう！ 📸
          </p>
        )}
        {counters.length > 0 && (
          <div className="word-grid" style={{ marginTop: 12 }}>
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
      </details>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>🌿 今日のお庭</summary>
        <p className="notice" style={{ marginTop: 12 }}>お世話を進めると、収穫ノートが解放されます。</p>
        {adventureLoading && <p className="counter">読み込み中…</p>}
        {!adventureLoading && !adventure && (
          <p className="counter">お庭データが取得できませんでした。</p>
        )}
        {adventure && (
          <>
            <p className="badge">
              育ち: {adventure.clearedCount}/{adventure.totalTasks} ・ のこりお世話回数: {proofreadRemaining}
            </p>
            {gardenPhase && (
              <p className="counter">
                フェーズ: {gardenPhase.label}
                {' ・ '}
                {gardenPhase.description}
              </p>
            )}
            <div className="xp-bar-container" style={{ marginTop: 8 }}>
              <div className="xp-bar-label">
                <span>栽培率</span>
                <span>
                  {adventure.totalTasks > 0
                    ? `${Math.round((adventure.clearedCount / adventure.totalTasks) * 100)}%`
                    : '0%'}
                </span>
              </div>
              <div className="xp-bar">
                <div
                  className="xp-bar-fill"
                  style={{
                    width: `${adventure.totalTasks > 0 ? (adventure.clearedCount / adventure.totalTasks) * 100 : 0}%`,
                    background: 'linear-gradient(90deg, #95D5B2, #8ECAE6)'
                  }}
                />
              </div>
              <small className="candidate-meta">
                あと {Math.max(0, adventure.totalTasks - adventure.clearedCount)} 件で収穫
              </small>
            </div>
            <div className="word-grid">
              {adventureTasks.map((task) => (
                <div key={task.taskId} className="word-item">
                  <div>
                    <strong>{task.quiz?.promptMeaningJa || task.headwordNorm || 'task'}</strong>
                    <small className="candidate-meta">
                      {getGardenTaskLabel(task.type)} ・ {task.status === 'done' ? '完了' : '未完了'}
                    </small>
                    {task.quiz && (
                      <small className="candidate-meta">この意味に合う英単語を選ぶ</small>
                    )}
                    {task.attempts > 0 && (
                      <small className="candidate-meta">チャレンジ回数: {task.attempts}</small>
                    )}
                  </div>
                  <button
                    className="pill"
                    type="button"
                    disabled={
                      task.status === 'done' ||
                      completingTaskId === task.taskId ||
                      proofreadRemaining <= 0 ||
                      !task.quiz
                    }
                    onClick={() => openTaskQuiz(task)}
                  >
                    {task.status === 'done'
                      ? '完了'
                      : completingTaskId === task.taskId
                        ? '処理中…'
                        : 'お世話する'}
                  </button>
                </div>
              ))}
            </div>
            {adventure.unlockReady && (
              <p className="counter">今日のお庭は収穫済みです。復習画面でノートを確認できます。</p>
            )}
          </>
        )}
        {adventureStatus && <p className="counter">{adventureStatus}</p>}
      </details>

      <Modal
        open={Boolean(activeQuizTask)}
        onClose={() => {
          if (completingTaskId) return;
          setActiveQuizTask(null);
          setSelectedAnswerNorm('');
        }}
        title="お世話クイズ"
      >
        {activeQuizTask?.quiz && (
          <div className="word-grid" style={{ marginTop: 8 }}>
            <p className="notice">
              この意味に合う英単語を1つ選んでね。
            </p>
            <p className="counter">意味: {activeQuizTask.quiz.promptMeaningJa}</p>
            <div className="scan-inline-actions" style={{ marginTop: 8 }}>
              {activeQuizTask.quiz.choices.map((choice) => (
                <button
                  key={choice.headwordNorm}
                  type="button"
                  className={selectedAnswerNorm === choice.headwordNorm ? '' : 'secondary'}
                  onClick={() => setSelectedAnswerNorm(choice.headwordNorm)}
                  disabled={Boolean(completingTaskId)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              style={{ marginTop: 12 }}
              disabled={!selectedAnswerNorm || completingTaskId === activeQuizTask?.taskId}
              onClick={() => {
                void handleSubmitTaskQuiz();
              }}
            >
              {completingTaskId === activeQuizTask?.taskId ? '判定中…' : '答えてお世話を完了'}
            </button>
          </div>
        )}
      </Modal>
    </section>
  );
}
