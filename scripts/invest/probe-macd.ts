import { macdSeries } from "../../src/lib/technical/indicators"
// quadratic (accelerating) ramp — momentum genuinely building
const q = Array.from({ length: 40 }, (_, i) => 100 + i * i * 0.1)
const m = macdSeries(q)
console.log("quad hist[33..39]:", m.histogram.slice(33).map((h) => (h === null ? null : +h.toFixed(4))))
const lin = Array.from({ length: 40 }, (_, i) => 100 + i)
const ml = macdSeries(lin)
console.log("lin hist[33..39]:", ml.histogram.slice(33).map((h) => (h === null ? null : h.toExponential(2))))
