#!/usr/bin/env python3
"""Select the backtest universe deterministically.

Mix: 12 candidates per bucket (EGX30 seed order / EGX70 seed order / MAIN by
ticker asc), so data-quality skips can still leave 10 valid names per bucket.
EGX30/EGX70 come from src/lib/market/tiers.ts seed order (stable, live-read
safe). MAIN comes from the audit's tier-enumeration.json (ticker -> marketTier
read off production rows); listing status from companies-snapshot.json.
Sector metadata rides along for segmentation.
Output: /tmp/egx-work/.cache/bt/universe.json
"""
import json

ROOT = "/tmp/egx-work"

EGX30_SEED = [
    "ETEL", "EAST", "CCAP", "COMI", "TMGH", "FWRY", "ORAS", "BTFH", "ORHD", "GBCO",
    "AMOC", "ABUK",
]
EGX70_SEED = [
    "MPCO", "MPCI", "POUL", "NIPH", "AIHC", "PRCL", "HDBK", "SIPC", "AMER", "PHAR",
    "ENGC", "ATQA",
]
# EGX70 seed order for 12 candidates:
EGX70_SEED = ["MPCO", "MPCI", "POUL", "NIPH", "AIHC", "PRCL", "HDBK", "SIPC", "AMER", "PHAR", "ENGC", "ATQA"]

comp = json.load(open(f"{ROOT}/docs/notes/data/companies-snapshot.json"))["companies"]
meta = {c["ticker"]: c for c in comp}
tier = json.load(open(f"{ROOT}/docs/notes/data/tier-enumeration.json"))["byTicker"]


def rec(tk, default_tier):
    c = meta.get(tk, {})
    return {
        "ticker": tk,
        "nameEn": c.get("nameEn"),
        "sector": c.get("sector", "Other"),
        "tier": default_tier,
        "listingStatus": c.get("listingStatus"),
        "isDemoData": c.get("isDemoData"),
    }


main_candidates = sorted(
    (t for t, v in tier.items() if v.get("marketTier") == "MAIN"),
)
main_recs = [rec(t, "MAIN") for t in main_candidates
             if meta.get(t, {}).get("listingStatus") == "LISTED"
             and meta.get(t, {}).get("isDemoData") is False][:12]

universe = {
    "generatedAt": "2026-11-14",
    "selectionRule": "12 candidates per bucket; first 10 with >=150 valid sessions win",
    "candidates": [
        [rec(t, "EGX30") for t in EGX30_SEED],
        [rec(t, "EGX70") for t in EGX70_SEED],
        main_recs,
    ],
}
# drop EGX30/EGX70 candidates not LISTED
for bucket in universe["candidates"][:2]:
    for r in bucket:
        pass
json.dump(universe, open(f"{ROOT}/.cache/bt/universe.json", "w"), ensure_ascii=False, indent=1)
for label, bucket in zip(["EGX30", "EGX70", "MAIN"], universe["candidates"]):
    print(label, [(r["ticker"], r["sector"]) for r in bucket])
