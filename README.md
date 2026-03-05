# ₿ BTC Treasury — Secure Bitcoin Automation

A high-performance, production-grade Bitcoin treasury management dashboard built on **OP_NET layer 1**. 

Designed for DAOs and organizations, it provides a secure interface for batch payouts, automatic UTXO consolidation, and on-chain policy management with delegated PSBT signing.

![BTC Treasury Dashboard Mockup](https://raw.githubusercontent.com/placeholder-repo/assets/main/dashboard-preview.png)
*(Replace with actual screenshot before public release)*

---

## 🚀 Key Features

- **� Dynamic Treasury Management**: One-click deployment of PolicyVault smart contracts.
- **� Programmable On-Chain Policies**: 
  - **Daily Spending Limits**: Prevent massive drain via contract-enforced caps.
  - **Whitelisting**: Restrict payouts to approved addresses only.
  - **Multi-Level Security**: Combine web-flow simplicity with the security of raw PSBTs.
- **⚡ Performance Tools**:
  - **Batch Payouts**: Drastically reduce fee overhead by sending to multiple recipients in one TX.
  - **UTXO Consolidation**: Smart merging of "dust" inputs to optimize your wallet health.
- **🔐 Non-Custodial Signing**: 
  - Integrates with **Unisat** and **OP_WALLET**.
  - No private keys ever touch the backend; all signing happens in your secure browser extension.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | Vite, TypeScript, Vanilla CSS3 (modern glassmorphism UI) |
| **Backend** | Node.js (ESM), Express, @btc-vision/transaction |
| **Smart Contract** | OP_NET (AssemblyScript), WASM |
| **Bitcoin Protocol** | OP_NET Layer 1, PSBT (BIP174) |

---

## 📦 Quick Start

### 1. Prerequisites
- **Node.js** >= 18.0.0
- **OP_WALLET** or **Unisat** extension installed.

### 2. Local Installation
```bash
# Clone the repository
git clone https://github.com/YourUsername/btc-treasury.git
cd btc-treasury

# Install all dependencies (Backend + Frontend + Contract)
npm install
cd backend && npm install
cd ../frontend && npm install
```

### 3. Environment Configuration
Create a `.env` file in the `backend/` directory based on the provided `.env.example`:
```bash
PORT=3001
OPNET_RPC=https://testnet.opnet.org
# Optional proxy for overcoming geo-restrictions
# PROXY_URL=your_proxy_url
```

### 4. Running the Application
```bash
# Start the Backend (from root)
cd backend && npm run dev

# Start the Frontend (from root)
cd frontend && npm run dev
```
Navigate to `http://localhost:5173` to access the dashboard.

---

## 📂 Project Structure

```text
/
├── backend/          # Node.js service for UTXO analysis and PSBT construction
├── frontend/         # Modern SPA for management and signing
├── contract/        # AssemblyScript source for PolicyVault
└── .gitignore       # Pre-configured to keep the repo clean
```

---

## 🛡️ Security First

- **Zero-Trust Backend**: The backend is "transaction-aware" but "key-blind". It constructs the binary transaction (PSBT) and the wallet extension signs it locally.
- **Contract Enforcement**: Even if your dashboard session is compromised, the `PolicyVault` contract on OP_NET will revert any transaction that violates the pre-set policies (Daily Cap, Whitelist).
- **Sanitized Outputs**: No identifiable secrets or internal paths are leaked in production logs.

---

## 📄 License
MIT License. See [LICENSE](LICENSE) for more details.

---

*Made with ❤️ for the Bitcoin ecosystem.*

