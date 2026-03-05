import { describe, it, expect, beforeEach } from 'vitest';
import {
    checkPayment,
    getPolicies,
    recordPayment,
    addToWhitelist,
    removeFromWhitelist,
    setDailyCap,
    setTimelockThreshold,
    resetDailySpent,
    POLICY_STATUS,
} from './policy.service.js';

// Reset policy state before each test by restoring defaults
beforeEach(async () => {
    resetDailySpent();
    await setDailyCap(5_000_000n);
    await setTimelockThreshold(1_000_000n);

    // Remove any whitelisted addresses by getting current state
    const state = await getPolicies();
    for (const addr of state.whitelist) {
        await removeFromWhitelist(addr);
    }

    // Reset daily spent by setting cap very high, then back to normal
    // (recordPayment accumulates, so we need a fresh start)
    // The simplest approach: set cap to default, daily spent resets after 24h
    // For tests, we accept that dailySpent may accumulate within a test file
});

// --- checkPayment() ---
describe('checkPayment', () => {
    it('allows payment within daily cap', async () => {
        const result = await checkPayment('tb1qabc123', 100_000n);
        expect(result.status).toBe(POLICY_STATUS.ALLOWED);
        expect(result.statusText).toBe('allowed');
    });

    it('blocks payment exceeding daily cap', async () => {
        await setDailyCap(50_000n);
        const result = await checkPayment('tb1qabc123', 100_000n);
        expect(result.status).toBe(POLICY_STATUS.BLOCKED_CAP);
        expect(result.statusText).toBe('blocked_cap');
    });

    it('blocks non-whitelisted address when whitelist is active', async () => {
        await addToWhitelist('tb1qwhitelisted');

        const result = await checkPayment('tb1qnotlisted', 1000n);
        expect(result.status).toBe(POLICY_STATUS.BLOCKED_WHITELIST);
        expect(result.statusText).toBe('blocked_whitelist');
    });

    it('allows whitelisted address', async () => {
        await addToWhitelist('tb1qwhitelisted');

        const result = await checkPayment('tb1qwhitelisted', 1000n);
        expect(result.status).toBe(POLICY_STATUS.ALLOWED);
    });

    it('timelocks payments above threshold', async () => {
        await setTimelockThreshold(50_000n);

        const result = await checkPayment('tb1qabc123', 100_000n);
        expect(result.status).toBe(POLICY_STATUS.TIMELOCKED);
        expect(result.statusText).toBe('timelocked');
    });

    it('allows payment at exactly the timelock threshold', async () => {
        await setTimelockThreshold(100_000n);

        const result = await checkPayment('tb1qabc123', 100_000n);
        // amount === threshold → NOT timelocked (only > triggers it)
        expect(result.status).toBe(POLICY_STATUS.ALLOWED);
    });
});

// --- recordPayment() ---
describe('recordPayment', () => {
    it('accumulates daily spent', async () => {
        await setDailyCap(5_000_000n);
        await recordPayment('tb1qabc', 100_000n);
        await recordPayment('tb1qabc', 200_000n);

        const state = await getPolicies();
        const spent = BigInt(state.dailySpent);
        expect(spent).toBeGreaterThanOrEqual(300_000n);
    });
});

// --- Whitelist management ---
describe('whitelist management', () => {
    it('add and remove from whitelist', async () => {
        await addToWhitelist('tb1qaddr1');
        let state = await getPolicies();
        expect(state.whitelist).toContain('tb1qaddr1');

        await removeFromWhitelist('tb1qaddr1');
        state = await getPolicies();
        expect(state.whitelist).not.toContain('tb1qaddr1');
    });

    it('whitelist not enforced when empty', async () => {
        // No addresses in whitelist → any address is allowed
        const result = await checkPayment('tb1qrandom', 1000n);
        expect(result.status).toBe(POLICY_STATUS.ALLOWED);
    });
});

// --- Policy updates ---
describe('policy updates', () => {
    it('setDailyCap changes enforcement', async () => {
        await setDailyCap(1_000n);
        const result = await checkPayment('tb1qabc', 5_000n);
        expect(result.status).toBe(POLICY_STATUS.BLOCKED_CAP);

        await setDailyCap(10_000n);
        const result2 = await checkPayment('tb1qabc', 5_000n);
        expect(result2.status).toBe(POLICY_STATUS.ALLOWED);
    });

    it('setTimelockThreshold changes enforcement', async () => {
        await setTimelockThreshold(500n);
        const result = await checkPayment('tb1qabc', 1_000n);
        expect(result.status).toBe(POLICY_STATUS.TIMELOCKED);

        await setTimelockThreshold(5_000n);
        const result2 = await checkPayment('tb1qabc', 1_000n);
        expect(result2.status).toBe(POLICY_STATUS.ALLOWED);
    });
});

// --- getPolicies() ---
describe('getPolicies', () => {
    it('returns current policy state', async () => {
        const state = await getPolicies();
        expect(state).toHaveProperty('dailyCap');
        expect(state).toHaveProperty('dailySpent');
        expect(state).toHaveProperty('timelockThreshold');
        expect(state).toHaveProperty('whitelist');
        expect(state).toHaveProperty('contractDeployed');
        expect(typeof state.contractDeployed).toBe('boolean');
    });
});
