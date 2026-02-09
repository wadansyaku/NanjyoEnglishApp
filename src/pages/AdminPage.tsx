import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildPrintableTestHtml,
  buildQuestions,
  isTypingCorrect,
  type TestMode,
  type TestQuestion,
  type TestWord
} from '../lib/practiceTest';
import {
  loadABTestConfig,
  resetAssignments,
  saveABTestConfig,
  type ABTest,
  type ABTestConfig
} from '../lib/abtest';
import {
  applyManagedSettings,
  toManagedSettings,
  type AppSettings,
  type ManagedAppSettings
} from '../lib/settings';

type AdminPageProps = {
  settings: AppSettings;
  onChangeSettings: (settings: AppSettings) => void;
};

type StudentSummary = {
  userId: string;
  email: string;
  createdAt: number;
  lastLoginAt: number | null;
  syncedAt: number | null;
  xpTotal: number;
  level: number;
  cardCount: number;
  learnedCount: number;
};

type StudentWord = {
  headwordNorm: string;
  headword: string;
  meaningJa: string;
  reps: number;
  ease: number;
  interval: number;
  lastReviewedAt: number | null;
  updatedAt: number;
};

type AnswerState = {
  questionId: string;
  answer: string;
  correct: boolean;
};

type AdminFeedback = {
  feedbackId: number;
  type: 'ocr' | 'ux' | 'bug' | 'feature' | string;
  message: string;
  createdAt: number;
  createdBy: string | null;
  email: string;
  context: unknown;
};

const ADMIN_TOKEN_STORAGE_KEY = 'admin.api.token.v1';

const toDateLabel = (value: number | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('ja-JP');
};

const modeLabels: Record<TestMode, string> = {
  choice: '4択（英語→日本語）',
  typing: '入力（日本語→英語）',
  reverse: '逆4択（日本語→英語）',
  mixed: 'ミックス'
};

