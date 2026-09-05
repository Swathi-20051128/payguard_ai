# PayGuard AI — Explainable AI Risk Manager

**An explainable AI Risk Manager for coordinated payment abuse, duplicate payments, merchant anomalies, and refund/chargeback risk.**

Built for Razorpay's AI Buildathon — **AI Risk Manager** track.

> ⚠️ **Test-Mode / Defense-Only System.** PayGuard AI never connects to real payment processing, real cards, or real bank accounts, and never collects card numbers, CVVs, passwords, or government ID data. It scores risk, explains its reasoning, and routes decisions to a **human analyst**. It never blocks a real payment or auto-labels anything "fraud confirmed."

---

## 📋 Submission Checklist & Quick Links

- 🔑 **Demo Credentials**: See [Demo Credentials](#-demo-credentials)
- 🏛️ **Architecture Explanation**: See [Architecture Explanation](#-architecture-explanation)
- 🚀 **Setup Instructions**: See [Setup Instructions](#-setup-instructions)
- 📊 **Dataset Instructions**: See [Dataset Instructions](#-dataset-instructions)
- 🔌 **API Documentation**: See [API Documentation](#-api-documentation) & [`docs/API.md`](docs/API.md)
- 📈 **Evaluation Results**: See [Evaluation Results](#-evaluation-results)
- 🔒 **Security Notes**: See [Security Notes](#-security-notes) & [`SECURITY.md`](SECURITY.md)
- ⚠️ **Known Limitations**: See [Known Limitations](#-known-limitations)

---

## 🔑 Demo Credentials

| Role | Email | Password | Privileges |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@payguard.demo` | `AdminPass123!` | Full system access, data generator, batch risk scoring, SHA-256 audit verification |
| **Risk Analyst** | `analyst@payguard.demo` | `AnalystPass123!` | Data ingestion, risk scoring, case creation, analyst decision actions & notes |
| **Viewer** | `viewer@payguard.demo` | `ViewerPass123!` | Read-only access to Dashboard, Transactions, Alerts, Cases, and Audit logs |

---

## 🏛️ Architecture Explanation

PayGuard AI is designed with a decoupled microservice-style architecture so that slow or unavailable ML models degrade gracefully into transparent rule-based scoring without taking down the core payment ingestion API.

```
                  ┌────────────────────────────────────────┐
                  │          React + Vite + Tailwind       │
                  │            Frontend SPA (5173)         │
                  └───────────────────┬────────────────────┘
                                      │ HTTP (JWT Auth)
                                      ▼
                  ┌────────────────────────────────────────┐
                  │       Express + TypeScript API         │
                  │             Backend (4000)             │
                  └─────────┬───────────────────┬──────────┘
                            │                   │
               Mongoose /   │                   │ HTTP / JSON
             Aggregation    ▼                   ▼
                  ┌───────────┐       ┌────────────────────┐
                  │  MongoDB  │       │ FastAPI ML Service │
                  │  (27017)  │       │   Python (8001)    │
                  └───────────┘       └─────────┬──────────┘
                                                │
                                                ▼
                                      ┌────────────────────┐
                                      │ scikit-learn / SHAP│
                                      │ Isolation Forest   │
                                      │   Random Forest    │
                                      └────────────────────┘
```

### Component Roles:
1. **Frontend SPA** (`frontend/`): Built with React 18, Vite, TypeScript, Tailwind CSS, and TanStack React Query. Features glassmorphism UI, dual Recharts metrics, role-based access control matrix, dark theme, and interactive case workflow tabs.
2. **Backend API** (`backend/`): Node.js Express server written in TypeScript. Handles JWT authentication, Zod request validation, MongoDB aggregation pipelines, batch risk scoring orchestrator, and an append-only SHA-256 hash-chained audit log.
3. **ML Risk Service** (`ml-service/`): Isolated Python FastAPI service running `scikit-learn` models (Isolation Forest + Random Forest). Computes 18 engineered features, provides SHAP model explanations, and exposes REST endpoints for batch and single transaction scoring.
4. **Database Layer**: MongoDB storing 6 collections (`users`, `transactions`, `alerts`, `cases`, `uploads`, `auditlogs`).

---

## 🚀 Setup Instructions

### Option 1: Docker Compose (Recommended)

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/payguard-ai.git
   cd payguard-ai
   ```

2. Copy the environment configuration:
   ```bash
   cp .env.example .env
   ```

3. Build and launch all services:
   ```bash
   docker compose up --build
   ```

4. Access the web services:
   - **Frontend UI**: [http://localhost:5173](http://localhost:5173)
   - **Backend API Health**: [http://localhost:4000/api/health](http://localhost:4000/api/health)
   - **ML Service Health**: [http://localhost:8001/ml/health](http://localhost:8001/ml/health)

---

### Option 2: Running Services Individually (No Docker)

```bash
# 1. ML Service (Python)
cd ml-service
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# 2. Backend (Express API - new terminal)
cd backend
npm install
npm run seed:all    # Seed 200 synthetic transactions, users, alerts, and cases
npm run dev         # http://localhost:4000

# 3. Frontend (React Vite UI - new terminal)
cd frontend
npm install
npm run dev         # http://localhost:5173
```

---

## 📊 Dataset Instructions

PayGuard AI includes built-in dataset seeding tools and supports external CSV/JSON dataset ingestion:

### 1. Seeding Pre-packaged Synthetic Dataset (200 Transactions)
Run the automated seed script to clear and populate MongoDB with 200 synthetic transactions across 10 fraud scenarios:
```bash
cd backend
npm run seed:all
```

### 2. Built-in Generator Panel
In the UI under **Data & Generator** (`http://localhost:5173/data`), select preset volume (100, 200, 500 txns) or input custom counts to generate datasets covering:
- Card Testing & Micro-authorizations
- Velocity Abuse (High frequency from single device)
- Account Takeover & Device Swaps
- Merchant Volume Spikes (Sudden 4x volume jump)
- Refund / Chargeback Abuse
- Duplicate Order IDs in quick succession
- Location Anomalies & High-Value Anomalies

### 3. Supplied Dataset Location
Raw benchmark datasets are stored in `data/`:
- `train.csv` (Training transactions)
- `test_heldout.csv` (1,800 held-out evaluation transactions)
- `merchants.csv`, `settlements.csv`, `refunds.csv`, `chargebacks.csv`

---

## 🔌 API Documentation

Detailed endpoint documentation is available in [`docs/API.md`](docs/API.md).

### Core Endpoint Summary:

| Method | Endpoint | Description | Role Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Authenticates user and returns JWT token | Public |
| `GET` | `/api/risk/summary` | Aggregated risk metrics, exposure, & fraud scenario counts | All |
| `GET` | `/api/transactions` | Paginated, filterable list of transactions | All |
| `POST` | `/api/transactions/upload` | Upload `.csv` or `.json` dataset file | Admin, Analyst |
| `POST` | `/api/transactions/generate-sample` | Generate synthetic fraud dataset | Admin, Analyst |
| `POST` | `/api/risk/analyze-batch` | Trigger batch risk scoring (Rules + ML) | Admin, Analyst |
| `GET` | `/api/alerts` | List flagged risk alerts | All |
| `POST` | `/api/cases` | Create an investigation case from alerts | Admin, Analyst |
| `PATCH` | `/api/cases/:id/decision` | Record analyst investigation decision | Admin, Analyst |
| `GET` | `/api/audit-logs/verify` | Verify SHA-256 audit hash chain integrity | Admin Only |

---

## 📈 Evaluation Results

The ML service is evaluated against 1,800 real held-out transactions (`data/test_heldout.csv`) not used during training:

| Evaluation Metric | Value |
| :--- | :--- |
| **Precision** | `0.832` (83.2%) |
| **Recall** | `0.568` (56.8%) |
| **F1 Score** | `0.675` |
| **PR-AUC** | `0.650` |
| **False Positive Rate** | `1.3%` |
| **False Negative Rate** | `43.2%` |
| **Inference Throughput** | ~55,000 – 62,000 rows/sec |

### Risk Scoring Formula:
$$\text{Final Risk Score} = 0.6 \times \text{RuleScore} + 0.4 \times \text{MLSupervisedProbability}$$

---

## 🔒 Security Notes

Complete security specifications are detailed in [`SECURITY.md`](SECURITY.md).

1. **Synthetic Data Only**: Never accepts real card numbers, CVVs, passwords, or government IDs. Uses synthetic tokens (`card_token_xxx`, `device_xxx`).
2. **Cryptographic Audit Trail**: Every mutating action is logged to an append-only ledger chained via SHA-256 hash signatures.
3. **Role-Based Access Control (RBAC)**: Enforces strict route permissions (`admin`, `analyst`, `viewer`).
4. **Password Hashing & JWT**: Bcrypt hashing (12 salt rounds) and signed JWT tokens with 8h expiry.

---

## ⚠️ Known Limitations

1. **Supplied Dataset Field Limitations**: 3 of 8 fraud scenarios in the benchmark dataset (`MERCHANT_SPIKE`, `COORDINATED_ACTIVITY`, `LOCATION_ANOMALY`) lack explicit structural fields for pure ML classification, requiring rule-engine fallback.
2. **Audit Chain Concurrency**: Audit log sequence assignment is read-and-increment; high concurrent writes could race if un-isolated.
3. **Test-Mode Scope**: All risk decisions (Hold, Verification, Watchlist) are simulated and do not block real bank networks.
"# payguard_ai" 
