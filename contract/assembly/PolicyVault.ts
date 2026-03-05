// PolicyVault — OP_NET Smart Contract
//
// Treasury governance contract that enforces:
// 1. Daily spending cap
// 2. Address whitelist
// 3. Timelock for large payments

import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    encodeSelector,
    OP_NET,
    Selector,
    StoredU256,
    AddressMemoryMap,
} from '@btc-vision/btc-runtime/runtime';

// Policy status codes
const STATUS_ALLOWED: u256 = u256.Zero;
const STATUS_BLOCKED_CAP: u256 = u256.One;
const STATUS_BLOCKED_WHITELIST: u256 = u256.fromU32(2);
const STATUS_TIMELOCKED: u256 = u256.fromU32(3);

// ~144 blocks per day at 10min/block
const BLOCKS_PER_DAY: u64 = 144;

// Storage pointers (pre-allocated to save gas during initialization)
const SLOT_10: Uint8Array = new Uint8Array(30);
const SLOT_11: Uint8Array = new Uint8Array(30);
const SLOT_12: Uint8Array = new Uint8Array(30);
const SLOT_13: Uint8Array = new Uint8Array(30);
const SLOT_14: Uint8Array = new Uint8Array(30);

@final
export class PolicyVault extends OP_NET {
    // Storage slots
    private dailyCap: StoredU256 = new StoredU256(10, SLOT_10);
    private dailySpent: StoredU256 = new StoredU256(11, SLOT_11);
    private lastResetBlock: StoredU256 = new StoredU256(12, SLOT_12);
    private timelockThreshold: StoredU256 = new StoredU256(13, SLOT_13);
    private whitelistCount: StoredU256 = new StoredU256(14, SLOT_14);

    // Whitelist: address → u256 (1 = active, 0 = inactive)
    private whitelist: AddressMemoryMap = new AddressMemoryMap(20);

    public constructor() {
        super();
    }

    // --- Deployment ---
    public override onDeployment(_calldata: Calldata): void {
        this.dailyCap.value = u256.fromU64(5_000_000);
        this.timelockThreshold.value = u256.fromU64(1_000_000);
        this.dailySpent.value = u256.Zero;
        this.lastResetBlock.value = u256.fromU64(Blockchain.block.number);
        this.whitelistCount.value = u256.Zero;
    }

    // --- Methods ---

    @method({ name: 'address', type: ABIDataTypes.ADDRESS }, { name: 'amount', type: ABIDataTypes.UINT256 })
    @returns({ name: 'status', type: ABIDataTypes.UINT256 })
    public checkPolicy(calldata: Calldata): BytesWriter {
        const address = calldata.readAddress();
        const amount = calldata.readU256();

        // 1. Reset daily spent if new block day
        const currentBlock = Blockchain.block.number;
        if (currentBlock - this.lastResetBlock.value.toU64() >= BLOCKS_PER_DAY) {
            this.dailySpent.value = u256.Zero;
            this.lastResetBlock.value = u256.fromU64(currentBlock);
        }

        // 2. Check Whitelist
        if (this.whitelistCount.value > u256.Zero) {
            const status = this.whitelist.get(address);
            if (status == u256.Zero) {
                return this.writeResult(STATUS_BLOCKED_WHITELIST);
            }
        }

        // 3. Check Timelock
        if (amount >= this.timelockThreshold.value) {
            return this.writeResult(STATUS_TIMELOCKED);
        }

        // 4. Check Daily Cap
        const projected = u256.add(this.dailySpent.value, amount);
        if (projected > this.dailyCap.value) {
            return this.writeResult(STATUS_BLOCKED_CAP);
        }

        // 5. Success (Update spent tracking)
        this.dailySpent.value = projected;
        return this.writeResult(STATUS_ALLOWED);
    }

    @method({ name: 'address', type: ABIDataTypes.ADDRESS }, { name: 'active', type: ABIDataTypes.UINT256 })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public updateWhitelist(calldata: Calldata): BytesWriter {
        const address = calldata.readAddress();
        const active = calldata.readU256();

        const current = this.whitelist.get(address);
        if (current == u256.Zero && active != u256.Zero) {
            this.whitelistCount.value = u256.add(this.whitelistCount.value, u256.One);
        } else if (current != u256.Zero && active == u256.Zero) {
            this.whitelistCount.value = u256.sub(this.whitelistCount.value, u256.One);
        }

        this.whitelist.set(address, active);
        const writer = new BytesWriter(1);
        writer.writeU8(1);
        return writer;
    }

    @method({ name: 'cap', type: ABIDataTypes.UINT256 })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setDailyCap(calldata: Calldata): BytesWriter {
        this.dailyCap.value = calldata.readU256();
        const writer = new BytesWriter(1);
        writer.writeU8(1);
        return writer;
    }

    @method({ name: 'threshold', type: ABIDataTypes.UINT256 })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setTimelockThreshold(calldata: Calldata): BytesWriter {
        this.timelockThreshold.value = calldata.readU256();
        const writer = new BytesWriter(1);
        writer.writeU8(1);
        return writer;
    }

    @method()
    @returns(
        { name: 'dailyCap', type: ABIDataTypes.UINT256 },
        { name: 'dailySpent', type: ABIDataTypes.UINT256 },
        { name: 'timelockThreshold', type: ABIDataTypes.UINT256 },
        { name: 'blocksUntilReset', type: ABIDataTypes.UINT256 },
        { name: 'whitelistCount', type: ABIDataTypes.UINT256 }
    )
    public getStats(_: Calldata): BytesWriter {
        const writer = new BytesWriter(160);
        writer.writeU256(this.dailyCap.value);
        writer.writeU256(this.dailySpent.value);
        writer.writeU256(this.timelockThreshold.value);
        writer.writeU256(u256.fromU64(Blockchain.block.number - this.lastResetBlock.value.toU64()));
        writer.writeU256(this.whitelistCount.value);
        return writer;
    }

    private writeResult(status: u256): BytesWriter {
        const writer = new BytesWriter(32);
        writer.writeU256(status);
        return writer;
    }
}
