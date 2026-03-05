import {
  fetchPolicies,
  updateDailyCap,
  updateTimelockThreshold,
  updateWhitelist,
  fetchChallenge,
} from '../api.js';
import { showToast } from '../components/toast.js';
import { walletService } from '../services/wallet.service.js';
import { treasuryService } from '../services/treasury.service.js';

async function signAction(action: string) {
  const state = walletService.getState();
  if (!state.connected || !state.address) {
    throw new Error('Wallet not connected. Please connect as Admin first.');
  }

  const { challenge } = await fetchChallenge(state.address);
  const message = `Update Policy: ${action}\nNonce: ${challenge}`;

  showToast('Please sign the message in your wallet...', 'info');

  // Default to Schnorr for BTC/OP_NET standard
  const signature = await walletService.signSchnorr(message);
  const publicKey = await walletService.getPublicKey();

  return {
    address: state.address,
    signature,
    publicKey,
    message
  };
}

export async function renderPolicies(container: HTMLElement): Promise<void> {
  const state = walletService.getState();
  if (!state.connected || !state.address) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Treasury Policies</h1>
        <p class="page-subtitle">Connect your wallet first</p>
      </div>
      <div class="card section" style="text-align:center; padding: 48px;">
        <div style="font-size: 48px; margin-bottom: 16px;">🔐</div>
        <h2 style="margin-bottom: 8px;">No Wallet Connected</h2>
        <p style="color: var(--text-muted);">Connect your wallet from the sidebar to manage policies.</p>
      </div>
    `;
    return;
  }
  const treasury = treasuryService.getState();
  if (!treasury.address) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Treasury Policies</h1>
        <p class="page-subtitle">Set up your Treasury first</p>
      </div>
      <div class="card section" style="text-align:center; padding: 48px;">
        <div style="font-size: 48px; margin-bottom: 16px;">🏦</div>
        <h2 style="margin-bottom: 8px;">No Treasury Connected</h2>
        <p style="color: var(--text-muted);">Go to Overview to connect or create a Treasury.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Treasury Policies</h1>
      <p class="page-subtitle">Configure spending rules and access controls</p>
    </div>
    <div class="loading-overlay"><div class="spinner"></div> Loading policies...</div>
  `;

  try {
    const treasury = treasuryService.getState();
    const targetAddr = treasury.contractAddress || treasury.address || undefined;
    const pol = await fetchPolicies(targetAddr);
    render(container, pol, targetAddr);
  } catch (err: any) {
    container.innerHTML += `<div class="card"><p style="color:var(--accent-red)">Error: ${err.message}</p></div>`;
    showToast(err.message, 'error');
  }
}

