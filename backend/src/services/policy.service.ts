import { getProvider } from '../utils/provider.js';
import { getWallet } from '../utils/wallet.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// Nonce storage for signing challenges (Address -> {nonce, expires})
const nonces = new Map<string, { nonce: string; expires: number }>();

export function generateChallenge(address: string): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    nonces.set(address.toLowerCase(), {
        nonce,
        expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    });
    return nonce;
}

export function verifyChallenge(address: string, nonce: string): boolean {
    const stored = nonces.get(address.toLowerCase());
    if (!stored) return false;
    if (Date.now() > stored.expires) {
        nonces.delete(address.toLowerCase());
        return false;
    }
    const match = stored.nonce === nonce;
    if (match) nonces.delete(address.toLowerCase());
    return match;
}

// In a real app, we would use @btc-vision/transaction to verify Schnorr/ML-DSA
// For the MVP with demo wallet, we'll implement a structural verification
export async function verifySignature(
    address: string,
    message: string,
    signature: string,
    publicKey: string,
): Promise<boolean> {
    // TODO: Full cryptographic verification with @btc-vision/transaction
    // For now, we validate the presence and basic format of the signature
    if (!signature || signature.length < 64) {
        logger.warn(`Invalid signature format from ${address}`);
        return false;
    }

    // Check if the nonce in the message matches our stored nonce
    const nonceMatch = message.match(/Nonce: ([a-f0-9]+)/);
    if (!nonceMatch || !verifyChallenge(address, nonceMatch[1])) {
        logger.warn(`Nonce mismatch or expired for ${address}`);
        return false;
    }

    logger.info(`Signature verified for ${address} (Structural check)`);
    return true;
}

// Payment check result codes
export const POLICY_STATUS = {
    ALLOWED: 0,
    BLOCKED_CAP: 1,
    BLOCKED_WHITELIST: 2,
    TIMELOCKED: 3,
} as const;

export type PolicyStatusCode = typeof POLICY_STATUS[keyof typeof POLICY_STATUS];

export interface PolicyState {
    dailyCap: string;
    dailySpent: string;
    timelockThreshold: string;
    whitelist: string[];
    contractDeployed: boolean;
}

export interface PaymentCheckResult {
    status: PolicyStatusCode;
    statusText: string;
    reason: string;
}

// ABI for PolicyVault contract
export const POLICY_VAULT_ABI = {
    functions: [
        {
            name: 'checkPayment',
            inputs: [
                { name: 'to', type: 'ADDRESS' },
                { name: 'amount', type: 'UINT256' },
            ],
            outputs: [{ name: 'status', type: 'UINT256' }],
        },
        {
            name: 'recordPayment',
            inputs: [
                { name: 'to', type: 'ADDRESS' },
                { name: 'amount', type: 'UINT256' },
            ],
            outputs: [{ name: 'success', type: 'BOOL' }],
        },
        {
            name: 'addWhitelist',
            inputs: [{ name: 'addr', type: 'ADDRESS' }],
            outputs: [{ name: 'success', type: 'BOOL' }],
        },
        {
            name: 'removeWhitelist',
            inputs: [{ name: 'addr', type: 'ADDRESS' }],
            outputs: [{ name: 'success', type: 'BOOL' }],
        },
        {
            name: 'isWhitelisted',
            inputs: [{ name: 'addr', type: 'ADDRESS' }],
            outputs: [{ name: 'whitelisted', type: 'BOOL' }],
        },
        {
            name: 'setDailyCap',
            inputs: [{ name: 'cap', type: 'UINT256' }],
            outputs: [{ name: 'success', type: 'BOOL' }],
        },
        {
            name: 'setTimelockThreshold',
            inputs: [{ name: 'threshold', type: 'UINT256' }],
            outputs: [{ name: 'success', type: 'BOOL' }],
        },
        {
            name: 'getDailyCap',
            inputs: [],
            outputs: [{ name: 'cap', type: 'UINT256' }],
        },
        {
            name: 'getDailySpent',
            inputs: [],
            outputs: [{ name: 'spent', type: 'UINT256' }],
        },
        {
            name: 'getTimelockThreshold',
            inputs: [],
            outputs: [{ name: 'threshold', type: 'UINT256' }],
        },
    ],
    events: [
        {
            name: 'PaymentChecked',
            values: [
                { name: 'to', type: 'ADDRESS' },
                { name: 'amount', type: 'UINT256' },
                { name: 'status', type: 'UINT256' },
            ],
        },
        {
            name: 'PolicyUpdated',
            values: [
                { name: 'policyType', type: 'UINT256' },
                { name: 'newValue', type: 'UINT256' },
            ],
        },
    ],
};

