import 'dotenv/config';
import { config } from '../src/config.js';
import { getWallet } from '../src/utils/wallet.js';
import { JSONRpcProvider } from 'opnet';
import { TransactionFactory, IDeploymentParameters } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import fs from 'fs';
import path from 'path';

async function deploy() {
    console.log('--- OP_NET PolicyVault Deployment ---');

    // 1. Setup Wallet & Network
    const opnetTestnet = { ...networks.testnet, bech32: networks.testnet.bech32Opnet || 'opt' };
    const wallet = getWallet();
    console.log(`Deployer Address: ${wallet.p2tr}`);

    // 2. Setup Provider
    const rpcUrl = config.opnetRpcUrl;
    console.log(`Using RPC Proxy: ${rpcUrl}`);
    const provider = new JSONRpcProvider(rpcUrl, opnetTestnet);

    // 3. Load WASM
    const wasmPath = path.resolve('../contract/build/PolicyVault.wasm');
    if (!fs.existsSync(wasmPath)) {
        throw new Error(`WASM file not found at ${wasmPath}. Run npm run build in /contract first.`);
    }
    const bytecode = fs.readFileSync(wasmPath);
    console.log(`Loaded Contract Bytecode (${bytecode.length} bytes)`);

    // 4. Fetch UTXOs
    console.log('Fetching UTXOs for gas...');
    // testnet opt1 getUTXOs currently returns an array of UTXOs directly
    const utxos: any[] = await provider.utxoManager.getUTXOs({ address: wallet.p2tr }) as any;

    if (!utxos || utxos.length === 0) {
        throw new Error('No confirmed UTXOs found! Address needs testnet BTC.');
    }

    const balance = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
    console.log(`Available UTXOs: ${utxos.length} (Balance: ${balance.toString()} sats)`);

    // 5. Build Deployment Transaction
    console.log('Building deployment transaction...');
    const factory = new TransactionFactory();

    console.log('Fetching OP_NET challenge...');
    const challenge = await provider.getChallenge();
    console.log(`Got challenge: ${challenge.epochNumber}`);

    try {
        const txParams: IDeploymentParameters = {
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            challenge: challenge,
            network: opnetTestnet,
            from: wallet.p2tr,
            utxos: utxos.map(u => ({
                transactionId: u.transactionId,
                outputIndex: u.outputIndex,
                value: BigInt(u.value),
                scriptPubKey: {
                    address: wallet.p2tr,
                    hex: u.scriptPubKey.hex
                }
            })),
            feeRate: 20, // Testnet fee rate
            priorityFee: 5000n,
            gasSatFee: 20000n,
            bytecode: bytecode,
        };

        console.log('Signing deployment transaction via Factory...');
        const result = await factory.signDeployment(txParams);

        console.log(`Contract Address Generated: ${result.contractAddress}`);

        const [fundingTxHex, deployTxHex] = result.transaction;

        console.log('1. Broadcasting Funding Tx...');
        const fundRes = await provider.sendRawTransaction(fundingTxHex, false);
        console.log(`Funding broadcast result:`, fundRes);

        console.log('2. Broadcasting Deployment Tx...');
        const deployRes = await provider.sendRawTransaction(deployTxHex, false);
        console.log(`Deployment broadcast result:`, deployRes);

        console.log(`\n🎉 Success! Contract deployed at: ${result.contractAddress}`);

    } catch (err) {
        console.error('Deployment failed:', err);
    }
}

deploy().catch(console.error);
