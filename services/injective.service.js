import axios from "axios";

// Official Injective LCD
const LCD_BASE = "https://lcd.injective.network";

const api = axios.create({
  baseURL: LCD_BASE,
  timeout: 15000,
});

// Injective genesis total supply was 100,000,000 INJ
const GENESIS_SUPPLY_INJ = 100_000_000;

// ===============================
// Total Staked INJ
// ===============================
export async function getStakedInj() {
  try {
    const { data } = await api.get("/cosmos/staking/v1beta1/pool");

    const bonded = Number(data?.pool?.bonded_tokens ?? 0) / 1e18;

    return {
      staked: bonded,
    };
  } catch (err) {
    console.error("getStakedInj:", err.message);

    return {
      staked: null,
    };
  }
}

// ===============================
// Total Supply
// ===============================
export async function getSupplyInfo() {
  try {
    const { data } = await api.get(
      "/cosmos/bank/v1beta1/supply/by_denom?denom=inj"
    );

    const supply = Number(data?.amount?.amount ?? 0) / 1e18;

    return {
      totalSupply: supply,
    };
  } catch (err) {
    console.error("getSupplyInfo:", err.message);

    return {
      totalSupply: null,
    };
  }
}

// ===============================
// Burned INJ (static approximate figure)
// ===============================
//
// Injective's LCD doesn't expose a single "total burned" endpoint —
// burn data comes from summing auction-module rounds on-chain, which
// isn't practical for a live homepage call. Using a static, periodically
// updated approximate figure instead.
//
// Last updated: July 2026, based on public data:
//   - ~6.78M INJ burned via the original weekly Burn Auction
//   - ~178,338 INJ burned across 4 Community BuyBack rounds (since Nov 2025)
//   Total ≈ 6.96M INJ
//
// TODO: Update this number periodically (e.g. monthly) from
// https://injective.com/blog or the Injective Hub buyback page,
// or replace with a real indexer once available.
export async function getBurnedInj() {
  const STATIC_TOTAL_BURNED_INJ = 6_960_000;

  return {
    burned: STATIC_TOTAL_BURNED_INJ,
  };
}

// ===============================
// Net Supply Change vs Genesis
// ===============================
//
// Called by stats.controller.js as computeNetSupplyChange(market.totalSupply).
// Simple synchronous helper — no network call needed since genesis
// supply is a known constant.
export function computeNetSupplyChange(currentTotalSupply) {
  if (currentTotalSupply === null || currentTotalSupply === undefined) {
    return null;
  }

  return Number(currentTotalSupply) - GENESIS_SUPPLY_INJ;
}

// ===============================
// Staking Info (bonded amount + APR)
// ===============================
//
// Combines the staking pool (for totalStakedInj) with the mint module's
// inflation rate (for an approximate stakingAprPercent). Injective runs
// a standard cosmos-sdk mint module, so /cosmos/mint/v1beta1/inflation
// is available on the LCD.
export async function getStakingInfo() {
  try {
    const [poolRes, inflationRes] = await Promise.all([
      api.get("/cosmos/staking/v1beta1/pool"),
      api.get("/cosmos/mint/v1beta1/inflation").catch(() => null),
    ]);

    const bondedTokens = Number(poolRes.data?.pool?.bonded_tokens ?? 0) / 1e18;
    const notBondedTokens = Number(poolRes.data?.pool?.not_bonded_tokens ?? 0) / 1e18;

    const inflation = inflationRes
      ? Number(inflationRes.data?.inflation ?? 0)
      : null;

    // Rough APR approximation: inflation / bonded ratio.
    // (Real APR also factors in community tax; this is an estimate.)
    const totalSupply = bondedTokens + notBondedTokens;
    const bondedRatio = totalSupply > 0 ? bondedTokens / totalSupply : null;

    const stakingAprPercent =
      inflation !== null && bondedRatio
        ? (inflation / bondedRatio) * 100
        : null;

    return {
      totalStakedInj: bondedTokens,
      stakingAprPercent,
    };
  } catch (err) {
    console.error("getStakingInfo:", err.message);

    return {
      totalStakedInj: null,
      stakingAprPercent: null,
    };
  }
}

// ===============================
// Network Status (chain id + latest block)
// ===============================
export async function getNetworkStatus() {
  try {
    const { data } = await api.get("/cosmos/base/tendermint/v1beta1/blocks/latest");

    const height = data?.block?.header?.height ?? null;
    const time = data?.block?.header?.time ?? null;
    const chainId = data?.block?.header?.chain_id ?? null;

    return {
      chainId,
      latestBlockHeight: height ? Number(height) : null,
      latestBlockTime: time,
    };
  } catch (err) {
    console.error("getNetworkStatus:", err.message);

    return {
      chainId: null,
      latestBlockHeight: null,
      latestBlockTime: null,
    };
  }
}

// ===============================
// Validators Summary
// ===============================
export async function getValidatorsSummary() {
  try {
    const { data } = await api.get(
      "/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=200"
    );

    const validators = (data?.validators ?? [])
      .map((v) => ({
        moniker: v.description?.moniker ?? "Unknown",
        votingPowerInj: Number(v.tokens ?? 0) / 1e18,
        commissionRate: Number(v.commission?.commission_rates?.rate ?? 0),
        jailed: Boolean(v.jailed),
      }))
      .sort((a, b) => b.votingPowerInj - a.votingPowerInj);

    return {
      count: validators.length,
      validators,
    };
  } catch (err) {
    console.error("getValidatorsSummary:", err.message);

    return {
      count: null,
      validators: [],
    };
  }
}

// ===============================
// Latest Governance Proposal
// ===============================
export async function getLatestGovernanceProposal() {
  try {
    const { data } = await api.get(
      "/cosmos/gov/v1/proposals?pagination.reverse=true&pagination.limit=1"
    );

    const proposal = data?.proposals?.[0];
    if (!proposal) return null;

    return {
      id: proposal.id,
      title: proposal.title ?? proposal.messages?.[0]?.content?.title ?? "Untitled",
      status: proposal.status,
      votingEndTime: proposal.voting_end_time ?? null,
      submitTime: proposal.submit_time ?? null,
    };
  } catch (err) {
    console.error("getLatestGovernanceProposal:", err.message);
    return null;
  }
}