export default function AdminPage({ settings, onChangeSettings }: AdminPageProps) {

  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState('');
  const [authStatus, setAuthStatus] = useState('');

  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState('');

  const [selectedUserId, setSelectedUserId] = useState('');
  const [words, setWords] = useState<StudentWord[]>([]);
  const [wordsLoading, setWordsLoading] = useState(false);
  const [wordsError, setWordsError] = useState('');

  const [mode, setMode] = useState<TestMode>('mixed');
  const [questionCount, setQuestionCount] = useState(10);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [typing, setTyping] = useState('');
  const [answers, setAnswers] = useState<AnswerState[]>([]);

  const [abConfig, setAbConfig] = useState<ABTestConfig>(() => loadABTestConfig());
  const [newTestId, setNewTestId] = useState('');
  const [newTestName, setNewTestName] = useState('');
  const [newTestDesc, setNewTestDesc] = useState('');
  const [newVariantA, setNewVariantA] = useState('');
  const [newVariantB, setNewVariantB] = useState('');

  const [globalSettings, setGlobalSettings] = useState<ManagedAppSettings>(() =>
    toManagedSettings(settings)
  );
  const [globalSettingsUpdatedAt, setGlobalSettingsUpdatedAt] = useState<number | null>(null);
  const [globalSettingsLoading, setGlobalSettingsLoading] = useState(false);
  const [globalSettingsSaving, setGlobalSettingsSaving] = useState(false);
  const [globalSettingsStatus, setGlobalSettingsStatus] = useState('');

  const [feedbackList, setFeedbackList] = useState<AdminFeedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');

  const adminFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!token) {
      throw new Error('ADMIN_TOKEN を入力してください。');
    }
    const headers = new Headers(init.headers || {});
    headers.set('x-admin-token', token);
    return fetch(path, { ...init, headers });
  }, [token]);

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    setStudentsError('');
    try {
      const response = await adminFetch('/api/v1/admin/students');
      if (!response.ok) {
        throw new Error('生徒一覧の取得に失敗しました。');
      }
      const data = (await response.json()) as {
        ok: boolean;
        students?: StudentSummary[];
      };
      const list = data.students ?? [];
      setStudents(list);
      setSelectedUserId((prev) => prev || list[0]?.userId || '');
    } catch (error) {
      setStudentsError((error as Error).message);
      setStudents([]);
    } finally {
      setStudentsLoading(false);
    }
  }, [adminFetch]);

  const loadWords = useCallback(async (userId: string) => {
    if (!userId) return;
    setWordsLoading(true);
    setWordsError('');
    try {
      const response = await adminFetch(`/api/v1/admin/students/${encodeURIComponent(userId)}/words?limit=500`);
      if (!response.ok) {
        throw new Error('履修語彙の取得に失敗しました。');
      }
      const data = (await response.json()) as {
        ok: boolean;
        words?: StudentWord[];
      };
      setWords(data.words ?? []);
    } catch (error) {
      setWordsError((error as Error).message);
      setWords([]);
    } finally {
      setWordsLoading(false);
    }
  }, [adminFetch]);

  const loadGlobalSettings = useCallback(async () => {
    setGlobalSettingsLoading(true);
    setGlobalSettingsStatus('');
    try {
      const response = await adminFetch('/api/v1/admin/settings');
      if (!response.ok) {
        throw new Error('全体設定の取得に失敗しました。');
      }
      const data = (await response.json()) as {
        ok: boolean;
        settings?: ManagedAppSettings;
        updatedAt?: number | null;
      };
      if (!data.ok || !data.settings) {
        throw new Error('全体設定の形式が不正です。');
      }
      const merged = applyManagedSettings(settings, data.settings);
      setGlobalSettings(toManagedSettings(merged));
      setGlobalSettingsUpdatedAt(data.updatedAt ?? null);
    } catch (error) {
      setGlobalSettingsStatus((error as Error).message);
    } finally {
      setGlobalSettingsLoading(false);
    }
  }, [adminFetch, settings]);

  const loadFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    setFeedbackError('');
    try {
      const response = await adminFetch('/api/v1/admin/feedback?limit=80');
      if (!response.ok) {
        throw new Error('意見一覧の取得に失敗しました。');
      }
      const data = (await response.json()) as {
        ok: boolean;
        feedback?: AdminFeedback[];
      };
      setFeedbackList(data.feedback ?? []);
    } catch (error) {
      setFeedbackError((error as Error).message);
      setFeedbackList([]);
    } finally {
      setFeedbackLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    const saved = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '';
    if (!saved) return;
    setToken(saved);
    setTokenInput(saved);
  }, []);

  useEffect(() => {
    setAbConfig(loadABTestConfig());
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadStudents();
    void loadGlobalSettings();
    void loadFeedback();
  }, [token, loadStudents, loadGlobalSettings, loadFeedback]);

  useEffect(() => {
    if (token) return;
    setGlobalSettings(toManagedSettings(settings));
  }, [settings, token]);

  useEffect(() => {
    if (!token || !selectedUserId) return;
    void loadWords(selectedUserId);
  }, [selectedUserId, token, loadWords]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.userId === selectedUserId) ?? null,
    [students, selectedUserId]
  );

  const testWords = useMemo<TestWord[]>(
    () =>
      words
        .filter((word) => word.headword.trim() && word.meaningJa.trim())
        .map((word) => ({
          headwordNorm: word.headwordNorm,
          headword: word.headword,
          meaningJa: word.meaningJa
        })),
    [words]
  );

  const current = questions[index] ?? null;
  const finished = questions.length > 0 && index >= questions.length;
  const score = useMemo(() => answers.filter((answer) => answer.correct).length, [answers]);

  const handleLogin = async () => {
    const nextToken = tokenInput.trim();
    if (!nextToken) {
      setAuthStatus('ADMIN_TOKEN を入力してください。');
      return;
    }
    setToken(nextToken);
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, nextToken);
    setAuthStatus('認証を確認しています…');
    try {
      const response = await fetch('/api/v1/admin/students', {
        headers: { 'x-admin-token': nextToken }
      });
      if (!response.ok) throw new Error('ADMIN_TOKEN が正しくありません。');
      setAuthStatus('認証できました。');
    } catch (error) {
      setAuthStatus((error as Error).message);
      setToken('');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setToken('');
    setTokenInput('');
    setAuthStatus('');
    setStudents([]);
    setSelectedUserId('');
    setWords([]);
    setQuestions([]);
    setIndex(0);
    setAnswers([]);
    setTyping('');
    setGlobalSettings(toManagedSettings(settings));
    setGlobalSettingsUpdatedAt(null);
    setGlobalSettingsStatus('');
    setFeedbackList([]);
    setFeedbackError('');
  };

  const updateAbConfig = (next: ABTestConfig) => {
    saveABTestConfig(next);
    setAbConfig(next);
  };

  const handleToggleTest = (testId: string) => {
    const next = {
      ...abConfig,
      tests: abConfig.tests.map((test) =>
        test.id === testId ? { ...test, active: !test.active } : test
      )
    };
    updateAbConfig(next);
  };

  const handleResetAssignments = () => {
    if (!confirm('A/Bテストの割り当てを全てリセットしますか？')) return;
    resetAssignments();
    setAbConfig(loadABTestConfig());
  };

  const handleDeleteTest = (testId: string) => {
    if (!confirm(`テスト「${testId}」を削除しますか？`)) return;
    const next = {
      ...abConfig,
      tests: abConfig.tests.filter((test) => test.id !== testId),
      assignments: Object.fromEntries(
        Object.entries(abConfig.assignments).filter(([key]) => key !== testId)
      )
    };
    updateAbConfig(next);
  };

  const handleAddTest = () => {
    if (!newTestId.trim() || !newTestName.trim()) return;
    const nextTest: ABTest = {
      id: newTestId.trim().toLowerCase().replace(/\s+/g, '_'),
      name: newTestName.trim(),
      description: newTestDesc.trim(),
      variants: {
        A: newVariantA.trim() || 'A案',
        B: newVariantB.trim() || 'B案'
      },
      active: false,
      createdAt: Date.now()
    };
    const next = {
      ...abConfig,
      tests: [...abConfig.tests, nextTest]
    };
    updateAbConfig(next);
    setNewTestId('');
    setNewTestName('');
    setNewTestDesc('');
    setNewVariantA('');
    setNewVariantB('');
  };

  const handleSaveGlobalSettings = async () => {
    setGlobalSettingsSaving(true);
    setGlobalSettingsStatus('');
    try {
      const response = await adminFetch('/api/v1/admin/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: globalSettings })
      });
      if (!response.ok) {
        throw new Error('全体設定の保存に失敗しました。');
      }
      const data = (await response.json()) as {
        ok: boolean;
        settings?: ManagedAppSettings;
        updatedAt?: number;
      };
      if (!data.ok || !data.settings) {
        throw new Error('全体設定の保存レスポンスが不正です。');
      }
      const merged = applyManagedSettings(settings, data.settings);
      onChangeSettings(merged);
      setGlobalSettings(toManagedSettings(merged));
      setGlobalSettingsUpdatedAt(data.updatedAt ?? Date.now());
      setGlobalSettingsStatus('全ユーザー向け設定を保存しました。再読み込み時に反映されます。');
    } catch (error) {
      setGlobalSettingsStatus((error as Error).message);
    } finally {
      setGlobalSettingsSaving(false);
    }
  };

  const contextValue = (context: unknown, key: string) => {
    if (!context || typeof context !== 'object' || Array.isArray(context)) return '';
    const value = (context as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
    return '';
  };

  const handleGenerateTest = () => {
    const built = buildQuestions(testWords, { count: questionCount, mode });
    if (built.length === 0) {
      setAuthStatus('テスト問題を作れる語がありません。');
      return;
    }
    setQuestions(built);
    setAnswers([]);
    setIndex(0);
    setTyping('');
    setAuthStatus('');
  };

  const handleChoice = (answer: string) => {
    if (!current) return;
    setAnswers((prev) => [...prev, { questionId: current.id, answer, correct: answer === current.answer }]);
    setIndex((prev) => prev + 1);
  };

  const handleTyping = () => {
    if (!current) return;
    const answer = typing.trim();
    const correct = isTypingCorrect(answer, current.answer);
    setAnswers((prev) => [...prev, { questionId: current.id, answer, correct }]);
    setTyping('');
    setIndex((prev) => prev + 1);
  };

  const handlePrint = () => {
    if (!selectedStudent || questions.length === 0) return;
    const html = buildPrintableTestHtml(`確認テスト: ${selectedStudent.email || selectedStudent.userId}`, questions, {
      subtitle: `対象: ${selectedStudent.userId}`,
      modeLabel: modeLabels[mode]
    });
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      setAuthStatus('ポップアップがブロックされました。');
      return;
    }
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
  };

  return (
    <section className="section-grid">
      <div className="card">
        <h2>🔐 管理者ログイン</h2>
        <p className="notice">Cloudflare Worker の `ADMIN_TOKEN` で認証します。</p>
        <input
          type="password"
          placeholder="ADMIN_TOKEN"
          value={tokenInput}
          onChange={(event) => setTokenInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void handleLogin();
            }
          }}
        />
        <div className="scan-inline-actions" style={{ marginTop: 12 }}>
          <button type="button" onClick={() => void handleLogin()}>認証する</button>
          {token && (
            <button type="button" className="secondary" onClick={handleLogout}>
              ログアウト
            </button>
          )}
        </div>
        {authStatus && <p className="counter">{authStatus}</p>}
      </div>

      {token && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>👩‍🏫 生徒の学習状況</h2>
            <button type="button" className="secondary" onClick={() => void loadStudents()} disabled={studentsLoading}>
              更新
            </button>
          </div>
          {studentsLoading && <p className="counter">読み込み中…</p>}
          {studentsError && <p className="counter">{studentsError}</p>}
          {!studentsLoading && students.length === 0 && <p>同期された生徒データがありません。</p>}
          {students.length > 0 && (
            <div className="word-grid">
              {students.map((student) => (
                <div key={student.userId} className="word-item">
                  <div>
                    <strong>{student.email || student.userId}</strong>
                    <small className="candidate-meta">
                      Lv.{student.level} / XP {student.xpTotal} / 履修 {student.learnedCount}語 / 登録 {student.cardCount}語
                    </small>
                    <small className="candidate-meta">
                      最終同期: {toDateLabel(student.syncedAt)} / 最終ログイン: {toDateLabel(student.lastLoginAt)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className={student.userId === selectedUserId ? '' : 'secondary'}
                    onClick={() => setSelectedUserId(student.userId)}
                  >
                    選択
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {token && (
        <div className="card">
          <h2>🌐 全体設定（全ユーザー）</h2>
          <p className="counter">
            クラウド上の共通設定です。各ユーザーは次回読み込み時に反映されます。
          </p>
          <p className="counter">
            更新: {toDateLabel(globalSettingsUpdatedAt)}
          </p>

          <label className="candidate-toggle">
            <input
              type="checkbox"
              checked={globalSettings.cloudOcrEnabled}
              onChange={(event) =>
                setGlobalSettings((prev) => ({ ...prev, cloudOcrEnabled: event.target.checked }))
              }
            />
            <span>クラウドOCRを既定で有効</span>
          </label>
          <label className="candidate-toggle">
            <input
              type="checkbox"
              checked={globalSettings.aiMeaningAssistEnabled}
              onChange={(event) =>
                setGlobalSettings((prev) => ({ ...prev, aiMeaningAssistEnabled: event.target.checked }))
              }
            />
            <span>AI意味提案を既定で有効</span>
          </label>
          <label className="candidate-toggle">
            <input
              type="checkbox"
              checked={globalSettings.ocrDebug}
              onChange={(event) =>
                setGlobalSettings((prev) => ({ ...prev, ocrDebug: event.target.checked }))
              }
            />
            <span>OCRデバッグ表示を既定で有効</span>
          </label>

          <label style={{ marginTop: 8 }}>既定PSM</label>
          <select
            value={globalSettings.defaultPsm}
            onChange={(event) =>
              setGlobalSettings((prev) => ({
                ...prev,
                defaultPsm: event.target.value as ManagedAppSettings['defaultPsm']
              }))
            }
          >
            <option value="6">6（文章ブロック）</option>
            <option value="11">11（バラバラ文字）</option>
            <option value="7">7（1行）</option>
          </select>

          <div className="scan-inline-actions" style={{ marginTop: 12 }}>
            <label style={{ flex: 1 }}>
              threshold
              <input
                type="number"
                min={0}
                max={255}
                value={globalSettings.defaultPreprocess.thresholdValue}
                onChange={(event) =>
                  setGlobalSettings((prev) => ({
                    ...prev,
                    defaultPreprocess: {
                      ...prev.defaultPreprocess,
                      thresholdValue: Math.max(0, Math.min(255, Number(event.target.value) || 0))
                    }
                  }))
                }
              />
            </label>
            <label style={{ flex: 1 }}>
              contrast
              <input
                type="number"
                step={0.01}
                min={0.5}
                max={2}
                value={globalSettings.defaultPreprocess.contrast}
                onChange={(event) =>
                  setGlobalSettings((prev) => ({
                    ...prev,
                    defaultPreprocess: {
                      ...prev.defaultPreprocess,
                      contrast: Math.max(0.5, Math.min(2, Number(event.target.value) || 0.5))
                    }
                  }))
                }
              />
            </label>
          </div>
          <div className="scan-inline-actions">
            <label style={{ flex: 1 }}>
              brightness
              <input
                type="number"
                min={-80}
                max={80}
                value={globalSettings.defaultPreprocess.brightness}
                onChange={(event) =>
                  setGlobalSettings((prev) => ({
                    ...prev,
                    defaultPreprocess: {
                      ...prev.defaultPreprocess,
                      brightness: Math.max(-80, Math.min(80, Number(event.target.value) || 0))
                    }
                  }))
                }
              />
            </label>
            <label style={{ flex: 1 }}>
              maxSide
              <input
                type="number"
                min={1200}
                max={2600}
                value={globalSettings.defaultPreprocess.maxSide}
                onChange={(event) =>
                  setGlobalSettings((prev) => ({
                    ...prev,
                    defaultPreprocess: {
                      ...prev.defaultPreprocess,
                      maxSide: Math.max(1200, Math.min(2600, Number(event.target.value) || 1200))
                    }
                  }))
                }
              />
            </label>
          </div>
          <div className="scan-inline-actions">
            <label className="candidate-toggle" style={{ flex: 1 }}>
              <input
                type="checkbox"
                checked={globalSettings.defaultPreprocess.grayscale}
                onChange={(event) =>
                  setGlobalSettings((prev) => ({
                    ...prev,
                    defaultPreprocess: {
                      ...prev.defaultPreprocess,
                      grayscale: event.target.checked
                    }
                  }))
                }
              />
              <span>grayscale</span>
            </label>
            <label className="candidate-toggle" style={{ flex: 1 }}>
              <input
                type="checkbox"
                checked={globalSettings.defaultPreprocess.threshold}
                onChange={(event) =>
                  setGlobalSettings((prev) => ({
                    ...prev,
                    defaultPreprocess: {
                      ...prev.defaultPreprocess,
                      threshold: event.target.checked
                    }
                  }))
                }
              />
              <span>threshold</span>
            </label>
            <label className="candidate-toggle" style={{ flex: 1 }}>
              <input
                type="checkbox"
                checked={globalSettings.defaultPreprocess.invert}
                onChange={(event) =>
                  setGlobalSettings((prev) => ({
                    ...prev,
                    defaultPreprocess: {
                      ...prev.defaultPreprocess,
                      invert: event.target.checked
                    }
                  }))
                }
              />
              <span>invert</span>
            </label>
          </div>

          <div className="scan-inline-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => void loadGlobalSettings()}
              disabled={globalSettingsLoading}
            >
              {globalSettingsLoading ? '読込中…' : '再読込'}
            </button>
            <button
              type="button"
              onClick={() => void handleSaveGlobalSettings()}
              disabled={globalSettingsSaving}
            >
              {globalSettingsSaving ? '保存中…' : '全ユーザーに保存'}
            </button>
          </div>
          {globalSettingsStatus && <p className="counter">{globalSettingsStatus}</p>}
        </div>
      )}

      {token && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>💬 アプリへの意見</h2>
            <button type="button" className="secondary" onClick={() => void loadFeedback()} disabled={feedbackLoading}>
              更新
            </button>
          </div>
          {feedbackLoading && <p className="counter">読み込み中…</p>}
          {feedbackError && <p className="counter">{feedbackError}</p>}
          {!feedbackLoading && feedbackList.length === 0 && <p>意見はまだありません。</p>}
          {feedbackList.length > 0 && (
            <div className="word-grid">
              {feedbackList.map((item) => (
                <div key={item.feedbackId} className="word-item" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <strong>[{item.type}] {item.message}</strong>
                    <small className="candidate-meta">
                      {toDateLabel(item.createdAt)} / {item.email || item.createdBy || '匿名'}
                    </small>
                    <small className="candidate-meta">
                      画面: {contextValue(item.context, 'screen') || '-'} / 端末: {contextValue(item.context, 'device') || '-'}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {token && (
        <div className="card">
          <h2>🧪 A/Bテスト管理</h2>
          <p className="counter">既存の実験管理機能をこのページに統合しています。</p>
          <button type="button" className="secondary" onClick={handleResetAssignments}>
            割り当てをリセット
          </button>

          <div className="word-grid" style={{ marginTop: 12 }}>
            {abConfig.tests.map((test) => (
              <div key={test.id} className="word-item" style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong>{test.name}</strong>
                  <small className="candidate-meta">ID: {test.id}</small>
                  <small className="candidate-meta">{test.description}</small>
                  <small className="candidate-meta">A: {test.variants.A} / B: {test.variants.B}</small>
                  <small className="candidate-meta">
                    状態: {test.active ? '有効' : '無効'}
                    {abConfig.assignments[test.id]
                      ? ` / 割り当て: ${abConfig.assignments[test.id].variant}`
                      : ''}
                  </small>
                </div>
                <div className="scan-inline-actions">
                  <button type="button" onClick={() => handleToggleTest(test.id)}>
                    {test.active ? '無効化' : '有効化'}
                  </button>
                  <button type="button" className="secondary" onClick={() => handleDeleteTest(test.id)}>
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>

          <details style={{ marginTop: 12 }}>
            <summary>＋ 新規A/Bテストを追加</summary>
            <label>テストID</label>
            <input value={newTestId} onChange={(event) => setNewTestId(event.target.value)} placeholder="例: review_header" />
            <label>テスト名</label>
            <input value={newTestName} onChange={(event) => setNewTestName(event.target.value)} placeholder="例: 復習ヘッダー比較" />
            <label>説明</label>
            <input value={newTestDesc} onChange={(event) => setNewTestDesc(event.target.value)} placeholder="例: タイトル表現を比較" />
            <div className="scan-inline-actions">
              <input value={newVariantA} onChange={(event) => setNewVariantA(event.target.value)} placeholder="A案" />
              <input value={newVariantB} onChange={(event) => setNewVariantB(event.target.value)} placeholder="B案" />
            </div>
            <button type="button" style={{ marginTop: 8 }} onClick={handleAddTest}>追加</button>
          </details>
        </div>
      )}

      {token && selectedStudent && (
        <div className="card">
          <h2>🧪 テスト作成</h2>
          <p className="counter">
            対象: {selectedStudent.email || selectedStudent.userId} / 利用可能語: {testWords.length}
          </p>
          {wordsLoading && <p className="counter">語彙データを読み込み中…</p>}
          {wordsError && <p className="counter">{wordsError}</p>}

          <label>テスト方式</label>
          <select value={mode} onChange={(event) => setMode(event.target.value as TestMode)}>
            <option value="mixed">ミックス</option>
            <option value="choice">4択（英語→日本語）</option>
            <option value="reverse">逆4択（日本語→英語）</option>
            <option value="typing">入力（日本語→英語）</option>
          </select>

          <label style={{ marginTop: 12 }}>問題数</label>
          <div className="scan-inline-actions">
            {[5, 10, 20].map((size) => (
              <button
                key={size}
                type="button"
                className={questionCount === size ? '' : 'secondary'}
                onClick={() => setQuestionCount(Math.min(size, Math.max(1, testWords.length)))}
              >
                {size}問
              </button>
            ))}
          </div>

          <div className="scan-inline-actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={handleGenerateTest} disabled={testWords.length === 0}>
              オンラインテストを作成
            </button>
            <button type="button" className="secondary" onClick={handlePrint} disabled={questions.length === 0}>
              印刷シート（PDF）
            </button>
          </div>
        </div>
      )}

      {questions.length > 0 && (
        <div className="card">
          <h2>📝 オンラインテスト</h2>
          {!finished && current && (
            <>
              <p className="badge">{index + 1}/{questions.length}</p>
              <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>{current.prompt}</p>

              {(current.type === 'choice' || current.type === 'reverse') && (
                <div className="word-grid">
                  {current.choices.map((choice) => (
                    <button
                      type="button"
                      key={choice}
                      className="secondary"
                      onClick={() => handleChoice(choice)}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              )}

              {current.type === 'typing' && (
                <>
                  <input
                    type="text"
                    value={typing}
                    placeholder="英単語を入力"
                    onChange={(event) => setTyping(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleTyping();
                      }
                    }}
                  />
                  <button type="button" style={{ marginTop: 10 }} onClick={handleTyping} disabled={!typing.trim()}>
                    回答
                  </button>
                </>
              )}
            </>
          )}

          {finished && (
            <>
              <p className="badge">正解 {score} / {questions.length}</p>
              <div className="scan-inline-actions">
                <button type="button" onClick={handleGenerateTest}>同条件で再作成</button>
                <button type="button" className="secondary" onClick={handlePrint}>印刷シート（PDF）</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setQuestions([]);
                    setAnswers([]);
                    setIndex(0);
                    setTyping('');
                  }}
                >
                  閉じる
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
