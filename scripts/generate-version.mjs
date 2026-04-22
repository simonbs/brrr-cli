import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const { version } = JSON.parse(readFileSync("package.json", "utf8"))
mkdirSync("src/generated", { recursive: true })
writeFileSync("src/generated/version.ts", `// generated — do not edit\nexport const VERSION = "${version}"\n`)
