import 'dotenv/config';

const port = parseInt(process.env.PORT || '3001', 10);
const proxyUrl = process.env.PROXY_URL || '';
const defaultOpnetUrl = process.env.OPNET_RPC_URL || 'https://testnet.opnet.org';

export const config = {
    port,
    opnetRpcUrl: proxyUrl ? `http://localhost:${port}/opnet-rpc` : defaultOpnetUrl,
    proxyUrl,
    walletMnemonic: process.env.WALLET_MNEMONIC || '',
    policyVaultAddress: process.env.POLICY_VAULT_ADDRESS || '',
};
