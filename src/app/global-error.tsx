"use client"

// Last-resort boundary: replaces the root layout when it fails, so it must
// render its own <html>/<body>. Kept dependency-free (no providers, no UI
// imports) and bilingual with both languages always present.

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" dir="ltr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#060906",
          color: "#F5F8F3",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: 24,
        }}
      >
        <main
          role="alert"
          style={{
            maxWidth: 520,
            width: "100%",
            borderRadius: 16,
            border: "1px solid #202B23",
            background: "#0B100D",
            padding: "28px 24px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              margin: "0 auto",
              borderRadius: 10,
              border: "1px solid rgba(163,230,53,0.35)",
              background: "#0B0F0D",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#A3E635",
              fontWeight: 700,
              fontSize: 18,
            }}
            aria-hidden
          >
            M
          </div>
          <h1 style={{ fontSize: 19, margin: "16px 0 8px" }}>تعذّر تحميل التطبيق — Application error</h1>
          <p style={{ fontSize: 13, lineHeight: 1.8, color: "#C3CFC5", margin: 0, direction: "rtl" }}>
            حدث خطأ غير متوقع. لم يتم تعديل أي بيانات. أعد المحاولة من الزر أدناه.
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.8, color: "#C3CFC5", margin: "6px 0 0" }}>
            An unexpected error occurred. No data was modified. Please retry below.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 18,
              borderRadius: 10,
              border: "1px solid rgba(163,230,53,0.45)",
              background: "#A3E635",
              color: "#0B0F0D",
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            إعادة المحاولة — Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: 14, fontSize: 11, color: "#8A9A8E" }}>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
