import { Mnemonic, AddressTypes, MLDSASecurityLevel } from '@btc-vision/transaction';
import { config } from '../config.js';
import { logger } from './logger.js';
import { network } from './provider.js';

let walletInstance: ReturnType<Mnemonic['deriveUnisat']> | null = null;

export function getWallet() {
    if (!walletInstance) {
        if (!config.walletMnemonic) {
            throw new Error('WALLET_MNEMONIC not set in .env');
        }

        logger.info('Deriving wallet from mnemonic');

        const mnemonic = new Mnemonic(
            config.walletMnemonic,
            '',
            network,
            MLDSASecurityLevel.LEVEL2,
        );
        walletInstance = mnemonic.deriveUnisat(AddressTypes.P2TR, 0);
        logger.info(`Treasury address: ${walletInstance.p2tr}`);
    }
    return walletInstance;
}

export function getTreasuryAddress(): string {
    return getWallet().p2tr;
}
