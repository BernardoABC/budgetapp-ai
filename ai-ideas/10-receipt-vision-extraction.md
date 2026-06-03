# 10 — Receipt Photo Extraction (STRETCH)

**Model fit:** Stretch ⚠️ — **needs a vision model**, not Qwen 2.5 7B *text* ·
**Effort:** L · **Value:** ★★

## Concept

Snap a photo of a paper receipt (or a PDF/e-receipt from a Costa Rican merchant)
and have the app extract a structured transaction: merchant, date, total, tax
(IVA 13%), maybe line items — then match it to an existing imported transaction or
create a manual entry pre-filled and pre-categorized.

Useful for **cash purchases** that never appear in a bank CSV, and for attaching
itemized detail (and IVA, relevant if you track deductible expenses) to card
transactions that only import as a single total.

## Why it's flagged stretch

- **Different modality.** Qwen 2.5 7B (text) can't read images. This needs a
  **vision-language model**: `qwen2.5-vl:7b`, `llama3.2-vision:11b`, or
  `minicpm-v` via Ollama — a separate (larger) model pull and more VRAM.
- **OCR robustness.** Phone photos of thermal receipts are noisy: glare, curl,
  faded ink, Spanish + abbreviations. A 7B-class VLM gets the total and merchant
  most of the time but struggles with full line-item fidelity. Good enough for
  "merchant + date + total + IVA"; unreliable for itemization.
- **Most spend already arrives via CSV import**, so the marginal value is narrower
  (cash + itemization) than the categorization ideas.

## Architecture

- **Serving:** add a vision model to Ollama (idea 00 infra), kept optional behind
  its own flag (`AI_VISION_MODEL`). Don't make core features depend on it.
- **`internal/ai`:** `ExtractReceipt(ctx, imageBytes) (Receipt, error)` →
  constrained JSON `{merchant, date, currency, total, tax, items[]}`.
- **Storage:** a `receipts` table (id, image blob or path, extracted JSON,
  linked `transaction_id` nullable). Store the original image locally (privacy is
  a non-issue here) for audit.
- **Matching:** after extraction, search existing transactions in the target
  account by date±2d and amount≈total to suggest a link (reuse importer's
  duplicate/match logic); else offer "create manual transaction" pre-filled, then
  run idea 01 to categorize it.
- **Frontend:** an "Add receipt" upload/camera control; a review screen to confirm
  extracted fields before saving; the receipt thumbnail attaches to the
  transaction detail.

## Extraction output schema

```json
{
  "type":"object",
  "properties":{
    "merchant":{"type":"string"},
    "date":{"type":"string"},
    "currency":{"type":"string","enum":["CRC","USD"]},
    "total":{"type":"integer"},   // minor units
    "tax":{"type":"integer"},
    "items":{"type":"array","items":{
      "type":"object",
      "properties":{"desc":{"type":"string"},"amount":{"type":"integer"}},
      "required":["desc","amount"]}}
  },
  "required":["merchant","date","total","currency"]
}
```

## Validation & safety

- **Always human-confirm** extracted fields before saving — OCR errors on money
  are unacceptable to auto-commit. The model proposes; the user verifies.
- Sanity-check: items sum ≈ total (within rounding + tax); flag mismatches.
- Reject/blank low-confidence fields rather than guessing a wrong number.

## Effort

**L.** New modality (vision model + serving), image upload/storage, an extraction
+ review flow, and matching. Meaningfully more than the text ideas.

## Recommendation

**Lowest priority.** Only worth it if (a) you have meaningful cash spending the
CSV imports miss, or (b) you specifically want itemized/IVA detail, and (c) you're
willing to run a vision model. Otherwise the text-based ideas deliver far more
value per unit effort. Park it unless those conditions hold.

## Risks / notes

- Thermal-receipt OCR quality varies wildly; set expectations to "fast capture of
  total + merchant", not perfect itemization.
- Costa Rican electronic invoices (factura electrónica) are XML — if you can get
  the XML instead of a photo, parse it deterministically and skip the vision
  model entirely. Worth checking before building OCR.
