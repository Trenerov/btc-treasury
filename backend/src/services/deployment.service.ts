import { readFileSync } from 'fs';
import path from 'path';
import {
    TransactionFactory,
    IDeploymentParameters,
    UTXO,
    Address
} from '@btc-vision/transaction';
import { Psbt, networks } from '@btc-vision/bitcoin';
import { getProvider, network } from '../utils/provider.js';
import { logger } from '../utils/logger.js';
import { UnsignedPSBTBuilder, UnsignedDeploymentPSBTBuilder } from '../utils/psbt_builder.js';
import { DummySigner, DummyMLDSASigner } from '../utils/dummy_signer.js';

export class DeploymentService {
    private factory = new TransactionFactory();

    /**
     * Generates unsigned Funding and Reveal PSBTs for the PolicyVault deployment
     * @param walletAddress The OP_NET wallet address (P2TR)
     * @param publicKeyHex The hex-encoded public key of the wallet
     */
    public async generateDeploymentPSBTs(walletAddress: string, publicKeyHex: string) {
        const provider = getProvider();
        const wasmPath = path.join(process.cwd(), 'contract', 'build', 'PolicyVault.wasm');

        logger.info(`Generating deployment PSBTs for address: ${walletAddress}`);

        let bytecode: Buffer;
        try {
            bytecode = readFileSync(wasmPath);
        } catch (e) {
            throw new Error(`Contract WASM not found at ${wasmPath}. Run 'npm run build' in /contract first.`);
        }

        // Fetch UTXOs with buffer
        const utxos = await provider.utxoManager.getUTXOsForAmount({
            address: walletAddress,
            amount: 500_000n, // buffer for fees + output (sufficient for 20KB contract)
            mergePendingUTXOs: true,
            filterSpentUTXOs: true,
            throwErrors: true,
        });

        const challenge = await provider.getChallenge();

        // 1. Instantiate the DummySigners for safe fee estimation
        const dummySigner = new DummySigner(publicKeyHex, network as any);
        const dummyMLDSASigner = new DummyMLDSASigner(publicKeyHex);

        const params: IDeploymentParameters = {
            bytecode,
            challenge,
            utxos,
            feeRate: 5,
            priorityFee: 1000n,
            gasSatFee: 150_000n, // Increased to safely cover 19KB contract
            from: walletAddress,
            signer: dummySigner as any,
            network,
            mldsaSigner: dummyMLDSASigner as any
        };

        // 2. Iterate to find exact funding amount using the structural DeploymentTransaction
        const { finalTransaction, estimatedAmount, challenge: realChallenge } = await (this.factory as any).iterateFundingAmount(
            params,
            UnsignedDeploymentPSBTBuilder,
            async (tx: any) => {
                const fee = await tx.estimateTransactionFees();
                const totalInternalFee = params.gasSatFee + params.priorityFee;
                const optionalValue = tx.getOptionalOutputValue();
                return fee + totalInternalFee + optionalValue;
            },
            'Deployment'
        );

        // 3. Setup Funding Transaction parameters
        const fundingParams = await finalTransaction.getFundingTransactionParameters();
        fundingParams.utxos = params.utxos;
        fundingParams.amount = estimatedAmount;

        const feeEstimationFunding = await (this.factory as any).createFundTransaction({
            ...fundingParams,
            optionalOutputs: [],
            optionalInputs: [],
        });

        fundingParams.estimatedFees = feeEstimationFunding.estimatedFees;

        // 4. Construct Funding PSBT
        const fundingTx = new UnsignedPSBTBuilder({
            ...fundingParams,
            optionalInputs: [],
            optionalOutputs: [],
        });

        // Generate the PSBT structure (unsigned)
        await fundingTx.generateTransactionMinimalSignatures();

        // Safe helper to fetch raw transaction hex
        const getRawTransactionHex = async (txid: string): Promise<string | null> => {
            try {
                // Use internal JSON-RPC methods directly to avoid missing property issues
                const payload = (provider as any).buildJsonRpcPayload('btc_getTransactionByHash', [txid]);
                const response = await (provider as any).callPayloadSingle(payload);
                const result = response.result;

                if (typeof result === 'string') return result;
                if (result && typeof result === 'object' && result.transactionHex) return result.transactionHex;
                if (result && typeof result === 'object' && result.hex) return result.hex;

                return null;
            } catch (e) {
                logger.warn(`Failed to fetch raw transaction ${txid}: ${e}`);
                return null;
            }
        };

        // Fetch raw transactions for nonWitnessUtxo (Nuke Hash Mismatch Fix)
        const nonWitnessUtxos = new Map<string, string>();
        for (const utxo of utxos) {
            const rawTx = await getRawTransactionHex(utxo.transactionId);
            if (rawTx) nonWitnessUtxos.set(utxo.transactionId, rawTx);
        }

        fundingTx.prepareForSigning(publicKeyHex, nonWitnessUtxos);
        const fundingPsbt = fundingTx.getPSBTHex();

        // 5. Build Revealing (Deployment) PSBT
        // The first output of the funding transaction goes to the contract
        const fundingPsbtRawTx = (fundingTx as any).transaction.__CACHE.__TX;
        const fundingTxId = fundingPsbtRawTx.getId();
        const fundingTxOutput = fundingPsbtRawTx.outs[0];

        const contractAddress = (fundingTx as any).to;

        const newUtxo = {
            transactionId: fundingTxId,
            outputIndex: 0,
            scriptPubKey: {
                hex: fundingTxOutput.script.toString('hex'),
                address: contractAddress as string,
            },
            value: BigInt(fundingTxOutput.value),
        };

        const deploymentParams: IDeploymentParameters = {
            ...params,
            utxos: [newUtxo as any],
            randomBytes: finalTransaction.getRndBytes(),
            compiledTargetScript: finalTransaction.exportCompiledTargetScript(),
            challenge: realChallenge,
            // OP_NET Factory expects the funding TX buffer to calculate sighashes natively
            nonWitnessUtxo: fundingPsbtRawTx.toBuffer(),
            estimatedFees: finalTransaction.estimatedFees,
            optionalInputs: [],
        };

        const deploymentTx = new UnsignedDeploymentPSBTBuilder(deploymentParams);

        // Generate the deployment PSBT structure (unsigned)
        await deploymentTx.generateTransactionMinimalSignatures();

        // Fetch raw transactions for reveal inputs if needed
        const revealNonWitnessUtxos = new Map<string, string>();
        const revealInputTxIds = new Set<string>();
        // The funding result provides the TXID of the funding output we are consuming
        revealInputTxIds.add(fundingTxId);

        for (const txid of revealInputTxIds) {
            const rawTx = await getRawTransactionHex(txid);
            if (rawTx) revealNonWitnessUtxos.set(txid, rawTx);
        }

        deploymentTx.prepareForSigning(publicKeyHex, revealNonWitnessUtxos);
        const revealPsbt = deploymentTx.getPSBTHex();

        const actualContractAddress = deploymentTx.getContractAddress();

        return {
            bytecodeSize: bytecode.length,
            utxoCount: utxos.length,
            contractAddress: actualContractAddress,
            fundingPsbt,
            revealPsbt
        };
    }

