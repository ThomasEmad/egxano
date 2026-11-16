import json, sys, urllib.request
d = json.load(urllib.request.urlopen(f"http://localhost:3000/api/v1/market/liquidity-heatmap?t={__import__('random').randint(0, 999999)}"))
print("asOf:", d.get("asOf"), "| prev:", d.get("prevAsOf"), "| live:", d.get("sessionLive"))
for s in d["sectors"]:
    prev = "None" if s["valuePrev"] is None else f"{s['valuePrev']/1e6:.1f}M"
    net = "None" if s["netValue"] is None else f"{s['netValue']/1e6:+.1f}M"
    print(f"{s['sector']:20s} today={s['valueToday']/1e6:>7.1f}M prev={prev:>8} net={net:>9} chg={str(s['changePct']):>8}% cos={s['companies']}")
