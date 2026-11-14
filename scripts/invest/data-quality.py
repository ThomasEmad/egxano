#!/usr/bin/env python3
"""Data-quality audit of production history samples (read-only inputs).

Inputs (fetched 2026-11-14 from https://egxano.vercel.app):
  A) /api/v1/market/history?symbol=T&range=5Y  -> MarketPrice-backed price-only
     series (docs/notes/data/history-samples/<T>.json)
  B) /api/v1/companies/<T>/technical           -> canonical adjusted daily OHLC
     candles for the 5 free-entitlement tickers
     (docs/notes/data/history-samples/technical-candles-<T>.json)

Checks per series: session count, first/last date, weekday distribution
(EGX trades Sun-Thu; Friday/Saturday sessions are phantom), duplicated dates,
sorted-ness, close-to-close gaps beyond +/-20% (EGX daily price limit), and
for OHLC candles: high<low, close outside [low,high], open outside [low,high],
zero/negative prices, and ~2x overnight gaps (unadjusted split signature).
Output: stdout report + docs/notes/data/quality-report.json
"""
import json, os, collections, datetime, sys

DATA = "/tmp/egx-work/docs/notes/data/history-samples"
OUT = "/tmp/egx-work/docs/notes/data/quality-report.json"

WEEKDAY = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 5: "Sat", 6: "Sun"}
EGX_TRADING = {"Sun", "Mon", "Tue", "Wed", "Thu"}

def day(ts):
    return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).date()

def weekday(ts):
    return WEEKDAY[datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).weekday()]

def check_series(name, rows, price_key="price", ts_key="timestamp"):
    r = {"source": name, "sessions": len(rows)}
    if not rows:
        r["empty"] = True
        return r
    days = [day(x[ts_key]) for x in rows]
    r["first"], r["last"] = str(days[0]), str(days[-1])
    wd = collections.Counter(weekday(x[ts_key]) for x in rows)
    r["weekday_distribution"] = {k: wd.get(k, 0) for k in ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]}
    r["phantom_weekend_sessions"] = wd.get("Fri", 0) + wd.get("Sat", 0)
    r["phantom_weekend_dates"] = sorted({str(d) for d, w in zip(days, [weekday(x[ts_key]) for x in rows]) if w in ("Fri", "Sat")})
    r["duplicate_dates"] = sorted({k for k, v in collections.Counter(str(d) for d in days).items() if v > 1})
    r["sorted_ascending"] = all(days[i] <= days[i + 1] for i in range(len(days) - 1))
    prices = [x[price_key] for x in rows]
    r["min_price"], r["max_price"] = min(prices), max(prices)
    gaps = []
    for i in range(1, len(rows)):
        if prices[i - 1] > 0:
            pct = (prices[i] - prices[i - 1]) / prices[i - 1] * 100
            if abs(pct) > 20:
                gaps.append({"from": str(days[i - 1]), "to": str(days[i]), "prev": prices[i - 1], "next": prices[i], "pct": round(pct, 2)})
    r["gaps_beyond_20pct"] = gaps
    return r

def check_candles(name, candles):
    r = check_series(name, candles, price_key="c", ts_key="t")
    viol_hl, viol_close, viol_open, nonpos, two_x = [], [], [], [], []
    for c in candles:
        o, h, l, cl = c["o"], c["h"], c["l"], c["c"]
        if h < l: viol_hl.append(c["t"])
        if not (l - 1e-9 <= cl <= h + 1e-9): viol_close.append(c["t"])
        if not (l - 1e-9 <= o <= h + 1e-9): viol_open.append(c["t"])
        if min(o, h, l, cl) <= 0: nonpos.append(c["t"])
    for i in range(1, len(candles)):
        prev, cur = candles[i - 1]["c"], candles[i]["c"]
        if prev > 0 and (cur / prev >= 1.7 or cur / prev <= 0.6):
            two_x.append({"from": candles[i - 1]["t"], "to": candles[i]["t"], "prev": prev, "next": cur, "ratio": round(cur / prev, 3)})
    r["ohlc_violations_high_lt_low"] = viol_hl
    r["ohlc_violations_close_outside"] = viol_close
    r["ohlc_violations_open_outside"] = viol_open
    r["nonpositive_prices"] = nonpos
    r["overnight_gaps_2x_signature"] = two_x
    r["has_volume_field"] = "v" in candles[0] if candles else False
    return r