    /**
     * Finalizes and broadcasts the signed transactions (PSBT or raw hex) to the OP_NET network.
     */
    public async broadcastDeployment(signedFundingHex: string, signedRevealHex: string) {
        const provider = getProvider();

        const isPsbt = (input: string) => {
            const h = input.toLowerCase();
            return h.startsWith('70736274') || // Hex magic
                input.startsWith('cHNid');   // Base64 magic "psbt"
        };

        logger.info(`BroadcastDeployment received: funding=${signedFundingHex.slice(0, 10)}..., reveal=${signedRevealHex.slice(0, 10)}...`);

        // 1. Handle Funding Transaction
        let fundingRawTx: string;
        if (isPsbt(signedFundingHex)) {
            try {
                const fPsbt = signedFundingHex.toLowerCase().startsWith('70736274')
                    ? Psbt.fromHex(signedFundingHex, { network })
                    : Psbt.fromBase64(signedFundingHex, { network });
                fPsbt.finalizeAllInputs();
                fundingRawTx = fPsbt.extractTransaction(true, true).toHex();
            } catch (e: any) {
                logger.error(`Funding PSBT finalization failed: ${e.message}`, { input: signedFundingHex.slice(0, 20) });
                throw new Error(`Failed to finalize Funding PSBT: ${e.message}`);
            }
        } else {
            fundingRawTx = signedFundingHex;
        }

        // Broadcast funding transaction
        const fundingResult = await provider.sendRawTransaction(fundingRawTx, false);
        if (!fundingResult.success) {
            throw new Error(`Funding broadcast failed: ${fundingResult.error}`);
        }
        logger.info(`Funding TX: ${fundingResult.result}`);

        // Wait a small moment for mempool propagation
        await new Promise(r => setTimeout(r, 1000));

        // 2. Handle Reveal (Deployment) Transaction
        let revealRawTx: string;
        if (isPsbt(signedRevealHex)) {
            try {
                const rPsbt = signedRevealHex.toLowerCase().startsWith('70736274')
                    ? Psbt.fromHex(signedRevealHex, { network })
                    : Psbt.fromBase64(signedRevealHex, { network });
                rPsbt.finalizeAllInputs();
                revealRawTx = rPsbt.extractTransaction(true, true).toHex();
            } catch (e: any) {
                logger.error(`Reveal PSBT finalization failed: ${e.message}`, { input: signedRevealHex.slice(0, 20) });
                throw new Error(`Failed to finalize Reveal PSBT: ${e.message}`);
            }
        } else {
            revealRawTx = signedRevealHex;
        }

        // Broadcast reveal transaction
        const revealResult = await provider.sendRawTransaction(revealRawTx, false);
        if (!revealResult.success) {
            throw new Error(`Reveal broadcast failed: ${revealResult.error}`);
        }
        logger.info(`Reveal TX: ${revealResult.result}`);

        return {
            fundingTxId: fundingResult.result,
            revealTxId: revealResult.result,
        };
    }

