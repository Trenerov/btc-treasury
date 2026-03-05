import { describe, it, expect, vi } from 'vitest';
import { networks } from '@btc-vision/bitcoin';
import { DummySigner, DummyMLDSASigner } from '../utils/dummy_signer';

describe('DummySigner', () => {
    const mockPublicKey = '03c37350cb3ea0df7c6e00ea9010abecb1c2b5e7d589d6e7f86641fe82de1dffd2';

    it('should instantiate correctly with a hex public key', () => {
        const signer = new DummySigner(mockPublicKey, networks.testnet);
        expect(signer.publicKey).toBeInstanceOf(Buffer);
        expect(signer.publicKey.toString('hex')).toBe(mockPublicKey);
    });

    it('should return a 32-byte buffer for publicKeyNoCoordinate', () => {
        const signer = new DummySigner(mockPublicKey, networks.testnet);
        const noCoord = signer.publicKeyNoCoordinate;
        expect(noCoord).toBeInstanceOf(Buffer);
        expect(noCoord.length).toBe(32);
        // The first byte (parity) is removed
        expect(noCoord.toString('hex')).toBe(mockPublicKey.substring(2));
    });

    it('should generate dummy standard signatures of correct size (64 bytes)', () => {
        const signer = new DummySigner(mockPublicKey, networks.testnet);
        const dummyHash = Buffer.alloc(32, 2);

        const sig1 = signer.sign(dummyHash);
        const sig2 = signer.signSchnorr(dummyHash);

        expect(sig1.length).toBe(64);
        expect(sig2.length).toBe(64);
    });
});

describe('DummyMLDSASigner', () => {
    const mockPublicKey = '03c37350cb3ea0df7c6e00ea9010abecb1c2b5e7d589d6e7f86641fe82de1dffd2';

    it('should generate dummy MLDSA signatures of massive size (2420 bytes)', () => {
        const signer = new DummyMLDSASigner(mockPublicKey);
        const dummyHash = Buffer.alloc(32, 2);

        const sig = signer.sign(dummyHash);

        expect(sig).toBeInstanceOf(Buffer);
        expect(sig.length).toBe(2420);
        expect(signer.securityLevel).toBe(2);
    });
});
