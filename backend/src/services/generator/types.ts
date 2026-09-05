export interface GeneratedRow {
  transactionId: string;
  orderId: string;
  merchantId: string;
  customerId: string;
  amount: number;
  currency: string;
  status: "success" | "failed" | "pending" | "refunded";
  paymentMethod: "card" | "upi" | "netbanking" | "wallet";
  cardToken?: string;
  deviceId: string;
  ipHash: string;
  country: string;
  city: string;
  timestamp: Date;
  refundAmount: number;
  chargebackFlag: boolean;
  failureReason?: string;
  /** Evaluation-only — see Transaction model for why this is hidden from the UI. */
  groundTruthRisk: number;
  /** Evaluation-only — which fraud pattern this row simulates, or undefined for normal traffic. */
  fraudScenario?: string;
}
