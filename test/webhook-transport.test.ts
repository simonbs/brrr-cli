import { afterEach, describe, expect, test, vi } from "vitest"
import { sendWebhook } from "../src/agent/transport/webhook.js"
import { parseWebhookRef } from "../src/agent/webhook-ref.js"

describe("webhook transport", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("serializes only allowed fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    await sendWebhook(parseWebhookRef("https://api.brr.now/v1/br_test"), {
      message: "hello",
      title: "Title",
      subtitle: "Subtitle"
    }, "interactive")

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      }
    })
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      message: "hello",
      title: "Title",
      subtitle: "Subtitle"
    }))
  })

  test("reports failure payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 400,
      json: async () => ({ success: false, error: "bad request" })
    }))

    const result = await sendWebhook(parseWebhookRef("https://api.brr.now/v1/br_test"), {
      message: "hello"
    }, "interactive")

    expect(result).toEqual({ ok: false, error: "bad request" })
  })
})
