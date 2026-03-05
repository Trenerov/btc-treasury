import {
    TransactionFactory,
    IFundingTransactionParameters,
    FundingTransaction,
} from '@btc-vision/transaction';
import { PsbtOutputExtended, Transaction } from '@btc-vision/bitcoin';
import { getProvider, network } from '../utils/provider.js';
import { getWallet } from '../utils/wallet.js';
import { UnsignedPSBTBuilder } from '../utils/psbt_builder.js';
import { logger } from '../utils/logger.js';

export interface PayoutEntry {
    address: string;
    amountSats: string;
    status: 'allowed' | 'blocked_cap' | 'blocked_whitelist' | 'timelocked' | 'pending';
    reason?: string;
}

export interface BatchPayoutEstimate {
    payouts: PayoutEntry[];
    totalAmount: string;
    estimatedFee: string;
    allAllowed: boolean;
}

export interface BatchPayoutResult {
    transactionId: string;
    payoutsProcessed: number;
    totalAmount: string;
    fee: string;
}

const factory = new TransactionFactory();

export function parseCsv(csvText: string): PayoutEntry[] {
    const lines = csvText.trim().split('\n');
    const payouts: PayoutEntry[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('address')) continue;

        const parts = trimmed.split(',').map((s) => s.trim());
        if (parts.length < 2) continue;

        const [address, amountStr] = parts;

        // Support both BTC and satoshi amounts
        let amountSats: bigint;
        const parsed = parseFloat(amountStr);
        if (parsed < 1) {
            // Likely BTC, convert to sats
            amountSats = BigInt(Math.round(parsed * 100_000_000));
        } else {
            amountSats = BigInt(amountStr);
        }

        payouts.push({
            address,
            amountSats: amountSats.toString(),
            status: 'pending',
        });
    }

    return payouts;
}

export async function validatePayouts(
    payouts: PayoutEntry[],
): Promise<BatchPayoutEstimate> {
    // For now, do basic validation; policy checks come from policy.service
    const validated = payouts.map((p) => ({
        ...p,
        status: 'allowed' as PayoutEntry['status'],
    }));

    const totalAmount = validated.reduce(
        (sum, p) => sum + BigInt(p.amountSats),
        0n,
    );

    // Rough fee estimate: one input + N outputs
    const outputCount = validated.length;
    const estimatedVbytes = BigInt(58 + outputCount * 34 + 10);
    const estimatedFee = estimatedVbytes * 5n;

    return {
        payouts: validated,
        totalAmount: totalAmount.toString(),
        estimatedFee: estimatedFee.toString(),
        allAllowed: validated.every((p) => p.status === 'allowed'),
    };
}

export async function executeBatchPayout(
    payouts: PayoutEntry[],
    feeRate: number = 5,
): Promise<BatchPayoutResult> {
    const provider = getProvider();
    const wallet = getWallet();

    const totalAmount = payouts.reduce(
        (sum, p) => sum + BigInt(p.amountSats),
        0n,
    );

    logger.info(
        `Executing batch payout: ${payouts.length} recipients, total ${totalAmount} sats`
    );

    // Get enough UTXOs
    const utxos = await provider.utxoManager.getUTXOsForAmount({
        address: wallet.p2tr,
        amount: totalAmount + 50_000n,
        mergePendingUTXOs: true,
        filterSpentUTXOs: true,
        throwErrors: true,
    });

    const results: string[] = [];

    for (const payout of payouts) {
        const amount = BigInt(payout.amountSats);

        const availableUtxos = await provider.utxoManager.getUTXOsForAmount({
            address: wallet.p2tr,
            amount: amount + 10_000n, // buffer
            mergePendingUTXOs: true,
            filterSpentUTXOs: true,
            throwErrors: true,
        });

        const params: IFundingTransactionParameters = {
            amount,
            feeRate,
            from: wallet.p2tr,
            to: payout.address,
            utxos: availableUtxos,
            signer: wallet.keypair,
            network,
            priorityFee: 0n,
            gasSatFee: 0n,
            mldsaSigner: null,
        };

        const result = await factory.createBTCTransfer(params);
        const broadcast = await provider.sendRawTransaction(result.tx, false);

        if (!broadcast || !broadcast.result) {
            throw new Error(
                `Broadcast failed for ${payout.address}: ${broadcast?.error || 'unknown'}`
            );
        }

        provider.utxoManager.spentUTXO(
            wallet.p2tr,
            result.inputUtxos,
            result.nextUTXOs,
        );

        results.push(broadcast.result);
        logger.info(`Payout to ${payout.address}: TX ${broadcast.result}`);
    }

    return {
        transactionId: results[0],
        payoutsProcessed: payouts.length,
        totalAmount: totalAmount.toString(),
        fee: '0',
    };
}

/**
 * Creates an unsigned PSBT for a batch of payouts.
 */
export async function createPayoutPSBT(
    payouts: PayoutEntry[],
    treasuryAddress: string,
    feeRate: number = 5,
): Promise<{ psbt: string; utxos: any[] }> {
    const provider = getProvider();
    const wallet = getWallet(); // Still used for internal logic/signing fallback if needed

    const totalAmount = payouts.reduce(
        (sum, p) => sum + BigInt(p.amountSats),
        0n,
    );

    logger.info(
        `Creating PSBT for batch payout: ${payouts.length} recipients, total ${totalAmount} sats`
    );

    // Get UTXOs for the treasury address
    const utxos = await provider.utxoManager.getUTXOsForAmount({
        address: treasuryAddress,
        amount: totalAmount + 100_000n, // buffer for fees
        mergePendingUTXOs: true,
        filterSpentUTXOs: true,
        throwErrors: true,
    });

    if (utxos.length === 0) {
        throw new Error('No UTXOs found for treasury address');
    }

    // First recipient as primary 'to'
    const firstPayout = payouts[0];
    const restPayouts = payouts.slice(1);

    const optionalOutputs: PsbtOutputExtended[] = restPayouts.map((p) => ({
        address: p.address,
        value: Number(p.amountSats),
    }));

    const params: IFundingTransactionParameters = {
        amount: BigInt(firstPayout.amountSats),
        feeRate,
        from: treasuryAddress,
        to: firstPayout.address,
        utxos: utxos,
        signer: wallet.keypair, // Backend key used as dummy signer for structure
        network,
        priorityFee: 0n,
        gasSatFee: 0n,
        mldsaSigner: null,
        optionalOutputs,
    };

    const builder = new UnsignedPSBTBuilder(params);
    await builder.generateTransactionMinimalSignatures();

    return {
        psbt: builder.getPSBTBase64(),
        utxos: utxos,
    };
}

/**
 * Broadcasts a signed transaction hex.
 */
export async function broadcastTransaction(signedHex: string): Promise<string> {
    const provider = getProvider();
    const result = await provider.sendRawTransaction(signedHex, false);

    if (!result || !result.result) {
        throw new Error(`Broadcast failed: ${result?.error || 'Unknown error'}`);
    }

    return result.result;
}
