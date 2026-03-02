import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export async function getMacOsIdleSeconds(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ioreg", ["-c", "IOHIDSystem"], {
      timeout: 1000,
      maxBuffer: 1024 * 1024
    })
    const match = stdout.match(/HIDIdleTime"\s*=\s*(\d+)/) ?? stdout.match(/HIDIdleTime\s+=\s+(\d+)/)
    if (!match) return null

    const idleNanoseconds = Number(match[1])
    if (!Number.isFinite(idleNanoseconds)) return null

    return Math.floor(idleNanoseconds / 1_000_000_000)
  } catch {
    return null
  }
}

export async function shouldSkipNotificationForIdleThreshold(idleSeconds: number | undefined): Promise<boolean> {
  if (idleSeconds === undefined) return false

  const currentIdleSeconds = await getMacOsIdleSeconds()
  if (currentIdleSeconds === null) return false

  return currentIdleSeconds < idleSeconds
}
