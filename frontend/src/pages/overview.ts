import { fetchUTXOAnalysis, deployContract, fetchFundingPSBT, broadcastFunding } from '../api.js';
import { showToast } from '../components/toast.js';
import { walletService, type WalletState } from '../services/wallet.service.js';
import { treasuryService } from '../services/treasury.service.js';

function satsToBtc(sats: string | number): string {
  const n = Number(sats);
  return (n / 100_000_000).toFixed(8);
}

function gaugeColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

export async function renderOverview(container: HTMLElement): Promise<void> {
  const renderContent = async (
    data: any,
    walletState: WalletState,
    adminBalance: number
  ) => {
    const score = data.fragmentationScore;
    const circumference = 2 * Math.PI * 48;
    const offset = circumference - (score / 100) * circumference;
    const color = gaugeColor(score);
    const treasury = treasuryService.getState();

    container.innerHTML = `
      <div class="page-header flex-between">
        <div>
          <h1 class="page-title">${treasury.name}</h1>
          <p class="page-subtitle">Treasury: <span class="mono clickable-address" id="copy-address-text" title="Click to copy">${data.address}</span></p>
        </div>
        
        ${walletState.connected ? `
          <div class="header-actions flex gap-2">
            <button id="btn-deposit-web3" class="btn btn-primary">💎 Add Treasury</button>
            <div class="admin-badge">
              <div class="admin-label">ADMIN</div>
              <div class="admin-address">${walletState.address?.slice(0, 8)}...${walletState.address?.slice(-6)}</div>
              <div class="admin-balance">${satsToBtc(adminBalance)} BTC</div>
            </div>
          </div>
        ` : ''}
      </div>

      <div class="card-grid card-grid-4 section">
        <div class="card">
          <div class="stat-mini">
            <div class="stat-icon orange">₿</div>
            <div>
              <div class="card-label">Treasury Balance</div>
              <div class="card-value">${satsToBtc(data.totalBalance)}</div>
              <div class="card-footer">${Number(data.totalBalance).toLocaleString()} sats</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="stat-mini">
            <div class="stat-icon blue">🔗</div>
            <div>
              <div class="card-label">UTXO Count</div>
              <div class="card-value card-value-sm">${data.utxoCount}</div>
              <div class="card-footer">
                <span class="tag tag-dust">${data.dust} dust</span>
                <span class="tag tag-small">${data.small} small</span>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="stat-mini">
            <div class="stat-icon green">📊</div>
            <div>
              <div class="card-label">Medium / Large</div>
              <div class="card-value card-value-sm">${data.medium} / ${data.large}</div>
              <div class="card-footer">
                <span class="tag tag-medium">${data.medium} med</span>
                <span class="tag tag-large">${data.large} large</span>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="gauge-container">
            <div class="card-label">Health Score</div>
            <div class="gauge-ring">
              <svg viewBox="0 0 108 108">
                <circle class="gauge-bg" cx="54" cy="54" r="48" />
                <circle class="gauge-fill" cx="54" cy="54" r="48"
                  stroke="${color}"
                  stroke-dasharray="${circumference}"
                  stroke-dashoffset="${offset}" />
              </svg>
              <div class="gauge-value" style="color: ${color}">${score}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card section">
        <div class="card-label">💡 Recommendation</div>
        <div class="recommendation mt-16">
          <strong>${data.recommendation}</strong><br/>
          Consolidation: <strong>${data.consolidationSavings.inputsBefore} → ${data.consolidationSavings.inputsAfter}</strong> inputs.
          Estimated fee savings: <strong>~${data.consolidationSavings.estimatedFeeSavingsPercent}%</strong> on future transactions.
        </div>
      </div>

      <div class="card-grid card-grid-2 section">
        <div class="card">
          <div class="card-label">Dust Value Locked</div>
          <div class="card-value card-value-sm">${satsToBtc(data.dustValue)} BTC</div>
          <div class="card-footer">${Number(data.dustValue).toLocaleString()} sats in ${data.dust} dust UTXOs</div>
        </div>
        <div class="card">
          <div class="card-label">Average UTXO Size</div>
          <div class="card-value card-value-sm">${data.utxoCount > 0 ? satsToBtc(String(Math.round(Number(data.totalBalance) / data.utxoCount))) : '0'} BTC</div>
          <div class="card-footer">Per UTXO average</div>
        </div>
      </div>

      <div style="text-align:center; margin-top: 16px;">
        <button class="btn btn-danger btn-sm" id="btn-disconnect-treasury">Disconnect Treasury</button>
      </div>
    `;

    // Handlers
    document.getElementById('btn-disconnect-treasury')?.addEventListener('click', () => {
      treasuryService.disconnect();
      renderOverview(container); // Re-render to show connect screen
      showToast('Treasury disconnected', 'info');
    });

    document.getElementById('copy-address-text')?.addEventListener('click', () => {
      navigator.clipboard.writeText(data.address);
      showToast('Treasury address copied!', 'success');
    });

    document.getElementById('btn-deposit-web3')?.addEventListener('click', async () => {
      const depBtn = document.getElementById('btn-deposit-web3') as HTMLButtonElement;
      try {
        const amountStr = prompt('Enter amount to deposit (in BTC):', '0.001');
        if (!amountStr || amountStr.trim() === '') return;

        const btcAmount = parseFloat(amountStr);
        if (isNaN(btcAmount) || btcAmount <= 0) {
          showToast('Invalid amount', 'error');
          return;
        }

        const sats = Math.round(btcAmount * 100_000_000);

        depBtn.textContent = '⌛ Preparing transaction...';
        depBtn.disabled = true;

        const walletAddr = walletService.getState().address;
        const pubKey = walletService.getState().publicKey;
        const treasuryAddr = data.address;

        if (!walletAddr || !pubKey) throw new Error('Wallet details missing');

        // Strategy 1: PSBT approach (backend builds, wallet signs)
        let txId: string | null = null;
        let psbtError: string | null = null;
        try {
          console.info('[Deposit] Trying PSBT approach...');
          const walletUtxos = await walletService.getUtxos();
          console.info(`[Deposit] Wallet UTXOs: ${walletUtxos.length}`, walletUtxos);

          const { psbtHex } = await fetchFundingPSBT(
            walletAddr, pubKey, treasuryAddr, sats.toString(), walletUtxos
          );

          depBtn.textContent = '⌛ Waiting for wallet...';
          const signedPsbt = await walletService.signPsbt(psbtHex);

          depBtn.textContent = '⌛ Broadcasting...';
          const result = await broadcastFunding(signedPsbt);
          txId = result.txId;
        } catch (psbtErr: any) {
          psbtError = psbtErr.message || String(psbtErr);
          console.warn('[Deposit] PSBT approach failed:', psbtError);

          // Strategy 2: Wallet native sendBitcoin (wallet handles UTXOs internally)
          try {
            console.info('[Deposit] Falling back to sendBitcoin...');
            depBtn.textContent = '⌛ Confirm in wallet...';
            showToast(`PSBT failed (${psbtError}), trying direct send...`, 'info');
            txId = await walletService.sendBitcoin(treasuryAddr, sats);
          } catch (sendErr: any) {
            console.warn('[Deposit] sendBitcoin also failed:', sendErr.message);
            // Both strategies failed — show manual deposit UI
            throw new Error('AUTO_DEPOSIT_FAILED');
          }
        }

        if (txId) {
          showToast(`Deposit sent: ${txId.slice(0, 8)}...`, 'success');
        } else {
          showToast('Deposit submitted!', 'success');
        }

        await walletService.refreshBalance();
        setTimeout(() => renderOverview(container), 2000);
        setTimeout(() => renderOverview(container), 10000);
      } catch (err: any) {
        console.error('[Deposit] All methods failed:', err);

        if (err.message === 'AUTO_DEPOSIT_FAILED') {
          // Show manual deposit dialog instead of a generic error
          const treasuryAddr = data.address;
          showToast('Auto-deposit unavailable. Use the manual address below.', 'info');
          const manualDiv = document.createElement('div');
          manualDiv.className = 'card';
          manualDiv.style.cssText = 'margin-top:16px; padding:24px; text-align:center; border:1px solid var(--accent-primary);';
          manualDiv.innerHTML = `
            <div style="font-size:32px; margin-bottom:8px;">📋</div>
            <h3 style="margin-bottom:8px;">Send BTC manually to this treasury address:</h3>
            <div class="mono" style="background:var(--bg-tertiary); padding:12px; border-radius:8px; word-break:break-all; cursor:pointer; margin-bottom:12px;" id="manual-deposit-addr">
              ${treasuryAddr}
            </div>
            <button class="btn btn-primary btn-sm" id="btn-copy-deposit-addr">Copy Address</button>
            <button class="btn btn-secondary btn-sm" id="btn-close-manual" style="margin-left:8px;">Close</button>
          `;
          // Insert after the deposit button's parent area
          const headerActions = depBtn.closest('.header-actions') || depBtn.parentElement;
          if (headerActions) {
            headerActions.parentElement?.appendChild(manualDiv);
          } else {
            container.appendChild(manualDiv);
          }
          document.getElementById('btn-copy-deposit-addr')?.addEventListener('click', () => {
            navigator.clipboard.writeText(treasuryAddr);
            showToast('Treasury address copied!', 'success');
          });
          document.getElementById('manual-deposit-addr')?.addEventListener('click', () => {
            navigator.clipboard.writeText(treasuryAddr);
            showToast('Treasury address copied!', 'success');
          });
          document.getElementById('btn-close-manual')?.addEventListener('click', () => {
            manualDiv.remove();
          });
        } else {
          showToast(`Deposit failed: ${err.message || 'Unknown error'}`, 'error');
        }
      } finally {
        if (depBtn) {
          depBtn.textContent = '💎 Add Treasury';
          depBtn.disabled = false;
        }
      }
    });
  };

  const walletState = walletService.getState();
  if (!walletState.connected || !walletState.address) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Overview</h1>
        <p class="page-subtitle">Connect your wallet to get started</p>
      </div>
      <div class="card section" style="text-align:center; padding: 48px;">
        <div style="font-size: 48px; margin-bottom: 16px;">🔐</div>
        <h2 style="margin-bottom: 8px;">No Wallet Connected</h2>
        <p style="color: var(--text-muted);">
          Connect your OP_WALLET or Unisat wallet from the sidebar to manage your Treasury.
        </p>
      </div>
    `;
    return;
  }

  const treasuryState = treasuryService.getState();
  if (!treasuryState.address) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Treasury Setup</h1>
        <p class="page-subtitle">Create a new treasury or connect to an existing one</p>
      </div>

      <div class="card-grid section">
        <div class="card" style="padding: 32px; flex: 1;">
          <div style="font-size: 40px; margin-bottom: 12px;">🚀</div>
          <h2 style="margin-bottom: 8px;">Automated Deployment</h2>
          <p style="color: var(--text-muted); margin-bottom: 24px;">
            Deploy a PolicyVault smart contract directly from this dashboard. 
            We'll handle the PSBT generation and broadcasting for you.
          </p>
          <button class="btn btn-primary" id="btn-deploy-treasury" style="width:100%; padding: 16px;">
            Deploy PolicyVault (Auto)
          </button>
        </div>

        <div class="card" style="padding: 32px; flex: 1;">
          <div style="font-size: 40px; margin-bottom: 12px;">🛠️</div>
          <h2 style="margin-bottom: 8px;">Manual Deployment (Fallback)</h2>
          <p style="color: var(--text-muted); margin-bottom: 16px;">
            If automated deployment fails, you can deploy manually:
          </p>
          <ol style="text-align: left; color: var(--text-muted); margin-bottom: 24px; padding-left: 20px;">
            <li>Download the compiled <b>PolicyVault.wasm</b></li>
            <li>Go to <a href="https://ai.opnet.org/" target="_blank" style="color:var(--accent-primary)">ai.opnet.org</a></li>
            <li>Upload the file and deploy via OP_WALLET</li>
            <li>Paste the resulting address below</li>
          </ol>
          <button class="btn btn-secondary" id="btn-download-wasm" style="width:100%; margin-bottom: 12px;">
            💾 Download PolicyVault.wasm
          </button>
          
          <div class="input-group" style="text-align:left; border-top: 1px solid var(--border-color); padding-top: 20px;">
            <label class="input-label">Paste Deployed Address</label>
            <input type="text" class="input" id="treasury-address-input"
              placeholder="opt1..." style="margin-bottom: 8px;" />
            <label class="input-label">Friendly Name</label>
            <input type="text" class="input" id="treasury-name-input"
              placeholder="My DAO Treasury" style="margin-bottom: 12px;" />
            <button class="btn btn-primary" id="btn-connect-treasury" style="width:100%;">
              Connect Manual Treasury
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-download-wasm')?.addEventListener('click', async () => {
      try {
        const { fetchDeploymentParams } = await import('../api.js');
        const res = await fetchDeploymentParams();
        if (!res.success) throw new Error('Failed to fetch bytecode');

        const blob = new Blob(
          [Uint8Array.from(atob(res.bytecodeBase64), c => c.charCodeAt(0))],
          { type: 'application/wasm' }
        );
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'PolicyVault.wasm';
        a.click();
        window.URL.revokeObjectURL(url);
        showToast('WASM file downloaded!', 'success');
      } catch (err: any) {
        showToast(`Download failed: ${err.message}`, 'error');
      }
    });

    document.getElementById('btn-connect-treasury')?.addEventListener('click', () => {
      const addr = (document.getElementById('treasury-address-input') as HTMLInputElement).value.trim();
      const name = (document.getElementById('treasury-name-input') as HTMLInputElement).value.trim();
      if (!addr) {
        showToast('Please enter a treasury address', 'error');
        return;
      }
      treasuryService.connect(addr, name || undefined);
      showToast('Treasury connected!', 'success');
      renderOverview(container);
    });

    document.getElementById('btn-deploy-treasury')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-deploy-treasury') as HTMLButtonElement;
      const originalText = btn.textContent;
      btn.disabled = true;

      try {
        const ws = walletService.getState();
        if (!ws.connected || !ws.address) {
          showToast('Connect your wallet first', 'error');
          btn.disabled = false;
          return;
        }

        // 1. Get Public Key (Essential for PSBT generation)
        btn.textContent = '⏳ Fetching PubKey...';
        const pubKey = await walletService.getPublicKey().catch(e => {
          console.warn('Direct fallback for getPublicKey...');
          return (window as any).unisat?.getPublicKey() || (window as any).opnet?.getPublicKey();
        });

        if (!pubKey) throw new Error('Could not retrieve public key. Please unlock your wallet.');

        // OP_WALLET uses native deployContract — no PSBT needed
        if (ws.type === 'opnet') {
          // Try root object first, then web3 sub-object
          const provider = (window as any).opnet;
          if (!provider || typeof provider.deployContract !== 'function') {
            throw new Error('OP_WALLET deployContract not available. Please update your OP_WALLET extension.');
          }

          btn.textContent = '⏳ Fetching bytecode...';
          const { fetchDeploymentParams } = await import('../api.js');
          const paramsRes = await fetchDeploymentParams();
          if (!paramsRes.success) throw new Error(paramsRes.error || 'Failed to fetch bytecode from backend');

          // Decode base64 → Uint8Array
          const byteString = atob(paramsRes.bytecodeBase64);
          const bytecode = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) {
            bytecode[i] = byteString.charCodeAt(i);
          }

          // Fetch UTXOs explicitly — OP_WALLET internal UTXO fetch is broken
          btn.textContent = '⏳ Fetching UTXOs...';
          let utxos: any[] = [];
          try { utxos = await provider.getBitcoinUtxos(); } catch (e) { console.warn('getBitcoinUtxos failed:', e); }
          if (!utxos || !utxos.length) throw new Error('No UTXOs found in OP_WALLET. Need 0.005+ BTC on testnet.');

          // OP_WALLET requires value as BigInt
          const fixedUtxos = utxos.map((u: any) => ({ ...u, value: BigInt(u.value) }));

          // Only use enough UTXOs for deployment (~500k sats), not the entire wallet!
          const DEPLOY_BUDGET = 500_000n;
          fixedUtxos.sort((a: any, b: any) => (a.value < b.value ? -1 : 1)); // ascending
          let deployAccumulated = 0n;
          const deployUtxos: any[] = [];
          for (const u of fixedUtxos) {
            deployUtxos.push(u);
            deployAccumulated += u.value;
            if (deployAccumulated >= DEPLOY_BUDGET) break;
          }
          console.info('Deploy UTXOs:', deployUtxos.length, '/', fixedUtxos.length, '| using:', deployAccumulated.toString(), 'sats (budget:', DEPLOY_BUDGET.toString(), ')');

          btn.textContent = '✍️ Confirm in OP_WALLET...';
          showToast('Check your OP_WALLET — confirm the deployment', 'info');
          console.info('Calling window.opnet.deployContract...', { bytecodeSize: bytecode.length, utxoCount: deployUtxos.length });

          const deployResult = await provider.deployContract({
            bytecode,
            utxos: deployUtxos,
            feeRate: 20,
            priorityFee: 1000n,
            gasSatFee: 150000n,
          });

          console.info('deployContract result:', deployResult);

          if (!deployResult) throw new Error('deployContract returned empty result');

          // OP_WALLET returns signed transactions in deployResult.transaction[0] and [1]
          // It signs but does NOT broadcast — we must broadcast via backend
          const txArray: string[] = deployResult.transaction || [];
          if (txArray.length >= 2) {
            btn.textContent = '📡 Broadcasting to OP_NET...';
            showToast('Broadcasting transactions...', 'info');

            const { broadcastDeploy } = await import('../api.js');
            const broadcastResult = await broadcastDeploy(txArray[0], txArray[1]);

            if (!broadcastResult.success) {
              throw new Error(broadcastResult.error || 'Broadcast failed');
            }
            console.info('Broadcast success:', broadcastResult);
          } else {
            console.warn('No transactions in deployResult — OP_WALLET may have broadcast internally');
          }

          // Extract contract address from result
          const contractAddr: string =
            deployResult.contractAddress ||
            deployResult.address ||
            deployResult.result ||
            '';

          if (contractAddr) {
            treasuryService.connect(contractAddr, 'My PolicyVault');
            showToast(`✅ Contract deployed at ${contractAddr.slice(0, 16)}...`, 'success');
          } else {
            showToast('✅ Deployment broadcast! Check the scanner in ~1 min.', 'success');
          }

          await walletService.refreshBalance();
          renderOverview(container);
          return;
        }

        // Fallback for non-OP_WALLET (Unisat etc) — PSBT path
        btn.textContent = '⏳ Generating PSBTs...';
        const result = await deployContract(ws.address, pubKey);
        if (!result.success || !result.deploymentData) {
          throw new Error(result.error || 'Backend failed to generate deployment PSBTs');
        }

        const { fundingPsbt, revealPsbt } = result.deploymentData;
        const contractAddr = result.contractAddress;

        btn.textContent = '✍️ Sign Funding TX...';
        showToast('PLEASE CHECK WALLET: Sign the Funding transaction', 'info');
        const signedFundingHex = await walletService.signPsbt(fundingPsbt);

        btn.textContent = '✍️ Sign Reveal TX...';
        showToast('PLEASE CHECK WALLET: Sign the Reveal (Deployment) transaction', 'info');
        const signedRevealHex = await walletService.signPsbt(revealPsbt);

        btn.textContent = '📡 Broadcasting...';
        showToast('Broadcasting to OP_NET...', 'info');
        const { broadcastDeploy } = await import('../api.js');
        const broadcastResult = await broadcastDeploy(signedFundingHex, signedRevealHex);

        if (broadcastResult.success) {
          showToast(`SUCCESS: Contract deployed at ${contractAddr}`, 'success');
          treasuryService.connect(contractAddr, 'My PolicyVault');
          await walletService.refreshBalance();
          renderOverview(container);
        } else {
          throw new Error(broadcastResult.error || 'Broadcast failed');
        }

      } catch (err: any) {
        console.error('DEPLOYMENT CRITICAL ERROR:', err);
        const msg = err.message || String(err);
        showToast(`Deploy Failed: ${msg}`, 'error');
        btn.disabled = false;
        btn.textContent = originalText;

        if (msg.toLowerCase().includes('utxo') || msg.toLowerCase().includes('balance')) {
          showToast('Requirement: 500,000+ sats (0.005 BTC) needed for deployment', 'info');
        }
      }
    });

    return;
  }

  // This section handles the display of treasury data once a treasury is connected/deployed
  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${treasuryState.name}</h1>
      <p class="page-subtitle">Loading treasury data...</p>
    </div>
    <div class="loading-overlay"><div class="spinner"></div> Loading...</div>
  `;

  try {
    const treasuryInfo = treasuryService.getState();
    let treasuryData = null;

    if (treasuryInfo?.address) {
      try {
        treasuryData = await fetchUTXOAnalysis(treasuryInfo.address);
      } catch (e) {
        console.error("Failed to fetch treasury stats", e);
      }
    }

    let adminBalance = walletState.balance;
    if (walletState.connected && walletState.address) {
      try {
        const walletData = await fetchUTXOAnalysis(walletState.address);
        adminBalance = Number(walletData.totalBalance);
      } catch { }
    }

    if (treasuryData) {
      renderContent(treasuryData, walletState, adminBalance);
    } else {
      // If no treasuryData (e.g., treasuryInfo.address is null or fetch failed),
      // render a placeholder or error state.
      container.innerHTML = `
        <div class="page-header">
           <h1 class="page-title">${treasuryInfo.name}</h1>
           <p class="subtitle text-secondary">
             Treasury: <span class="text-primary font-mono">${treasuryInfo.address || 'Not Deployed (Deploy PolicyVault to start)'}</span>
           </p>
        </div>
        <div class="card section" style="text-align:center; padding: 48px;">
          <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
          <h2 style="margin-bottom: 8px;">Treasury Not Active</h2>
          <p style="color: var(--text-muted);">
            The treasury contract is not deployed or could not be reached. 
            Once you deploy the PolicyVault contract, your dashboard will activate.
          </p>
          <div style="margin-top: 24px; display: flex; gap: 12px; justify-content: center;">
             <button class="btn btn-primary" onclick="window.location.reload()">🔄 Refresh</button>
             <button class="btn btn-danger" id="btn-disconnect-treasury">Disconnect</button>
          </div>
        </div>
      `;
      document.getElementById('btn-disconnect-treasury')?.addEventListener('click', () => {
        treasuryService.disconnect();
        renderOverview(container);
        showToast('Treasury disconnected', 'info');
      });
    }
  } catch (err: any) {
    container.innerHTML += `<div class="card"><p style="color:var(--accent-red)">Error: ${err.message}</p></div>`;
    showToast(err.message, 'error');
  }
}