function render(container: HTMLElement, pol: any, contractAddress?: string): void {
  const dailyCapBtc = (Number(pol.dailyCap) / 1e8).toFixed(8);
  const dailySpentBtc = (Number(pol.dailySpent) / 1e8).toFixed(8);
  const progressPct = Number(pol.dailyCap) > 0
    ? Math.min(100, Math.round((Number(pol.dailySpent) / Number(pol.dailyCap)) * 100))
    : 0;
  const timelockBtc = (Number(pol.timelockThreshold) / 1e8).toFixed(8);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Treasury Policies</h1>
      <p class="page-subtitle">
        ${pol.contractDeployed
      ? '🟢 PolicyVault contract active on OP_NET'
      : '🟡 Using local policy enforcement (Signatures Required)'}
      </p>
    </div>

    ${!pol.contractDeployed ? `
      <div class="card" style="border-left: 4px solid var(--accent-orange); margin-bottom: 24px; background: rgba(245, 158, 11, 0.05);">
        <div class="flex-between">
          <div>
            <div style="font-weight: 600; color: var(--accent-orange); margin-bottom: 4px;">Vault Contract Not Detected</div>
            <p style="font-size: 14px; color: var(--text-muted);">Policies are currently enforced locally via backend signatures. Deploy the PolicyVault contract to enable on-chain enforcement.</p>
          </div>
          <button class="btn btn-primary btn-sm" onclick="window.location.hash='#overview'">Deploy Now</button>
        </div>
      </div>
    ` : ''}

    <div class="card-grid card-grid-2 section">
      <!-- Daily Cap -->
      <div class="card">
        <div class="card-label">📊 Daily Spending Cap</div>
        <div class="card-value card-value-sm mt-16">${dailyCapBtc} BTC</div>
        <div class="card-footer">${Number(pol.dailyCap).toLocaleString()} sats / day</div>

        <div class="mt-24">
          <div class="card-label">Today's Spending</div>
          <div class="flex-between mb-16">
            <span>${dailySpentBtc} BTC</span>
            <span>${progressPct}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${progressPct > 80 ? 'danger' : ''}"
              style="width: ${progressPct}%"></div>
          </div>
        </div>

        <div class="mt-24">
          <div class="input-group">
            <label class="input-label">Update Cap (sats)</label>
            <div class="flex gap-12">
              <input type="number" class="input" id="cap-input" value="${pol.dailyCap}" />
              <button class="btn btn-secondary btn-sm" id="btn-cap">Save</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Timelock -->
      <div class="card">
        <div class="card-label">⏳ Timelock Threshold</div>
        <div class="card-value card-value-sm mt-16">${timelockBtc} BTC</div>
        <div class="card-footer">
          Payments above this require a delay (~3 min in demo)
        </div>

        <div class="mt-24">
          <div class="input-group">
            <label class="input-label">Update Threshold (sats)</label>
            <div class="flex gap-12">
              <input type="number" class="input" id="timelock-input" value="${pol.timelockThreshold}" />
              <button class="btn btn-secondary btn-sm" id="btn-timelock">Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Whitelist -->
    <div class="card section">
      <div class="flex-between mb-16">
        <div class="card-label">🛡️ Address Whitelist</div>
        <span style="font-size:12px; color:var(--text-muted);">
          ${pol.whitelist.length} addresses
        </span>
      </div>

      ${pol.whitelist.length > 0
      ? `
        <div class="table-wrapper mb-16">
          <table>
            <thead>
              <tr><th>Address</th><th style="width:100px">Action</th></tr>
            </thead>
            <tbody>
              ${pol.whitelist.map((addr: string) => `
                <tr>
                  <td class="mono">${addr}</td>
                  <td>
                    <button class="btn btn-danger btn-sm btn-remove-wl" data-addr="${addr}">
                      Remove
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        `
      : '<p style="color:var(--text-muted); margin-bottom:16px;">No addresses whitelisted. All addresses are allowed when whitelist is empty.</p>'
    }

      <div class="input-group">
        <label class="input-label">Add Address to Whitelist</label>
        <div class="flex gap-12">
          <input type="text" class="input" id="wl-input"
            placeholder="bcrt1p..." />
          <button class="btn btn-primary btn-sm" id="btn-add-wl">Add</button>
        </div>
      </div>
    </div>
  `;

  // --- Event handlers ---
  document.getElementById('btn-cap')?.addEventListener('click', async () => {
    try {
      const val = (document.getElementById('cap-input') as HTMLInputElement).value;
      const auth = await signAction(`Set Daily Cap to ${val}`);
      const updated = await updateDailyCap(val, auth, contractAddress);
      showToast('Daily cap updated with admin signature', 'success');
      render(container, updated, contractAddress);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-timelock')?.addEventListener('click', async () => {
    try {
      const val = (document.getElementById('timelock-input') as HTMLInputElement).value;
      const auth = await signAction(`Set Timelock to ${val}`);
      const updated = await updateTimelockThreshold(val, auth, contractAddress);
      showToast('Timelock updated with admin signature', 'success');
      render(container, updated, contractAddress);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-add-wl')?.addEventListener('click', async () => {
    try {
      const addr = (document.getElementById('wl-input') as HTMLInputElement).value.trim();
      if (!addr) return;
      const auth = await signAction(`Add ${addr} to Whitelist`);
      const updated = await updateWhitelist(addr, 'add', auth, contractAddress);
      showToast(`${addr} added with signature`, 'success');
      render(container, updated, contractAddress);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  });

  document.querySelectorAll('.btn-remove-wl').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const addr = (btn as HTMLElement).dataset.addr!;
        const auth = await signAction(`Remove ${addr} from Whitelist`);
        const updated = await updateWhitelist(addr, 'remove', auth, contractAddress);
        showToast(`${addr} removed with signature`, 'success');
        render(container, updated, contractAddress);
      } catch (err: any) {
        showToast(err.message, 'error');
      }
    });
  });
}