// Migration shim (see ARCHITECTURE.md) — corporate-actions split into layers:
// the PURE math lives in the domain, the DB/fetch loaders in infrastructure.
export * from "@/domain/market/corporate-actions"
export * from "@/infrastructure/market/corporate-actions-store"
