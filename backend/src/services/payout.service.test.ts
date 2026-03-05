import { describe, it, expect } from 'vitest';
import { parseCsv, validatePayouts } from './payout.service.js';

// --- parseCsv() ---
describe('parseCsv', () => {
    it('parses valid CSV with satoshi amounts', () => {
        const csv = 'tb1qabc123,50000\ntb1qdef456,100000';
        const result = parseCsv(csv);

        expect(result).toHaveLength(2);
        expect(result[0].address).toBe('tb1qabc123');
        expect(result[0].amountSats).toBe('50000');
        expect(result[1].amountSats).toBe('100000');
    });

    it('converts BTC amounts (< 1) to satoshis', () => {
        const csv = 'tb1qabc123,0.001';
        const result = parseCsv(csv);

        expect(result[0].amountSats).toBe('100000');
    });

    it('handles small BTC amount', () => {
        const csv = 'tb1qabc123,0.00001';
        const result = parseCsv(csv);

        expect(result[0].amountSats).toBe('1000');
    });

    it('skips header row starting with "address"', () => {
        const csv = 'address,amount\ntb1qabc123,50000';
        const result = parseCsv(csv);

        expect(result).toHaveLength(1);
        expect(result[0].address).toBe('tb1qabc123');
    });

    it('skips comment lines and empty lines', () => {
        const csv = '# this is a comment\n\ntb1qabc123,50000\n\n# another comment';
        const result = parseCsv(csv);

        expect(result).toHaveLength(1);
    });

    it('handles windows line endings', () => {
        const csv = 'tb1qabc123,50000\r\ntb1qdef456,100000\r\n';
        const result = parseCsv(csv);

        expect(result).toHaveLength(2);
    });

    it('sets initial status to "pending"', () => {
        const csv = 'tb1qabc123,50000';
        const result = parseCsv(csv);

        expect(result[0].status).toBe('pending');
    });

    it('skips lines with insufficient columns', () => {
        const csv = 'tb1qabc123\ntb1qdef456,50000';
        const result = parseCsv(csv);

        expect(result).toHaveLength(1);
        expect(result[0].address).toBe('tb1qdef456');
    });
});

// --- validatePayouts() ---
describe('validatePayouts', () => {
    it('calculates correct total amount', async () => {
        const payouts = [
            { address: 'tb1qabc', amountSats: '50000', status: 'pending' as const },
            { address: 'tb1qdef', amountSats: '100000', status: 'pending' as const },
        ];

        const result = await validatePayouts(payouts);
        expect(result.totalAmount).toBe('150000');
    });

    it('returns fee estimate based on output count', async () => {
        const payouts = [
            { address: 'tb1qabc', amountSats: '50000', status: 'pending' as const },
            { address: 'tb1qdef', amountSats: '100000', status: 'pending' as const },
        ];

        const result = await validatePayouts(payouts);
        // Fee = (58 + 2*34 + 10) * 5 = 680
        expect(result.estimatedFee).toBe('680');
    });

    it('sets all statuses to "allowed"', async () => {
        const payouts = [
            { address: 'tb1qabc', amountSats: '50000', status: 'pending' as const },
        ];

        const result = await validatePayouts(payouts);
        expect(result.allAllowed).toBe(true);
        expect(result.payouts[0].status).toBe('allowed');
    });

    it('handles empty payouts', async () => {
        const result = await validatePayouts([]);
        expect(result.totalAmount).toBe('0');
        expect(result.allAllowed).toBe(true);
        expect(result.payouts).toHaveLength(0);
    });
});