report = {"generatedAt": datetime.datetime.utcnow().isoformat() + "Z",
          "marketprice_history": {}, "technical_candles": {}}

MP_TICKERS = ["COMI", "ETEL", "ABUK", "TMGH", "HRHO", "HDBK", "SWDY", "CANA", "MEPA", "ZEOT"]
for t in MP_TICKERS:
    p = f"{DATA}/{t}.json"
    if not os.path.exists(p):
        continue
    j = json.load(open(p))
    report["marketprice_history"][t] = check_series(f"/api/v1/market/history {t} (MarketPrice, range=5Y)", j.get("data", []))

FREE = ["COMI", "ETEL", "TMGH", "ABUK", "EFID"]
for t in FREE:
    p = f"{DATA}/technical-candles-{t}.json"
    if not os.path.exists(p):
        continue
    j = json.load(open(p))
    report["technical_candles"][t] = check_candles(f"/api/v1/companies/{t}/technical (adjusted OHLC candles)", j.get("candles", []))

json.dump(report, open(OUT, "w"), indent=2)

# ---- stdout report ----
print("=" * 100)
print("A) MarketPrice-backed /history series (public endpoint, price-only)")
print("=" * 100)
hdr = f"{'TKR':5} {'n':>3} {'first':10} {'last':10} {'Fri':>3} {'Sat':>3} {'dup':>3} {'sorted':6} {'gaps>20%':8}"
print(hdr)
for t, r in report["marketprice_history"].items():
    print(f"{t:5} {r['sessions']:>3} {r.get('first','-'):10} {r.get('last','-'):10} "
          f"{r['weekday_distribution'].get('Fri',0):>3} {r['weekday_distribution'].get('Sat',0):>3} "
          f"{len(r['duplicate_dates']):>3} {str(r['sorted_ascending']):6} {len(r['gaps_beyond_20pct']):>8}")
for t, r in report["marketprice_history"].items():
    if r["phantom_weekend_sessions"] or r["duplicate_dates"] or r["gaps_beyond_20pct"]:
        print(f"  {t}: phantom_dates={r['phantom_weekend_dates']} dup_dates={r['duplicate_dates']}")
        for g in r["gaps_beyond_20pct"]:
            print(f"    gap {g['from']} -> {g['to']}: {g['prev']} -> {g['next']} ({g['pct']:+.2f}%)")

print()
print("=" * 100)
print("B) Canonical technical candles (adjusted OHLC, free-entitlement tickers)")
print("=" * 100)
print(f"{'TKR':5} {'n':>3} {'first':10} {'last':10} {'Fri':>3} {'Sat':>3} {'dup':>3} {'sorted':6} {'H<L':>4} {'close out':>9} {'open out':>8} {'gaps>20%':8} {'2x sig':>6}")
for t, r in report["technical_candles"].items():
    print(f"{t:5} {r['sessions']:>3} {r.get('first','-'):10} {r.get('last','-'):10} "
          f"{r['weekday_distribution'].get('Fri',0):>3} {r['weekday_distribution'].get('Sat',0):>3} "
          f"{len(r['duplicate_dates']):>3} {str(r['sorted_ascending']):6} "
          f"{len(r['ohlc_violations_high_lt_low']):>4} {len(r['ohlc_violations_close_outside']):>9} "
          f"{len(r['ohlc_violations_open_outside']):>8} {len(r['gaps_beyond_20pct']):>8} {len(r['overnight_gaps_2x_signature']):>6}")
for t, r in report["technical_candles"].items():
    for g in r["gaps_beyond_20pct"]:
        print(f"  {t} gap {g['from']} -> {g['to']}: {g['prev']} -> {g['next']} ({g['pct']:+.2f}%)")
print("\nSaved:", OUT)
