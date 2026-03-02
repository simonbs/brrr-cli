import { describe, expect, test } from "vitest"
import { parseWebhookRef, resolveWebhookRef } from "../src/agent/webhook-ref.js"

describe("webhook refs", () => {
  test("parses literal URL", () => {
    expect(parseWebhookRef("https://api.brr.now/v1/br_test")).toEqual({
      kind: "literal",
      value: "https://api.brr.now/v1/br_test"
    })
    expect(parseWebhookRef("https://dev.api.brrr.now/v1/br_test")).toEqual({
      kind: "literal",
      value: "https://dev.api.brrr.now/v1/br_test"
    })
  })

  test("parses env refs", () => {
    expect(parseWebhookRef("$BRRR_WEBHOOK_URL")).toEqual({
      kind: "env",
      name: "BRRR_WEBHOOK_URL",
      raw: "$BRRR_WEBHOOK_URL"
    })
    expect(parseWebhookRef("${BRRR_WEBHOOK_URL}")).toEqual({
      kind: "env",
      name: "BRRR_WEBHOOK_URL",
      raw: "${BRRR_WEBHOOK_URL}"
    })
  })

  test("rejects malformed refs", () => {
    expect(() => parseWebhookRef("$bad")).toThrow()
    expect(() => parseWebhookRef("ftp://api.brr.now/v1/br_test")).toThrow()
    expect(() => parseWebhookRef("https://example.com/v1/br_test")).toThrow()
    expect(() => parseWebhookRef("https://api.brr.now/v1/not_brrr")).toThrow()
  })

  test("resolves env refs", () => {
    const ref = parseWebhookRef("$BRRR_WEBHOOK_URL")
    expect(resolveWebhookRef(ref, { BRRR_WEBHOOK_URL: "https://api.brr.now/v1/br_test" })).toBe("https://api.brr.now/v1/br_test")
    expect(resolveWebhookRef(ref, { BRRR_WEBHOOK_URL: "https://dev.api.brrr.now/v1/br_test" })).toBe("https://dev.api.brrr.now/v1/br_test")
    expect(() => resolveWebhookRef(ref, {})).toThrow()
  })
})