    /**
     * Generates an unsigned PSBT for funding (deposit)
     */
    public async generateFundingPSBT(senderAddress: string, publicKeyHex: string, toAddress: string, amountSats: bigint, walletUtxos?: any[]) {
        const provider = getProvider();
        const needed = amountSats + 10_000n;

        // Strategy 1: OP_NET RPC
        let utxos: any[] | null = null;
        try {
            utxos = await provider.utxoManager.getUTXOsForAmount({
                address: senderAddress,
                amount: needed,
                mergePendingUTXOs: true,
                filterSpentUTXOs: true,
                throwErrors: true,
            });
            logger.info(`Got ${utxos.length} UTXOs from RPC`);
        } catch (e: any) {
            logger.warn(`RPC UTXO fetch failed: ${e.message}`);
        }

        // Strategy 2: Wallet-provided UTXOs
        if ((!utxos || utxos.length === 0) && walletUtxos && walletUtxos.length > 0) {
            logger.info(`Trying ${walletUtxos.length} wallet-provided UTXOs...`);
            utxos = this.normalizeAndSelectUtxos(walletUtxos, senderAddress, needed);
        }

        // Strategy 3: Public Bitcoin testnet API (mempool.space / blockstream)
        if (!utxos || utxos.length === 0) {
            logger.info(`Trying public Bitcoin API for ${senderAddress}...`);
            const publicUtxos = await this.fetchUtxosFromPublicAPI(senderAddress);
            if (publicUtxos.length > 0) {
                utxos = this.normalizeAndSelectUtxos(publicUtxos, senderAddress, needed);
            }
        }

        if (!utxos || utxos.length === 0) {
            throw new Error('No UTXOs found from any source (RPC, wallet, public API). Ensure your wallet has testnet BTC.');
        }

        const dummySigner = new DummySigner(publicKeyHex, network as any);

        const fundingParams = {
            from: senderAddress,
            to: toAddress,
            amount: amountSats,
            utxos: utxos,
            feeRate: 5,
            network: network,
            signer: dummySigner as any,
        };

        const fundingTx = new UnsignedPSBTBuilder(fundingParams as any);
        await fundingTx.generateTransactionMinimalSignatures();

        // Fetch raw transactions for nonWitnessUtxo (same approach as deployment)
        const getRawTransactionHex = async (txid: string): Promise<string | null> => {
            try {
                const payload = (provider as any).buildJsonRpcPayload('btc_getTransactionByHash', [txid]);
                const response = await (provider as any).callPayloadSingle(payload);
                const result = response.result;

                if (typeof result === 'string') return result;
                if (result && typeof result === 'object' && result.transactionHex) return result.transactionHex;
                if (result && typeof result === 'object' && result.hex) return result.hex;

                return null;
            } catch (e) {
                logger.warn(`Failed to fetch raw transaction ${txid}: ${e}`);
                return null;
            }
        };

        const nonWitnessUtxos = new Map<string, string>();
        for (const utxo of utxos) {
            const rawTx = await getRawTransactionHex(utxo.transactionId);
            if (rawTx) nonWitnessUtxos.set(utxo.transactionId, rawTx);
        }

        fundingTx.prepareForSigning(publicKeyHex, nonWitnessUtxos);

        return {
            psbtHex: fundingTx.getPSBTHex(),
            estimatedFees: fundingTx.estimatedFees.toString(),
        };
    }

