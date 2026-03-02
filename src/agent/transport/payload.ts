export interface SendPayload {
  message: string
  title?: string
  subtitle?: string
  expiration_date?: string
  sound?: string
  open_url?: string
  image_url?: string
}

export function buildPayload(
  payload: SendPayload
): Record<string, string> {
  const body: Record<string, string> = { message: payload.message }
  if (payload.title) body.title = payload.title
  if (payload.subtitle) body.subtitle = payload.subtitle
  if (payload.expiration_date) body.expiration_date = payload.expiration_date
  if (payload.sound) body.sound = payload.sound
  if (payload.open_url) body.open_url = payload.open_url
  if (payload.image_url) body.image_url = payload.image_url
  return body
}
