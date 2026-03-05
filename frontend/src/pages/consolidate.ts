import { estimateConsolidation, createConsolidationPSBT, broadcastTransaction, fetchUTXOAnalysis } from '../api.js';
import { showToast } from '../components/toast.js';
import { walletService } from '../services/wallet.service.js';
import { treasuryService } from '../services/treasury.service.js';

export async function renderConsolidate(container: HTMLElement): Promise<void> {
  const state = walletService.getState();
  if (!state.connected || !state.address) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Consolidate UTXOs</h1>
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
        <h1 class="page-title">Consolidate UTXOs</h1>
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

  let analysis: any = null;

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Consolidate UTXOs</h1>
      <p class="page-subtitle">Merge small UTXOs to reduce future transaction fees</p>
    </div>
    <div class="loading-overlay"><div class="spinner"></div> Loading UTXO data...</div>
  `;

  try {
    analysis = await fetchUTXOAnalysis(treasury.address);
  } catch {
    // will show in UI
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Consolidate UTXOs</h1>
      <p class="page-subtitle">Merge small UTXOs to reduce future transaction fees</p>
    </div>

    ${analysis ? `
    <div class="card-grid card-grid-3 section">
      <div class="card">
        <div class="card-label">Current UTXOs</div>
        <div class="card-value card-value-sm">${analysis.utxoCount}</div>
      </div>
      <div class="card">
        <div class="card-label">Fragmentation Score</div>
        <div class="card-value card-value-sm">${analysis.fragmentationScore}/100</div>
      </div>
      <div class="card">
        <div class="card-label">Dust + Small</div>
        <div class="card-value card-value-sm">${analysis.dust + analysis.small}</div>
      </div>
    </div>
    ` : `
    <div class="card section">
      <p style="color:var(--text-muted);">Could not load UTXO analysis. Consolidation still works.</p>
    </div>
    `}

    <div class="card section">
      <h2 style="font-size:16px; font-weight:700; margin-bottom:20px;">Consolidation Settings</h2>

      <div class="card-grid card-grid-2">
        <div class="input-group">
          <label class="input-label">Threshold (sats)</label>
          <input type="number" class="input" id="cons-threshold" value="10000"
            placeholder="Consolidate UTXOs below this value" />
          <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
            UTXOs smaller than this will be merged
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">Fee Rate (sats/vB)</label>
          <input type="number" class="input" id="cons-feerate" value="5"
            placeholder="Fee rate" />
        </div>
      </div>

      <div class="flex gap-12 mt-24">
        <button class="btn btn-secondary" id="btn-estimate">
          <span id="estimate-text">Preview Consolidation</span>
        </button>
        <button class="btn btn-primary" id="btn-execute" disabled>
          <span id="execute-text">Execute Consolidation</span>
        </button>
      </div>

      <div id="estimate-result" class="mt-24"></div>
    </div>
  `;

  const thresholdInput = document.getElementById('cons-threshold') as HTMLInputElement;
  const feeRateInput = document.getElementById('cons-feerate') as HTMLInputElement;
  const estimateBtn = document.getElementById('btn-estimate')!;
  const executeBtn = document.getElementById('btn-execute') as HTMLButtonElement;
  const resultDiv = document.getElementById('estimate-result')!;
  const estimateText = document.getElementById('estimate-text')!;
  const executeText = document.getElementById('execute-text')!;

  estimateBtn.addEventListener('click', async () => {
    try {
      estimateBtn.classList.add('btn-loading');
      estimateText.textContent = 'Estimating...';

      const est = await estimateConsolidation(
        thresholdInput.value,
        parseInt(feeRateInput.value),
      );

      resultDiv.innerHTML = `
        <div class="card" style="border-color: var(--border-active);">
          <div class="card-label">📋 Consolidation Preview</div>
          <div class="card-grid card-grid-4 mt-16">
            <div>
              <div class="card-label">Inputs to merge</div>
              <div style="font-size:20px; font-weight:700; color:var(--accent-orange);">${est.inputCount}</div>
            </div>
            <div>
              <div class="card-label">Total Value</div>
              <div style="font-size:20px; font-weight:700;">${(Number(est.totalValue) / 1e8).toFixed(8)} BTC</div>
            </div>
            <div>
              <div class="card-label">Estimated Fee</div>
              <div style="font-size:20px; font-weight:700;">${Number(est.estimatedFee).toLocaleString()} sats</div>
            </div>
            <div>
              <div class="card-label">Resulting UTXOs</div>
              <div style="font-size:20px; font-weight:700; color:var(--accent-green);">${est.resultingUTXOs}</div>
            </div>
          </div>
          ${!est.profitable
          ? '<div class="recommendation mt-16"><strong>⚠️ Warning:</strong> Fee may exceed consolidated value. Consider waiting for lower fee rates.</div>'
          : '<div class="recommendation mt-16" style="border-left-color: var(--accent-green);"><strong>✅ Profitable.</strong> Consolidation will save fees on future transactions.</div>'
        }
        </div>
      `;

      if (est.profitable && est.inputCount >= 2) {
        executeBtn.disabled = false;
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      estimateBtn.classList.remove('btn-loading');
      estimateText.textContent = 'Preview Consolidation';
    }
  });

  executeBtn.addEventListener('click', async () => {
    try {
      executeBtn.classList.add('btn-loading');
      executeText.textContent = 'Preparing PSBT...';
      executeBtn.disabled = true;

      const feerate = parseInt(feeRateInput.value);

      // 1. Create PSBT
      const { psbt } = await createConsolidationPSBT(
        thresholdInput.value,
        100,
        feerate
      );

      // 2. Sign PSBT
      executeText.textContent = 'Waiting for Wallet Signature...';
      const signedHex = await walletService.signPsbt(psbt);

      // 3. Broadcast
      executeText.textContent = 'Broadcasting...';
      const result = await broadcastTransaction(signedHex);

      resultDiv.innerHTML = `
        <div class="card" style="border-color: rgba(34,197,94,0.4);">
          <div class="card-label">✅ Consolidation Successful</div>
          <div class="mt-16">
            <p><strong>Status:</strong> Broadcast Successfully</p>
            <p><strong>TX ID:</strong> <span class="mono" style="word-break: break-all;">${result.transactionId}</span></p>
          </div>
          <div class="recommendation mt-16" style="border-left-color: var(--accent-green);">
            The consolidation transaction has been sent. UTXOs will be updated once confirmed.
          </div>
        </div>
      `;
      showToast('Consolidation broadcast successfully!', 'success');
    } catch (err: any) {
      console.error('Consolidation error:', err);
      showToast(err.message || 'Consolidation failed', 'error');
      executeText.textContent = 'Execute Consolidation';
      executeBtn.disabled = false;
    } finally {
      executeBtn.classList.remove('btn-loading');
    }
  });
}
