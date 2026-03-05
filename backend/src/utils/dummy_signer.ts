import { Address } from '@btc-vision/transaction';
import { networks, Signer } from '@btc-vision/bitcoin';
import { QuantumBIP32Interface } from '@btc-vision/bip32';

/**
 * DummySigner specifically for estimating PSBT sizes on the Backend
 * without requiring real private keys or crashing during signature generation.
 */
export class DummySigner implements Signer {
    public readonly publicKey: Buffer;
    public readonly p2tr: Address;
    public network: any;

    constructor(publicKeyHex: string, networkMode: typeof networks.testnet) {
        this.publicKey = Buffer.from(publicKeyHex, 'hex');
        this.network = networkMode;
        // The p2tr address isn't strictly necessary for the signer size estimation, but we might need it
        this.p2tr = '' as unknown as Address; // Will be properly set by the factory from 'from'
    }

    public get publicKeyNoCoordinate(): Buffer {
        if (this.publicKey.length === 33) {
            return this.publicKey.subarray(1, 33);
        }
        return this.publicKey;
    }

    public sign(hash: Buffer): Buffer {
        // Return a dummy 64-byte Schnorr signature buffer for size estimation
        return Buffer.alloc(64, 1);
    }

    public signSchnorr(hash: Buffer): Buffer {
        return Buffer.alloc(64, 1);
    }
}

/**
 * Dummy MLDSASigner for deployment transactions on the Backend
 */
export class DummyMLDSASigner implements Partial<QuantumBIP32Interface> {
    public readonly publicKey: Buffer;
    public securityLevel: number = 2; // Dilithium2 by default

    constructor(publicKeyHex: string) {
        this.publicKey = Buffer.from(publicKeyHex, 'hex');
    }

    public sign(message: Buffer): Buffer {
        // Return a massive standard dummy signature size for ML-DSA
        // MLDSA44 (level 2) signature size is typically 2420 bytes
        return Buffer.alloc(2420, 1);
    }
}
