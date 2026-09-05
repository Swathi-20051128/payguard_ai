import { env } from "../config/env";
import { logger } from "../config/logger";
import { AnalysisContext } from "./rules/types";

const SINGLE_REQUEST_TIMEOUT_MS = 5_000;
const BATCH_REQUEST_TIMEOUT_MS = 30_000;

/** Mirrors the ML service's TransactionContext Pydantic schema exactly (see ml-service/app/core/schemas.py). */
export interface MlContextPayload {
  amountDeviationFromCustomerMean?: number;
  transactionsIn5Minutes?: number;
  transactionsIn1Hour?: number;
  deviceTransactionCountLifetime?: number;
  failedAttemptsIn1Hour?: number;
  uniqueCardsPerDevice?: number;
  uniqueCardsPerDeviceLifetime?: number;
  uniqueCustomersPerDevice?: number;
  merchantVolumeDeviation?: number;
  customerAccountAge?: number;
  refundRate?: number;
  chargebackRate?: number;
  isDuplicateOrder?: boolean;
  locationChangedFromPrevious?: boolean;
  deviceNovelty?: boolean;
  ipNovelty?: boolean;
}

export interface MlTransactionPayload {
  transactionId: string;
  amount: number;
  refundAmount: number;
  chargebackFlag: boolean;
  context: MlContextPayload;
}

/**
 * Maps the Node rule engine's already-fetched AnalysisContext (Phase
 * 4/6) into the ML service's context payload. A field is left
 * undefined — rather than sent as a guessed value — exactly when the
 * underlying Node computation itself couldn't establish enough
 * history for it (the same null-sentinel pattern the rule engine
 * already uses); the ML service then applies its own documented
 * neutral defaults and marks the prediction as reduced-confidence.
 * Every other field is always computable and always sent, even when
 * its value is a "boring" 0 (e.g. a brand-new customer's account age)
 * — that's real information, not a gap.
 */
export function mapContextToMlPayload(
  context: AnalysisContext,
  txn: { amount: number; city: string }
): MlContextPayload {
  const payload: MlContextPayload = {
    transactionsIn5Minutes: context.deviceAttemptsInWindow,
    transactionsIn1Hour: context.deviceAttemptsIn1Hour,
    deviceTransactionCountLifetime: context.deviceTransactionCountLifetime,
    failedAttemptsIn1Hour: context.failedAttemptsIn1Hour,
    uniqueCardsPerDevice: context.uniqueCardsPerDeviceInWindow,
    uniqueCardsPerDeviceLifetime: context.uniqueCardsPerDeviceLifetime,
    uniqueCustomersPerDevice: context.uniqueCustomersForDevice,
    customerAccountAge: context.customerAccountAgeDays,
    refundRate: context.customerRefundRate,
    chargebackRate: context.customerChargebackRate,
    isDuplicateOrder: context.isDuplicateOrderId,
    deviceNovelty: context.deviceNovelty,
    ipNovelty: context.ipNovelty,
  };

  if (context.customerAverageAmount !== null) {
    payload.amountDeviationFromCustomerMean =
      context.customerAmountStdDev && context.customerAmountStdDev > 0
        ? (txn.amount - context.customerAverageAmount) / context.customerAmountStdDev
        : 0; // no variance in prior history — same zero-variance convention the ML training pipeline uses
  }

  if (context.merchantHourlyBaseline !== null && context.merchantHourlyBaseline > 0) {
    payload.merchantVolumeDeviation =
      (context.merchantHourlyVolume - context.merchantHourlyBaseline) / context.merchantHourlyBaseline;
  }

  if (context.customerDominantCity !== null && context.customerDominantCityShare >= 0.5) {
    payload.locationChangedFromPrevious = txn.city !== context.customerDominantCity;
  }

  return payload;
}

export interface MlPredictionResult {
  transactionId: string;
  anomalyScore: number;
  supervisedProbability: number;
  modelVersion: string;
  usedDefaultFeatures: boolean;
  confidence: "high" | "reduced";
  topContributingFeatures: { feature: string; value: number; contribution: number }[];
}

/**
 * Scores a batch of transactions in ONE HTTP call to the ML service
 * (chunked if very large) rather than one call per transaction —
 * meaningfully cheaper for a 10k-row analyze-batch run. Returns null
 * on ANY failure (timeout, network error, 503 model-not-loaded) so
 * the caller can fall back to rules-only scoring for the whole batch
 * — this must never throw and break the pipeline (spec's
 * failure-handling requirement).
 */
export async function scoreBatch(payloads: MlTransactionPayload[]): Promise<MlPredictionResult[] | null> {
  if (payloads.length === 0) return [];

  const CHUNK_SIZE = 500;
  const results: MlPredictionResult[] = [];

  for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
    const chunk = payloads.slice(i, i + CHUNK_SIZE);
    const chunkResult = await scoreBatchChunk(chunk);
    if (chunkResult === null) {
      // One failed chunk means we can't trust partial ML coverage for
      // this batch — fail the whole thing over to rules-only rather
      // than silently mixing ML-scored and rules-only transactions
      // with no way for the caller to tell them apart.
      logger.warn({ chunkStart: i, chunkSize: chunk.length }, "ML batch chunk failed — falling back to rules-only for entire batch");
      return null;
    }
    results.push(...chunkResult);
  }

  return results;
}

async function scoreBatchChunk(payloads: MlTransactionPayload[]): Promise<MlPredictionResult[] | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BATCH_REQUEST_TIMEOUT_MS);

    const resp = await fetch(`${env.ML_SERVICE_URL}/ml/analyze/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: payloads }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      logger.warn({ status: resp.status }, "ML service returned a non-OK status for batch analyze");
      return null;
    }

    const body = (await resp.json()) as { results: MlPredictionResult[] };
    return body.results;
  } catch (err) {
    logger.warn({ err }, "ML service call failed (batch) — will fall back to rules-only");
    return null;
  }
}

/** Single-transaction equivalent, used by the standalone re-analyze-one-transaction route. */
export async function scoreOne(payload: MlTransactionPayload): Promise<MlPredictionResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SINGLE_REQUEST_TIMEOUT_MS);

    const resp = await fetch(`${env.ML_SERVICE_URL}/ml/analyze/transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      logger.warn({ status: resp.status }, "ML service returned a non-OK status for single analyze");
      return null;
    }

    return (await resp.json()) as MlPredictionResult;
  } catch (err) {
    logger.warn({ err }, "ML service call failed (single) — will fall back to rules-only");
    return null;
  }
}
