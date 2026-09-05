"""
Pydantic schemas for the ML service's public API.

TransactionInput accepts raw transaction fields plus an OPTIONAL
`context` block of precomputed contextual feature values. This
mirrors the spec's failure-handling requirement ("missing data ->
reduced features, lower confidence"): the Node backend can supply
context computed via its own rule-engine queries (Phase 4) for full
accuracy, but if it's omitted, sensible neutral defaults are used and
the response is marked as lower-confidence rather than failing.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class TransactionContext(BaseModel):
    """Optional precomputed contextual features. Any field left out defaults to a neutral value (see analyze.py)."""

    amountDeviationFromCustomerMean: Optional[float] = None
    transactionsIn5Minutes: Optional[float] = None
    transactionsIn1Hour: Optional[float] = None
    deviceTransactionCountLifetime: Optional[float] = None
    failedAttemptsIn1Hour: Optional[float] = None
    uniqueCardsPerDevice: Optional[float] = None
    uniqueCardsPerDeviceLifetime: Optional[float] = None
    uniqueCustomersPerDevice: Optional[float] = None
    merchantVolumeDeviation: Optional[float] = None
    customerAccountAge: Optional[float] = None
    refundRate: Optional[float] = None
    chargebackRate: Optional[float] = None
    isDuplicateOrder: Optional[bool] = None
    locationChangedFromPrevious: Optional[bool] = None
    deviceNovelty: Optional[bool] = None
    ipNovelty: Optional[bool] = None


class TransactionInput(BaseModel):
    transactionId: str
    amount: float = Field(ge=0)
    refundAmount: float = Field(default=0, ge=0)
    chargebackFlag: bool = False
    context: Optional[TransactionContext] = None


class FeatureContribution(BaseModel):
    feature: str
    value: float
    contribution: float


class AnalyzeTransactionResponse(BaseModel):
    transactionId: str
    anomalyScore: float
    supervisedProbability: float
    modelVersion: str
    usedDefaultFeatures: bool
    confidence: str  # "high" | "reduced"
    topContributingFeatures: list[FeatureContribution]
    latencyMs: float


class AnalyzeBatchRequest(BaseModel):
    transactions: list[TransactionInput]


class AnalyzeBatchResponse(BaseModel):
    results: list[AnalyzeTransactionResponse]
    totalProcessed: int
    averageLatencyMs: float
    throughputPerSecond: float


class EvaluateRequest(BaseModel):
    dataDir: str
    split: str = "test_heldout"
    decisionThreshold: float = 0.5


class EvaluateResponse(BaseModel):
    rowCount: int
    positiveCount: int
    positiveRate: float
    precision: float
    recall: float
    f1: float
    prAuc: float
    falsePositiveRate: float
    falseNegativeRate: float
    confusionMatrix: dict
    averageInferenceLatencyMs: float
    throughputPerSecond: float
    decisionThreshold: float
    modelVersion: str
    byScenario: dict
