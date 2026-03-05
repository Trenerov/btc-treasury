import { validatePayouts, createPayoutPSBT, broadcastTransaction } from '../api.js';
import { showToast } from '../components/toast.js';
import { walletService } from '../services/wallet.service.js';
import { treasuryService } from '../services/treasury.service.js';

function statusTag(status: string): string {
  const map: Record<string, string> = {
    allowed: '<span class="tag tag-allowed">✅ Allowed</span>',
    blocked_cap: '<span class="tag tag-blocked">❌ Cap Exceeded</span>',
    blocked_whitelist: '<span class="tag tag-blocked">❌ Not Whitelisted</span>',
    timelocked: '<span class="tag tag-timelocked">⏳ Timelocked</span>',
    pending: '<span class="tag tag-pending">⏳ Pending</span>',
  };
  return map[status] || `<span class="tag tag-pending">${status}</span>`;
}

function countCsvLines(csv: string): number {
  return csv.trim().split('\n')
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith('#') && !t.startsWith('address');
    }).length;
}

const SAMPLE_CSV = `# address, amount_btc
bcrt1qexample1address000000000000000000001,0.001
bcrt1qexample2address000000000000000000002,0.002
bcrt1qexample3address000000000000000000003,0.0005`;

export async function renderBatchPayout(container: HTMLElement): Promise<void> {
  const state = walletService.getState();
  if (!state.connected || !state.address) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Batch Payouts</h1>
        <p class="page-subtitle">Connect your wallet first</p>
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
        <h1 class="page-title">Batch Payouts</h1>
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
      <h1 class="page-title">Batch Payouts</h1>
      <p class="page-subtitle">Send payments to multiple recipients in one operation</p>
    </div>

    <div class="card section">
      <div class="card-label">📄 Payout CSV</div>
      <div class="input-group mt-16">
        <div class="flex-between">
          <label class="input-label">Format: address, amount_btc (one per line)</label>
          <span id="csv-counter" class="csv-counter">3 recipients</span>
        </div>
        <textarea class="input" id="csv-input" placeholder="${SAMPLE_CSV}">${SAMPLE_CSV}</textarea>
      </div>

      <div class="input-group">
        <label class="input-label">Fee Rate (sats/vB)</label>
        <input type="number" class="input" id="payout-feerate" value="5" style="width:200px" />
      </div>

      <div class="flex gap-12">
        <button class="btn btn-secondary" id="btn-validate">
          <span id="validate-text">Validate & Check Policies</span>
        </button>
        <button class="btn btn-primary" id="btn-send" disabled>
          <span id="send-text">Execute Batch</span>
        </button>
      </div>
    </div>

    <div id="payout-result"></div>
  `;

  const csvInput = document.getElementById('csv-input') as HTMLTextAreaElement;
  const feeRateInput = document.getElementById('payout-feerate') as HTMLInputElement;
  const validateBtn = document.getElementById('btn-validate')!;
  const sendBtn = document.getElementById('btn-send') as HTMLButtonElement;
  const resultDiv = document.getElementById('payout-result')!;
  const csvCounter = document.getElementById('csv-counter')!;
  const validateText = document.getElementById('validate-text')!;
  const sendText = document.getElementById('send-text')!;

  // Live CSV line counter
  const updateCounter = () => {
    const count = countCsvLines(csvInput.value);
    csvCounter.textContent = `${count} recipient${count !== 1 ? 's' : ''}`;
    csvCounter.style.color = count === 0
      ? 'var(--accent-red)' : 'var(--accent-green)';
  };
  csvInput.addEventListener('input', updateCounter);
  updateCounter();

  validateBtn.addEventListener('click', async () => {
    const count = countCsvLines(csvInput.value);
    if (count === 0) {
      showToast('No valid payout lines found in CSV', 'error');
      return;
    }

    try {
      validateBtn.classList.add('btn-loading');
      validateText.textContent = 'Validating...';

      const est = await validatePayouts(csvInput.value);

      const allowed = est.payouts.filter((p: any) => p.status === 'allowed').length;
      const blocked = est.payouts.filter((p: any) =>
        p.status === 'blocked_cap' || p.status === 'blocked_whitelist'
      ).length;
      const timelocked = est.payouts.filter((p: any) =>
        p.status === 'timelocked'
      ).length;

      resultDiv.innerHTML = `
        <div class="card-grid card-grid-4 section">
          <div class="card" style="border-color: rgba(34,197,94,0.3);">
            <div class="card-label">Total Amount</div>
            <div class="card-value card-value-sm">${(Number(est.totalAmount) / 1e8).toFixed(8)}</div>
            <div class="card-footer">BTC</div>
          </div>
          <div class="card">
            <div class="card-label">Est. Fee</div>
            <div class="card-value card-value-sm">${Number(est.estimatedFee).toLocaleString()}</div>
            <div class="card-footer">sats</div>
          </div>
          <div class="card" style="border-color: ${blocked > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'};">
            <div class="card-label">Allowed</div>
            <div class="card-value card-value-sm" style="-webkit-text-fill-color: var(--accent-green);">${allowed}/${est.payouts.length}</div>
            <div class="card-footer">${blocked > 0 ? `${blocked} blocked` : 'all pass'}${timelocked > 0 ? `, ${timelocked} timelocked` : ''}</div>
          </div>
          <div class="card">
            <div class="card-label">Recipients</div>
            <div class="card-value card-value-sm">${est.payouts.length}</div>
            <div class="card-footer">addresses</div>
          </div>
        </div>

        <div class="card section">
          <div class="card-label">Payout Details</div>
          <div class="table-wrapper mt-16">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Address</th>
                  <th>Amount (BTC)</th>
                  <th>Policy Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                ${est.payouts.map((p: any, i: number) => `
                  <tr class="${p.status !== 'allowed' ? 'row-blocked' : ''}">
                    <td>${i + 1}</td>
                    <td class="mono">${p.address}</td>
                    <td class="mono">${(Number(p.amountSats) / 1e8).toFixed(8)}</td>
                    <td>${statusTag(p.status)}</td>
                    <td style="font-size:12px; color:var(--text-muted);">${p.reason || '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          ${!est.allAllowed
          ? '<div class="recommendation mt-16"><strong>⚠️ Some payouts blocked by policy.</strong> Fix issues before executing.</div>'
          : '<div class="recommendation mt-16" style="border-left-color: var(--accent-green);"><strong>✅ All payouts pass policy checks.</strong> Ready to execute.</div>'
        }
        </div>
      `;

      sendBtn.disabled = !est.allAllowed;
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      validateBtn.classList.remove('btn-loading');
      validateText.textContent = 'Validate & Check Policies';
    }
  });

  sendBtn.addEventListener('click', async () => {
    try {
      sendBtn.classList.add('btn-loading');
      sendText.textContent = 'Preparing PSBT...';
      sendBtn.disabled = true;

      const treasury = treasuryService.getState();
      const feerate = parseInt(feeRateInput.value);

      // 1. Create PSBT
      const { psbt } = await createPayoutPSBT(csvInput.value, treasury.address!, feerate);

      // 2. Sign PSBT
      sendText.textContent = 'Waiting for Wallet Signature...';
      const signedHex = await walletService.signPsbt(psbt);

      // 3. Broadcast
      sendText.textContent = 'Broadcasting...';
      const result = await broadcastTransaction(signedHex, csvInput.value);

      resultDiv.innerHTML = `
        <div class="card" style="border-color: rgba(34,197,94,0.4);">
          <div class="card-label">✅ Batch Payout Complete</div>
          <div class="mt-16">
            <p><strong>Status:</strong> Broadcast Successfully</p>
            <p><strong>TX ID:</strong> <span class="mono" style="word-break: break-all;">${result.transactionId}</span></p>
          </div>
          <div class="recommendation mt-16" style="border-left-color: var(--accent-green);">
            The transaction has been sent to the network. You can track it in the treasury overview.
          </div>
        </div>
      `;
      showToast('Batch payout broadcast successfully!', 'success');
    } catch (err: any) {
      console.error('Batch payout error:', err);
      showToast(err.message || 'Batch payout failed', 'error');
      sendText.textContent = 'Execute Batch';
      sendBtn.disabled = false;
    } finally {
      sendBtn.classList.remove('btn-loading');
    }
  });
}
