import {
    FundingTransaction,
    DeploymentTransaction
} from '@btc-vision/transaction';

/**
 * Shared logic for preparing PSBTs from various builder roles.
 */
export class PSBTUtils {
    /**
     * Cleans a PSBT of any dummy signatures and prepares it for wallet signing.
     * @param transaction The raw transaction object from the builder (e.g., fundingTx.transaction)
     * @param publicKeyHex The user's public key
     * @param nonWitnessUtxos Map of txid -> raw hex for input transactions
     */
    public static prepareForSigning(
        transaction: any,
        publicKeyHex: string,
        nonWitnessUtxos?: Map<string, string>
    ): void {
        const pubKey = Buffer.from(publicKeyHex, 'hex');
        const xOnlyPubKey = pubKey.length === 33 ? pubKey.subarray(1, 33) : pubKey;

        for (let i = 0; i < transaction.inputCount; i++) {
            try {
                // 1. Wipe everything to ensure a clean hash calculation
                transaction.updateInput(i, {
                    partialSigs: [],
                    tapKeySig: undefined,
                    tapScriptSig: [],
                    finalScriptSig: undefined,
                    finalScriptWitness: undefined,
                    sighashType: 1, // Explicitly force SIGHASH_ALL for P2WPKH
                });

                const input = transaction.data.inputs[i];

                // 2. Help the wallet with nonWitnessUtxo if provided
                if (nonWitnessUtxos && input.hash) {
                    const txid = Buffer.from(input.hash).reverse().toString('hex');
                    const rawHex = nonWitnessUtxos.get(txid);
                    if (rawHex) {
                        transaction.updateInput(i, {
                            nonWitnessUtxo: Buffer.from(rawHex, 'hex'),
                        });
                    }
                }

                // 3. Taproot Identification logic
                const scriptPubKey = input.witnessUtxo?.script;

                // Identify Taproot (P2TR) inputs: starts with 0x5120
                if (scriptPubKey && scriptPubKey[0] === 0x51 && scriptPubKey[1] === 0x20) {
                    transaction.updateInput(i, {
                        tapInternalKey: xOnlyPubKey,
                    });
                }
            } catch (e) {
                console.warn(`Could not prepare input ${i} for signing:`, e);
            }
        }
    }
}

/**
 * A shared utility to expose the underlying PSBT from FundingTransaction.
 */
export class UnsignedPSBTBuilder extends FundingTransaction {
    public getPSBTHex(): string {
        return this.transaction.toHex();
    }

    public getPSBTBase64(): string {
        return this.transaction.toBase64();
    }

    public prepareForSigning(publicKeyHex: string, nonWitnessUtxos?: Map<string, string>): void {
        PSBTUtils.prepareForSigning(this.transaction, publicKeyHex, nonWitnessUtxos);
    }
}

/**
 * A shared utility to expose the underlying PSBT from DeploymentTransaction.
 */
export class UnsignedDeploymentPSBTBuilder extends DeploymentTransaction {
    public getPSBTHex(): string {
        return this.transaction.toHex();
    }

    public getPSBTBase64(): string {
        return this.transaction.toBase64();
    }

    public prepareForSigning(publicKeyHex: string, nonWitnessUtxos?: Map<string, string>): void {
        PSBTUtils.prepareForSigning(this.transaction, publicKeyHex, nonWitnessUtxos);
    }
}
