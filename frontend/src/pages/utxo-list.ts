import { fetchUTXOs } from '../api.js';
import { showToast } from '../components/toast.js';
import { walletService } from '../services/wallet.service.js';
import { treasuryService } from '../services/treasury.service.js';

function satsToBtc(sats: string): string {
  return (Number(sats) / 100_000_000).toFixed(8);
}

function shortTx(txid: string): string {
  if (txid.length <= 16) return txid;
  return `${txid.slice(0, 8)}…${txid.slice(-8)}`;
}

export async function renderUTXOList(container: HTMLElement): Promise<void> {
  const state = walletService.getState();
  if (!state.connected || !state.address) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">UTXO List</h1>
        <p class="page-subtitle">Connect your wallet to view UTXOs</p>
      </div>
      <div class="card section" style="text-align:center; padding: 48px;">
        <div style="font-size: 48px; margin-bottom: 16px;">🔐</div>
        <h2 style="margin-bottom: 8px;">No Wallet Connected</h2>
        <p style="color: var(--text-muted);">Connect your wallet from the sidebar.</p>
      </div>
    `;
    return;
  }
  const treasury = treasuryService.getState();
  if (!treasury.address) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">UTXO List</h1>
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
      <h1 class="page-title">UTXO List</h1>
      <p class="page-subtitle">All unspent outputs in the treasury</p>
    </div>
    <div class="loading-overlay"><div class="spinner"></div> Loading UTXOs...</div>
  `;

  try {
    const data = await fetchUTXOs(treasury.address);
    const utxos = data.utxos || [];

    container.innerHTML = `
      <div class="page-header flex-between">
        <div>
          <h1 class="page-title">UTXO List</h1>
          <p class="page-subtitle">${utxos.length} UTXOs — <span class="mono">${data.address}</span></p>
        </div>
        <div>
          <input type="text" class="input" id="utxo-search" placeholder="Filter by min sats..." style="width:200px" />
        </div>
      </div>

      <div class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Value (sats)</th>
                <th>Value (BTC)</th>
                <th>Transaction</th>
                <th>Output</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody id="utxo-tbody">
              ${utxos
        .sort((a: any, b: any) => Number(b.value) - Number(a.value))
        .map(
          (u: any, i: number) => `
                <tr data-value="${u.value}">
                  <td>${i + 1}</td>
                  <td class="mono">${Number(u.value).toLocaleString()}</td>
                  <td class="mono">${satsToBtc(u.value)}</td>
                  <td class="mono">${shortTx(u.transactionId)}</td>
                  <td class="mono">${u.outputIndex}</td>
                  <td><span class="tag tag-${u.category}">${u.category}</span></td>
                </tr>
              `,
        )
        .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Simple filter
    const searchInput = document.getElementById('utxo-search') as HTMLInputElement;
    searchInput?.addEventListener('input', () => {
      const min = parseInt(searchInput.value) || 0;
      const rows = document.querySelectorAll('#utxo-tbody tr');
      rows.forEach((row) => {
        const val = parseInt((row as HTMLElement).dataset.value || '0');
        (row as HTMLElement).style.display = val >= min ? '' : 'none';
      });
    });
  } catch (err: any) {
    container.innerHTML += `<div class="card"><p style="color:var(--accent-red)">Error: ${err.message}</p></div>`;
    showToast(err.message, 'error');
  }
}
