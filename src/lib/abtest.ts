/**
 * A/Bテスト管理システム
 * - テストバリアントの定義と管理
 * - ユーザー割り当て（sticky）
 * - 結果計測とダッシュボード用API
 */

import { db, incrementEvent } from '../db';

export type ABTestVariant = 'A' | 'B';

export type ABTest = {
    id: string;
    name: string;
    description: string;
    variants: {
        A: string; // バリアントAの説明
        B: string; // バリアントBの説明
    };
    active: boolean;
    createdAt: number;
};

export type ABTestAssignment = {
    testId: string;
    variant: ABTestVariant;
    assignedAt: number;
};

export type ABTestConfig = {
    tests: ABTest[];
    assignments: Record<string, ABTestAssignment>;
};

const STORAGE_KEY = 'abtest_config';
const ASSIGNMENT_KEY = 'abtest_assignments';

// デフォルトのA/Bテスト定義
const DEFAULT_TESTS: ABTest[] = [
    {
        id: 'wizard_display',
        name: 'ウィザード表示形式',
        description: 'ステップ表示を5ボタン vs ドット進捗で比較',
        variants: {
            A: '現行: 5ボタン横並び',
            B: '新案: ドット進捗表示'
        },
        active: false,
        createdAt: Date.now()
    },
    {
        id: 'empty_state_cta',
        name: '空状態のCTA',
        description: 'マスコット有無でCTAクリック率を比較',
        variants: {
            A: '現行: テキスト + ボタン',
            B: '新案: マスコット + テキスト + ボタン'
        },
        active: false,
        createdAt: Date.now()
    },
    {
        id: 'xp_label',
        name: 'ポイント表記',
        description: 'XP vs ポイントでエンゲージメントを比較',
        variants: {
            A: '現行: XP表記',
            B: '新案: ポイント表記'
        },
        active: false,
        createdAt: Date.now()
    }
];

/**
 * A/Bテスト設定を読み込む
 */
export const loadABTestConfig = (): ABTestConfig => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored) as ABTestConfig;
        }
    } catch {
        // ignore
    }
    return {
        tests: DEFAULT_TESTS,
        assignments: {}
    };
};

/**
 * A/Bテスト設定を保存する
 */
export const saveABTestConfig = (config: ABTestConfig): void => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

/**
 * ユーザー割り当てを取得または生成
 */
export const getVariant = (testId: string): ABTestVariant | null => {
    const config = loadABTestConfig();
    const test = config.tests.find((t) => t.id === testId);

    if (!test || !test.active) {
        return null; // テストが無効の場合はnull（デフォルト動作）
    }

    const existing = config.assignments[testId];
    if (existing) {
        return existing.variant;
    }

    // 新規割り当て（50/50）
    const variant: ABTestVariant = Math.random() < 0.5 ? 'A' : 'B';
    config.assignments[testId] = {
        testId,
        variant,
        assignedAt: Date.now()
    };
    saveABTestConfig(config);

    // 割り当てイベントを記録
    void incrementEvent(`abtest_assign_${testId}_${variant}`);

    return variant;
};

/**
 * テストを有効化/無効化
 */
export const setTestActive = (testId: string, active: boolean): void => {
    const config = loadABTestConfig();
    const test = config.tests.find((t) => t.id === testId);
    if (test) {
        test.active = active;
        saveABTestConfig(config);
    }
};

/**
 * 新しいテストを追加
 */
export const addTest = (test: Omit<ABTest, 'createdAt'>): void => {
    const config = loadABTestConfig();
    config.tests.push({
        ...test,
        createdAt: Date.now()
    });
    saveABTestConfig(config);
};

/**
 * テストを削除
 */
export const removeTest = (testId: string): void => {
    const config = loadABTestConfig();
    config.tests = config.tests.filter((t) => t.id !== testId);
    delete config.assignments[testId];
    saveABTestConfig(config);
};

/**
 * 全割り当てをリセット（テスト用）
 */
export const resetAssignments = (): void => {
    const config = loadABTestConfig();
    config.assignments = {};
    saveABTestConfig(config);
};

/**
 * A/Bテストコンバージョンを記録
 */
export const trackConversion = async (testId: string, eventName: string): Promise<void> => {
    const variant = getVariant(testId);
    if (variant) {
        await incrementEvent(`abtest_${testId}_${variant}_${eventName}`);
    }
};