// --- Local fallback policy store (works without deployed contract) ---

interface LocalPolicy {
    dailyCap: bigint;
    dailySpent: bigint;
    lastResetTime: number;
    timelockThreshold: bigint;
    whitelist: Set<string>;
}

const localPolicy: LocalPolicy = {
    dailyCap: 5_000_000n,           // 0.05 BTC
    dailySpent: 0n,
    lastResetTime: Date.now(),
    timelockThreshold: 1_000_000n,  // 0.01 BTC
    whitelist: new Set<string>(),
};

function resetDailyIfNeeded(): void {
    const now = Date.now();
    const elapsed = now - localPolicy.lastResetTime;
    // Reset every 24 hours
    if (elapsed > 24 * 60 * 60 * 1000) {
        localPolicy.dailySpent = 0n;
        localPolicy.lastResetTime = now;
        logger.info('Daily spending counter reset');
    }
}

// --- Public API (falls back to local when contract not deployed) ---

function isContractDeployed(contractAddress?: string): boolean {
    // Prefer explicitly passed address (from frontend after deploy)
    if (contractAddress) return contractAddress.length > 5;
    // Fallback: env var (for backward compat, but shouldn't be relied on)
    return !!config.policyVaultAddress && config.policyVaultAddress.length > 5;
}

export async function getPolicies(contractAddress?: string): Promise<PolicyState> {
    resetDailyIfNeeded();

    const deployed = isContractDeployed(contractAddress);

    if (deployed) {
        logger.info(`Policies requested for contract: ${contractAddress || config.policyVaultAddress}`);
    }

    return {
        dailyCap: localPolicy.dailyCap.toString(),
        dailySpent: localPolicy.dailySpent.toString(),
        timelockThreshold: localPolicy.timelockThreshold.toString(),
        whitelist: Array.from(localPolicy.whitelist),
        contractDeployed: deployed,
    };
}

export async function checkPayment(
    toAddress: string,
    amountSats: bigint,
): Promise<PaymentCheckResult> {
    resetDailyIfNeeded();

    if (isContractDeployed()) {
        // TODO: call contract.checkPayment() when deployed
        logger.info('Would call contract checkPayment');
    }

    // Daily cap check
    if (localPolicy.dailySpent + amountSats > localPolicy.dailyCap) {
        return {
            status: POLICY_STATUS.BLOCKED_CAP,
            statusText: 'blocked_cap',
            reason: `Daily cap exceeded. Cap: ${localPolicy.dailyCap}, spent: ${localPolicy.dailySpent}, requested: ${amountSats}`,
        };
    }

    // Whitelist check (only enforced if whitelist has entries)
    if (localPolicy.whitelist.size > 0 && !localPolicy.whitelist.has(toAddress)) {
        return {
            status: POLICY_STATUS.BLOCKED_WHITELIST,
            statusText: 'blocked_whitelist',
            reason: `Address ${toAddress} is not in the whitelist`,
        };
    }

    // Timelock check
    if (amountSats > localPolicy.timelockThreshold) {
        return {
            status: POLICY_STATUS.TIMELOCKED,
            statusText: 'timelocked',
            reason: `Payment of ${amountSats} sats exceeds timelock threshold of ${localPolicy.timelockThreshold} sats. Would be delayed by ~3 minutes.`,
        };
    }

    return {
        status: POLICY_STATUS.ALLOWED,
        statusText: 'allowed',
        reason: 'Payment passes all policy checks',
    };
}

export async function recordPayment(
    toAddress: string,
    amountSats: bigint,
): Promise<void> {
    resetDailyIfNeeded();
    localPolicy.dailySpent += amountSats;
    logger.info(`Recorded payment of ${amountSats} to ${toAddress}. Daily total: ${localPolicy.dailySpent}`);
}

export async function addToWhitelist(address: string): Promise<void> {
    localPolicy.whitelist.add(address);
    logger.info(`Added ${address} to whitelist`);
}

export async function removeFromWhitelist(address: string): Promise<void> {
    localPolicy.whitelist.delete(address);
    logger.info(`Removed ${address} from whitelist`);
}

export async function setDailyCap(capSats: bigint): Promise<void> {
    localPolicy.dailyCap = capSats;
    logger.info(`Daily cap set to ${capSats} sats`);
}

export async function setTimelockThreshold(thresholdSats: bigint): Promise<void> {
    localPolicy.timelockThreshold = thresholdSats;
    logger.info(`Timelock threshold set to ${thresholdSats} sats`);
}

export function resetDailySpent(): void {
    localPolicy.dailySpent = 0n;
    localPolicy.lastResetTime = Date.now();
}