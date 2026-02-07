import { useCallback, useEffect, useState } from 'react';
import {
    listEventCounters,
    getXpSummary,
    type EventCounter,
    type XpSummary,
    getXpRequiredForLevel
} from '../db';
import {
    loadABTestConfig,
    saveABTestConfig,
    resetAssignments,
    type ABTest,
    type ABTestConfig
} from '../lib/abtest';

const ADMIN_PASSWORD = 'nanjyo2024'; // 簡易的なパスワード保護

type AdminState = 'locked' | 'unlocked';

export default function AdminPage() {
    const [adminState, setAdminState] = useState<AdminState>('locked');
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');

    const [config, setConfig] = useState<ABTestConfig | null>(null);
    const [counters, setCounters] = useState<EventCounter[]>([]);
    const [xpSummary, setXpSummary] = useState<XpSummary | null>(null);

    // 新規テスト追加用
    const [newTestId, setNewTestId] = useState('');
    const [newTestName, setNewTestName] = useState('');
    const [newTestDesc, setNewTestDesc] = useState('');
    const [newVariantA, setNewVariantA] = useState('');
    const [newVariantB, setNewVariantB] = useState('');

    const loadData = useCallback(async () => {
        const abConfig = loadABTestConfig();
        const events = await listEventCounters();
        const xp = await getXpSummary();
        setConfig(abConfig);
        setCounters(events);
        setXpSummary(xp);
    }, []);

    useEffect(() => {
        if (adminState === 'unlocked') {
            void loadData();
        }
    }, [adminState, loadData]);

    const handleUnlock = () => {
        if (password === ADMIN_PASSWORD) {
            setAdminState('unlocked');
            setPasswordError('');
        } else {
            setPasswordError('パスワードが違います');
        }
    };

    const handleToggleTest = (testId: string) => {
        if (!config) return;
        const updated = {
            ...config,
            tests: config.tests.map((t) =>
                t.id === testId ? { ...t, active: !t.active } : t
            )
        };
        saveABTestConfig(updated);
        setConfig(updated);
    };

    const handleResetAssignments = () => {
        if (!confirm('全ユーザーの割り当てをリセットしますか？')) return;
        resetAssignments();
        void loadData();
    };

    const handleAddTest = () => {
        if (!config) return;
        if (!newTestId.trim() || !newTestName.trim()) return;

        const newTest: ABTest = {
            id: newTestId.trim().toLowerCase().replace(/\s+/g, '_'),
            name: newTestName.trim(),
            description: newTestDesc.trim(),
            variants: {
                A: newVariantA.trim() || 'バリアントA',
                B: newVariantB.trim() || 'バリアントB'
            },
            active: false,
            createdAt: Date.now()
        };

        const updated = {
            ...config,
            tests: [...config.tests, newTest]
        };
        saveABTestConfig(updated);
        setConfig(updated);

        // フォームリセット
        setNewTestId('');
        setNewTestName('');
        setNewTestDesc('');
        setNewVariantA('');
        setNewVariantB('');
    };

    const handleDeleteTest = (testId: string) => {
        if (!config) return;
        if (!confirm(`テスト「${testId}」を削除しますか？`)) return;

        const updated = {
            ...config,
            tests: config.tests.filter((t) => t.id !== testId)
        };
        delete updated.assignments[testId];
        saveABTestConfig(updated);
        setConfig(updated);
    };

    // ロック画面
    if (adminState === 'locked') {
        return (
            <section className="section-grid">
                <div className="card">
                    <h2>🔐 管理者ログイン</h2>
                    <p>管理者パスワードを入力してください。</p>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="パスワード"
                        onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                    />
                    {passwordError && <p style={{ color: 'red' }}>{passwordError}</p>}
                    <button onClick={handleUnlock} style={{ marginTop: 12 }}>
                        ログイン
                    </button>
                </div>
            </section>
        );
    }

    // ローディング
    if (!config || !xpSummary) {
        return (
            <section className="section-grid">
                <div className="card">
                    <h2>管理者ダッシュボード</h2>
                    <p>読み込み中...</p>
                </div>
            </section>
        );
    }

    // A/Bテスト関連のイベントを抽出
    const abtestEvents = counters.filter((c) => c.name.startsWith('abtest_'));
    const otherEvents = counters.filter((c) => !c.name.startsWith('abtest_'));

    return (
        <section className="section-grid">
            {/* ヘッダー */}
            <div className="card">
                <h2>📊 管理者ダッシュボード</h2>
                <p>A/Bテスト管理とアナリティクス</p>
            </div>

            {/* XP統計 */}
            <div className="card">
                <h3>⭐ ポイント統計</h3>
                <div className="stats-grid">
                    <div className="stat-item">
                        <span className="stat-value">{xpSummary.xpTotal}</span>
                        <span className="stat-label">累計ポイント</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">Lv.{xpSummary.level}</span>
                        <span className="stat-label">現在レベル</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">{xpSummary.dailyEarned}</span>
                        <span className="stat-label">本日獲得</span>
                    </div>
                </div>
                <details style={{ marginTop: 16 }}>
                    <summary>レベル必要ポイント</summary>
                    <table style={{ width: '100%', fontSize: '0.9rem', marginTop: 8 }}>
                        <thead>
                            <tr>
                                <th>レベル</th>
                                <th>累計必要pt</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[2, 3, 5, 10, 15, 20].map((lv) => (
                                <tr key={lv}>
                                    <td>Lv.{lv}</td>
                                    <td>{getXpRequiredForLevel(lv)} pt</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </details>
            </div>

            {/* A/Bテスト管理 */}
            <div className="card">
                <h3>🧪 A/Bテスト管理</h3>
                <button
                    className="secondary"
                    onClick={handleResetAssignments}
                    style={{ marginBottom: 16 }}
                >
                    全割り当てリセット
                </button>

                {config.tests.length === 0 && <p>テストがありません。</p>}

                {config.tests.map((test) => (
                    <div
                        key={test.id}
                        style={{
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: 12,
                            marginBottom: 12,
                            background: test.active ? 'rgba(255,200,100,0.1)' : 'transparent'
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <strong>{test.name}</strong>
                                <span
                                    style={{
                                        marginLeft: 8,
                                        padding: '2px 8px',
                                        borderRadius: 4,
                                        fontSize: '0.75rem',
                                        background: test.active ? '#4CAF50' : '#888',
                                        color: 'white'
                                    }}
                                >
                                    {test.active ? '有効' : '無効'}
                                </span>
                            </div>
                            <div>
                                <button
                                    className={test.active ? 'secondary' : ''}
                                    onClick={() => handleToggleTest(test.id)}
                                    style={{ marginRight: 8 }}
                                >
                                    {test.active ? '無効化' : '有効化'}
                                </button>
                                <button
                                    className="secondary"
                                    onClick={() => handleDeleteTest(test.id)}
                                >
                                    削除
                                </button>
                            </div>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '8px 0' }}>
                            {test.description}
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div style={{ padding: 8, background: 'rgba(0,100,255,0.1)', borderRadius: 4 }}>
                                <small>A: {test.variants.A}</small>
                            </div>
                            <div style={{ padding: 8, background: 'rgba(255,100,0,0.1)', borderRadius: 4 }}>
                                <small>B: {test.variants.B}</small>
                            </div>
                        </div>
                        {/* 割り当て状況 */}
                        {config.assignments[test.id] && (
                            <p style={{ fontSize: '0.8rem', marginTop: 8 }}>
                                現在の割り当て: <strong>{config.assignments[test.id].variant}</strong>
                            </p>
                        )}
                    </div>
                ))}

                {/* 新規テスト追加 */}
                <details style={{ marginTop: 16 }}>
                    <summary>＋ 新規テストを追加</summary>
                    <div style={{ marginTop: 12 }}>
                        <label>テストID（英数字）</label>
                        <input
                            type="text"
                            value={newTestId}
                            onChange={(e) => setNewTestId(e.target.value)}
                            placeholder="例: button_color"
                        />
                        <label>テスト名</label>
                        <input
                            type="text"
                            value={newTestName}
                            onChange={(e) => setNewTestName(e.target.value)}
                            placeholder="例: ボタンカラーテスト"
                        />
                        <label>説明</label>
                        <input
                            type="text"
                            value={newTestDesc}
                            onChange={(e) => setNewTestDesc(e.target.value)}
                            placeholder="例: 青ボタン vs ピンクボタン"
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div>
                                <label>バリアントA</label>
                                <input
                                    type="text"
                                    value={newVariantA}
                                    onChange={(e) => setNewVariantA(e.target.value)}
                                    placeholder="A の説明"
                                />
                            </div>
                            <div>
                                <label>バリアントB</label>
                                <input
                                    type="text"
                                    value={newVariantB}
                                    onChange={(e) => setNewVariantB(e.target.value)}
                                    placeholder="B の説明"
                                />
                            </div>
                        </div>
                        <button onClick={handleAddTest} style={{ marginTop: 12 }}>
                            テストを追加
                        </button>
                    </div>
                </details>
            </div>

            {/* A/Bテスト結果 */}
            {abtestEvents.length > 0 && (
                <div className="card">
                    <h3>📈 A/Bテスト結果</h3>
                    <table style={{ width: '100%', fontSize: '0.85rem' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left' }}>イベント</th>
                                <th style={{ textAlign: 'right' }}>カウント</th>
                            </tr>
                        </thead>
                        <tbody>
                            {abtestEvents.map((event) => (
                                <tr key={event.name}>
                                    <td>{event.name.replace('abtest_', '')}</td>
                                    <td style={{ textAlign: 'right' }}>{event.count}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* イベントカウンター */}
            <div className="card">
                <h3>📋 イベントログ</h3>
                {otherEvents.length === 0 && <p>まだイベントがありません。</p>}
                {otherEvents.length > 0 && (
                    <table style={{ width: '100%', fontSize: '0.85rem' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left' }}>イベント</th>
                                <th style={{ textAlign: 'right' }}>カウント</th>
                            </tr>
                        </thead>
                        <tbody>
                            {otherEvents.map((event) => (
                                <tr key={event.name}>
                                    <td>{event.name}</td>
                                    <td style={{ textAlign: 'right' }}>{event.count}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </section>
    );
}
