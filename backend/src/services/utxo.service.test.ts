import { describe, it, expect } from 'vitest';
import { categorize, analyzeItems, UTXOItem } from './utxo.service.js';

// --- Helper ---
function makeUTXO(value: number, index = 0): UTXOItem {
    return {
        transactionId: `a${index.toString().padStart(3, '0')}${'f'.repeat(60)}`.slice(0, 64),
        outputIndex: 0,
        value: value.toString(),
        scriptPubKey: '{}',
        category: categorize(BigInt(value)),
    };
}

// --- categorize() ---
describe('categorize', () => {
    it('returns "dust" for values below 546 sats', () => {
        expect(categorize(0n)).toBe('dust');
        expect(categorize(100n)).toBe('dust');
        expect(categorize(545n)).toBe('dust');
    });

    it('returns "small" for values 546–9999 sats', () => {
        expect(categorize(546n)).toBe('small');
        expect(categorize(1000n)).toBe('small');
        expect(categorize(9999n)).toBe('small');
    });

    it('returns "medium" for values 10000–99999 sats', () => {
        expect(categorize(10_000n)).toBe('medium');
        expect(categorize(50_000n)).toBe('medium');
        expect(categorize(99_999n)).toBe('medium');
    });

    it('returns "large" for values >= 100000 sats', () => {
        expect(categorize(100_000n)).toBe('large');
        expect(categorize(1_000_000n)).toBe('large');
        expect(categorize(100_000_000n)).toBe('large');
    });
});

// --- analyzeItems() ---
describe('analyzeItems', () => {
    it('handles empty UTXO set', () => {
        const result = analyzeItems([]);
        expect(result.utxoCount).toBe(0);
        expect(result.totalBalance).toBe('0');
        expect(result.fragmentationScore).toBe(100);
        expect(result.dust).toBe(0);
        expect(result.small).toBe(0);
        expect(result.medium).toBe(0);
        expect(result.large).toBe(0);
    });

    it('counts categories correctly', () => {
        const items = [
            makeUTXO(100),   // dust
            makeUTXO(200),   // dust
            makeUTXO(1000),  // small
            makeUTXO(50000), // medium
            makeUTXO(200000),// large
        ];

        const result = analyzeItems(items);
        expect(result.dust).toBe(2);
        expect(result.small).toBe(1);
        expect(result.medium).toBe(1);
        expect(result.large).toBe(1);
        expect(result.utxoCount).toBe(5);
    });

    it('calculates total balance', () => {
        const items = [
            makeUTXO(100),
            makeUTXO(1000),
            makeUTXO(50000),
        ];

        const result = analyzeItems(items);
        expect(result.totalBalance).toBe('51100');
    });

    it('calculates dust value correctly', () => {
        const items = [
            makeUTXO(100),
            makeUTXO(200),
            makeUTXO(50000),
        ];

        const result = analyzeItems(items);
        expect(result.dustValue).toBe('300');
    });

    it('fragmentation score = 100 when all large', () => {
        const items = [
            makeUTXO(200_000),
            makeUTXO(500_000),
            makeUTXO(1_000_000),
        ];

        const result = analyzeItems(items);
        expect(result.fragmentationScore).toBe(100);
    });

    it('fragmentation score = 0 when all dust', () => {
        const items = [
            makeUTXO(100),
            makeUTXO(200),
            makeUTXO(300),
        ];

        const result = analyzeItems(items);
        expect(result.fragmentationScore).toBe(0);
    });

    it('fragmentation score is proportional', () => {
        // 2 dust + 2 large = (2/4 * 100) = 50% bad → score 50
        const items = [
            makeUTXO(100),
            makeUTXO(200),
            makeUTXO(200_000),
            makeUTXO(500_000),
        ];

        const result = analyzeItems(items);
        expect(result.fragmentationScore).toBe(50);
    });

    it('recommends consolidation when dust present', () => {
        const items = [
            makeUTXO(100),
            makeUTXO(200000),
        ];

        const result = analyzeItems(items);
        expect(result.recommendation).toContain('Consolidate');
        expect(result.recommendation).toContain('dust');
    });

    it('reports "healthy" when no issues', () => {
        const items = [
            makeUTXO(200_000),
            makeUTXO(500_000),
        ];

        const result = analyzeItems(items);
        expect(result.recommendation).toBe('UTXO set is healthy');
    });

    it('consolidation savings estimate is correct', () => {
        const items = [
            makeUTXO(100),
            makeUTXO(200),
            makeUTXO(1000),
            makeUTXO(50000),
            makeUTXO(200000),
        ];

        const result = analyzeItems(items);
        expect(result.consolidationSavings.inputsBefore).toBe(5);
        expect(result.consolidationSavings.inputsAfter).toBeGreaterThanOrEqual(1);
        expect(result.consolidationSavings.inputsAfter).toBeLessThan(5);
        expect(result.consolidationSavings.estimatedFeeSavingsPercent).toBeGreaterThan(0);
    });
});
