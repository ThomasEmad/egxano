"use client"

// /admin/plans — inline editor for the 3 subscription plans.
// Edits PATCH /api/v1/admin/plans (admin-cookie auth, audited server-side);
// each row keeps a local draft until "حفظ" is pressed. Features are edited as
// one line per bullet and serialized to the JSON array the Plan row stores.
//
// Discount flow (owner mandate 2026-11-16): the discount is entered as a
// PERCENT — the first-month offer price is computed server-side from the
// base price; the owner never types two absolute prices.

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

interface PlanRow {
  id: string
  name: string
  price: number
  offerPrice: number | null
  offerActive: boolean
  offerLabel: string | null
  currency: string
  durationDays: number
  features: string
  isActive: boolean
  isDefault: boolean
  sortOrder: number
}

interface Draft {
  price: string
  offerPercent: string
  offerActive: boolean
  offerLabel: string
  durationDays: string
  features: string
  isActive: boolean
}

/** Round to 1 decimal for the displayed percent (derived from a stored price). */
function round1(x: number): string {
  return String(Math.round(x * 10) / 10)
}

/** The offer price the server will store for a given base price + percent. */
function computedOfferPrice(priceStr: string, pctStr: string): number | null {
  const price = Number(priceStr)
  const pct = Number(pctStr)
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(pct) || pct < 0 || pct > 95 || pctStr.trim() === "") return null
  return Math.round(price * (1 - pct / 100) * 100) / 100
}

function toDraft(plan: PlanRow): Draft {
  let lines: string[] = []
  try {
    const parsed = JSON.parse(plan.features)
    if (Array.isArray(parsed)) lines = parsed.map((f) => String(f))
  } catch {
    lines = []
  }
  const pct = plan.offerPrice !== null && plan.price > 0 ? ((1 - plan.offerPrice / plan.price) * 100).toFixed(1).replace(/\.0$/, "") : ""
  return {
    price: String(plan.price),
    offerPercent: pct,
    offerActive: plan.offerActive,
    offerLabel: plan.offerLabel ?? "",
    durationDays: String(plan.durationDays),
    features: lines.join("\n"),
    isActive: plan.isActive,
  }
}

export default function AdminPlansPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: () =>
      fetch("/api/v1/admin/plans", { credentials: "include" }).then((r) =>
        r.ok ? (r.json() as Promise<{ plans: PlanRow[] }>) : { plans: [] },
      ),
  })

  const save = useMutation({
    mutationFn: async ({ plan, draft }: { plan: PlanRow; draft: Draft }) => {
      const features = draft.features
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
      const body: Record<string, unknown> = {
        id: plan.id,
        price: Number(draft.price),
        durationDays: Number(draft.durationDays),
        offerActive: draft.offerActive,
        offerLabel: draft.offerLabel.trim() || null,
        isActive: draft.isActive,
        features,
      }
      // percent is the input language; the server computes the stored price
      body.offerPercent = draft.offerPercent.trim() === "" ? null : Number(draft.offerPercent)
      const res = await fetch("/api/v1/admin/plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.message ?? "فشل الحفظ")
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] })
      toast.success("تم الحفظ — التعديلات اتسجلت واتعمل ليها audit")
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "فشل الحفظ"),
  })

  const plans = useMemo(() => [...(data?.plans ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [data])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">الباقات</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          السعر الأساسي + نسبة خصم أول شهر (السعر النهائي للعرض بيتحسب تلقائيًا) + المدة وقائمة الميزات — التعديل بيظهر على الموقع خلال دقيقة (كاش الباقات 60 ثانية).
        </p>
      </div>

      <div className="grid gap-4">
        {plans.map((plan) => (
          <PlanEditor key={plan.id} plan={plan} saving={save.isPending} onSave={(draft) => save.mutate({ plan, draft })} />
        ))}
      </div>
    </div>
  )
}

function PlanEditor({
  plan,
  saving,
  onSave,
}: {
  plan: PlanRow
  saving: boolean
  onSave: (draft: Draft) => void
}) {
  // Local draft seeded from the server row (state initializer, not an effect —
  // a refetch re-renders with fresh props but never clobbers a mid-edit draft).
  const [draft, setDraft] = useState<Draft>(() => toDraft(plan))
  const original = useMemo(() => toDraft(plan), [plan])
  const dirty = JSON.stringify(draft) !== JSON.stringify(original)

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold">{plan.name}</p>
          <Badge variant="outline" className="text-[10px]">
            {plan.currency}
          </Badge>
          {!plan.isActive ? (
            <Badge variant="destructive" className="text-[10px]">
              غير مفعّلة
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => setDraft(original)}>
            <RotateCcw className="me-1 h-3.5 w-3.5" />
            تراجع
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={() => onSave(draft)}>
            {saving ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Save className="me-1 h-3.5 w-3.5" />}
            حفظ
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`${plan.id}-price`}>السعر (جنيه/شهر)</Label>
          <Input
            id={`${plan.id}-price`}
            type="number"
            min={0}
            step="1"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`${plan.id}-offer`}>خصم أول شهر (%)</Label>
          <Input
            id={`${plan.id}-offer`}
            type="number"
            min={0}
            max={95}
            step="0.5"
            placeholder="فارغ = بلا عرض"
            value={draft.offerPercent}
            onChange={(e) => setDraft({ ...draft, offerPercent: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">
            {(() => {
              const computed = computedOfferPrice(draft.price, draft.offerPercent)
              if (computed === null) return draft.offerPercent.trim() === "" ? "بلا عرض — أول شهر بالسعر الأساسي" : "نسبة غير صالحة (0–95)"
              return `سيُحفظ كعرض: أول شهر بـ ${computed} ${plan.currency} بدل ${draft.price} ${plan.currency}`
            })()}
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`${plan.id}-offer-label`}>نص العرض</Label>
          <Input
            id={`${plan.id}-offer-label`}
            value={draft.offerLabel}
            placeholder="أول شهر بخصم 40%"
            onChange={(e) => setDraft({ ...draft, offerLabel: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`${plan.id}-days`}>المدة (يوم)</Label>
          <Input
            id={`${plan.id}-days`}
            type="number"
            min={0}
            step="1"
            value={draft.durationDays}
            onChange={(e) => setDraft({ ...draft, durationDays: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`${plan.id}-features`}>الميزات (سطر لكل ميزة)</Label>
          <Textarea
            id={`${plan.id}-features`}
            rows={6}
            value={draft.features}
            onChange={(e) => setDraft({ ...draft, features: e.target.value })}
          />
        </div>
        <div className="space-y-4 pt-6">
          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <Label className="text-xs" htmlFor={`${plan.id}-offer-active`}>العرض مفعّل</Label>
            <Switch
              id={`${plan.id}-offer-active`}
              checked={draft.offerActive}
              onCheckedChange={(v) => setDraft({ ...draft, offerActive: v })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <Label className="text-xs" htmlFor={`${plan.id}-active`}>الباقة متاحة للاشتراك</Label>
            <Switch
              id={`${plan.id}-active`}
              checked={draft.isActive}
              onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
