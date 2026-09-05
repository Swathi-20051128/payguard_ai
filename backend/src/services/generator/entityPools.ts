import { GenerateSampleInput } from "../../validation/transactionSchemas";
import { chance, Rng, pick, pickN, randFloat, randInt } from "./rng";

export interface CityRef {
  city: string;
  country: string;
}

// Primarily Indian cities (Razorpay's home market) with a handful of
// overseas cities so the location-anomaly scenario has somewhere
// dramatic to jump to.
export const CITY_POOL: CityRef[] = [
  { city: "Mumbai", country: "IN" },
  { city: "Delhi", country: "IN" },
  { city: "Bengaluru", country: "IN" },
  { city: "Chennai", country: "IN" },
  { city: "Hyderabad", country: "IN" },
  { city: "Pune", country: "IN" },
  { city: "Kolkata", country: "IN" },
  { city: "Ahmedabad", country: "IN" },
  { city: "Jaipur", country: "IN" },
  { city: "Singapore", country: "SG" },
  { city: "Dubai", country: "AE" },
  { city: "London", country: "GB" },
];

export const FAILURE_REASONS = ["insufficient_funds", "card_declined", "otp_failed", "network_error", "bank_timeout"];

export const PAYMENT_METHODS = ["card", "upi", "netbanking", "wallet"] as const;

export interface CustomerProfile {
  customerId: string;
  usualDeviceIds: string[];
  usualCardTokens: string[];
  usualCity: CityRef;
  avgAmount: number;
}

export interface MerchantProfile {
  merchantId: string;
  baselineHourlyVolume: number;
}

export interface EntityPools {
  customers: CustomerProfile[];
  merchants: MerchantProfile[];
  devices: string[];
  cardTokens: string[];
  ipHashes: string[];
}

/**
 * Builds the underlying entity pools (customers with their "usual"
 * device/card/city, merchants with a baseline volume) that both
 * normal and fraud-scenario generation draw from. Building profiles
 * up front — rather than picking everything fully at random per
 * transaction — is what makes "a new device for this customer" or
 * "this merchant is 4x its baseline" meaningful signals rather than
 * noise.
 */
export function buildEntityPools(rng: Rng, input: GenerateSampleInput): EntityPools {
  const devices = Array.from({ length: input.deviceCount }, (_, i) => `device_${i}`);
  const cardTokens = Array.from({ length: input.cardTokenCount }, (_, i) => `card_token_${i}`);
  const ipHashes = Array.from({ length: input.ipHashCount }, (_, i) => `ip_hash_${i}`);

  const merchants: MerchantProfile[] = Array.from({ length: input.merchantCount }, (_, i) => ({
    merchantId: `merchant_${i}`,
    // Most merchants are small/medium; a few are high-volume — a
    // realistic long-tail rather than a flat distribution.
    baselineHourlyVolume: chance(rng, 0.15) ? randInt(rng, 40, 90) : randInt(rng, 3, 25),
  }));

  const customers: CustomerProfile[] = Array.from({ length: input.customerCount }, (_, i) => ({
    customerId: `customer_${i}`,
    usualDeviceIds: pickN(rng, devices, randInt(rng, 1, 2)),
    usualCardTokens: pickN(rng, cardTokens, randInt(rng, 1, 2)),
    usualCity: pick(rng, CITY_POOL),
    avgAmount: Math.round(randFloat(rng, 250, 6000) * 100) / 100,
  }));

  return { customers, merchants, devices, cardTokens, ipHashes };
}
