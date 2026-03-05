import { logger } from '../utils/logger.js';

export interface UTXOItem {
    transactionId: string;
    outputIndex: number;
    value: string;
    scriptPubKey: string;
    category: 'dust' | 'small' | 'medium' | 'large';
}

export interface UTXOAnalysis {
    totalBalance: string;
    utxoCount: number;
    dust: number;
    small: number;
    medium: number;
    large: number;
    dustValue: string;
    fragmentationScore: number;
    recommendation: string;
    consolidationSavings: {
        inputsBefore: number;
        inputsAfter: number;
        estimatedFeeSavingsPercent: number;
    };
}

// Thresholds in satoshis
const DUST_THRESHOLD = 546n;
const SMALL_THRESHOLD = 10_000n;
const MEDIUM_THRESHOLD = 100_000n;

export function categorize(value: bigint): UTXOItem['category'] {
    if (value < DUST_THRESHOLD) return 'dust';
    if (value < SMALL_THRESHOLD) return 'small';
    if (value < MEDIUM_THRESHOLD) return 'medium';
    return 'large';
}

// --- Demo UTXO data (used when RPC is unavailable) ---
function generateDemoUTXOs(): UTXOItem[] {
    const rng = (min: number, max: number) =>
        Math.floor(Math.random() * (max - min + 1)) + min;
    const txHash = (i: number) =>
        `a${i.toString().padStart(3, '0')}${'f'.repeat(60)}`.slice(0, 64);

    const entries: { value: number }[] = [
        // 8 dust UTXOs
        { value: 120 }, { value: 230 }, { value: 345 }, { value: 180 },
        { value: 410 }, { value: 90 }, { value: 500 }, { value: 280 },
        // 14 small UTXOs
        { value: 1200 }, { value: 2500 }, { value: 3800 }, { value: 5600 },
        { value: 750 }, { value: 4200 }, { value: 9100 }, { value: 6700 },
        { value: 1800 }, { value: 3300 }, { value: 7500 }, { value: 8200 },
        { value: 2100 }, { value: 4800 },
        // 12 medium UTXOs
        { value: 15000 }, { value: 22000 }, { value: 35000 }, { value: 48000 },
        { value: 67000 }, { value: 18500 }, { value: 91000 }, { value: 55000 },
        { value: 42000 }, { value: 73000 }, { value: 28000 }, { value: 60000 },
        // 6 large UTXOs
        { value: 150000 }, { value: 250000 }, { value: 500000 },
        { value: 1200000 }, { value: 350000 }, { value: 800000 },
    ];

    return entries.map((e, i) => ({
        transactionId: txHash(i),
        outputIndex: rng(0, 3),
        value: e.value.toString(),
        scriptPubKey: '{}',
        category: categorize(BigInt(e.value)),
    }));
}

let demoMode = false;
let cachedDemoUTXOs: UTXOItem[] | null = null;

function getDemoUTXOs(): UTXOItem[] {
    if (!cachedDemoUTXOs) {
        cachedDemoUTXOs = generateDemoUTXOs();
    }
    return cachedDemoUTXOs;
}

async function tryFetchLiveUTXOs(address: string): Promise<UTXOItem[] | null> {
    try {
        const { getProvider } = await import('../utils/provider.js');
        const provider = getProvider();
        const utxos = await provider.utxoManager.getUTXOs({
            address,
            optimize: false,
            mergePendingUTXOs: true,
            filterSpentUTXOs: true,
        });

        return utxos.map((u) => ({
            transactionId: u.transactionId,
            outputIndex: u.outputIndex,
            value: u.value.toString(),
            scriptPubKey: JSON.stringify(u.scriptPubKey),
            category: categorize(u.value),
        }));
    } catch (err: any) {
        logger.warn(`RPC unavailable, using demo mode: ${err.message}`);
        demoMode = true;
        return null;
    }
}

export async function getAllUTXOs(address: string): Promise<UTXOItem[]> {
    logger.info(`Fetching UTXOs for ${address}`);

    if (!demoMode) {
        const live = await tryFetchLiveUTXOs(address);
        if (live) return live;
    }

    logger.info('Using demo UTXO data (RPC unavailable)');
    return getDemoUTXOs();
}

export function analyzeItems(items: UTXOItem[]): UTXOAnalysis {
    let total = 0n;
    let dust = 0;
    let small = 0;
    let medium = 0;
    let large = 0;
    let dustValue = 0n;

    for (const item of items) {
        const v = BigInt(item.value);
        total += v;
        if (item.category === 'dust') { dust++; dustValue += v; }
        else if (item.category === 'small') small++;
        else if (item.category === 'medium') medium++;
        else large++;
    }

    const count = items.length;
    const fragmentationScore = count === 0
        ? 100
        : Math.round(100 - ((dust + small) / count * 100));

    const targetAfter = Math.max(1, Math.min(5, large + Math.ceil(medium / 2)));
    const savedInputs = count - targetAfter;
    const feeSavingsPercent = count > 0
        ? Math.round((savedInputs / count) * 100)
        : 0;

    let recommendation = 'UTXO set is healthy';
    if (dust > 0) {
        recommendation = `Consolidate ${dust} dust UTXOs to reclaim ${dustValue} sats`;
    } else if (small > 10) {
        recommendation = `Consolidate ${small} small UTXOs to reduce future fees`;
    } else if (count > 20) {
        recommendation = `Consolidate to reduce UTXO count from ${count}`;
    } else if (count > 1 && fragmentationScore < 50) {
        recommendation = `Fragmentation high — consolidation would save ~${feeSavingsPercent}% fees`;
    }

    return {
        totalBalance: total.toString(),
        utxoCount: count,
        dust,
        small,
        medium,
        large,
        dustValue: dustValue.toString(),
        fragmentationScore,
        recommendation,
        consolidationSavings: {
            inputsBefore: count,
            inputsAfter: targetAfter,
            estimatedFeeSavingsPercent: feeSavingsPercent,
        },
    };
}

export async function analyzeUTXOs(address: string): Promise<UTXOAnalysis> {
    const items = await getAllUTXOs(address);

    const analysis = analyzeItems(items);

    logger.info(
        `UTXO analysis: ${analysis.utxoCount} UTXOs, balance=${analysis.totalBalance}, score=${analysis.fragmentationScore}${demoMode ? ' [DEMO]' : ''}`
    );

    return analysis;
}