    /**
     * Fetch UTXOs from public Bitcoin testnet APIs (mempool.space, blockstream)
     */
    private async fetchUtxosFromPublicAPI(address: string): Promise<any[]> {
        const apis = [
            `https://mempool.space/testnet/api/address/${address}/utxo`,
            `https://blockstream.info/testnet/api/address/${address}/utxo`,
        ];

        for (const url of apis) {
            try {
                logger.info(`Fetching UTXOs from ${url}`);
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);

                const res = await fetch(url, { signal: controller.signal });
                clearTimeout(timeout);

                if (!res.ok) continue;

                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    logger.info(`Got ${data.length} UTXOs from public API`);
                    return data;
                }
            } catch (e: any) {
                logger.warn(`Public API ${url} failed: ${e.message}`);
            }
        }

        return [];
    }

    /**
     * Normalize UTXOs from various sources into the format expected by @btc-vision/transaction
     * and select enough to cover the needed amount.
     */
    private normalizeAndSelectUtxos(rawUtxos: any[], senderAddress: string, needed: bigint): any[] {
        const normalized = rawUtxos.map((u: any) => ({
            transactionId: u.txid || u.transactionId,
            outputIndex: u.vout ?? u.outputIndex ?? 0,
            scriptPubKey: {
                hex: typeof u.scriptPubKey === 'string' ? u.scriptPubKey : (u.scriptPubKey?.hex || ''),
                address: u.address || senderAddress,
            },
            value: BigInt(u.value || u.satoshis || 0),
        }));

        // Sort descending by value to minimize inputs
        normalized.sort((a: any, b: any) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1));

        let accumulated = 0n;
        const selected: any[] = [];
        for (const u of normalized) {
            selected.push(u);
            accumulated += BigInt(u.value);
            if (accumulated >= needed) break;
        }

        if (accumulated < needed) {
            logger.warn(`Insufficient UTXOs: available ${accumulated}, needed ${needed}`);
            return [];
        }

        logger.info(`Selected ${selected.length} UTXOs (total: ${accumulated} sats)`);
        return selected;
    }
}

export const deploymentService = new DeploymentService();
