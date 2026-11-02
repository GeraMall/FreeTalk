import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const name = process.argv[2]
if (!["inspect", "invite", "record", "verify"].includes(name))
  throw new Error("Use inspect, invite, record or verify")
// The CLI expects an expression, while Prettier emits a JS expression statement.
const source = readFileSync(
  resolve(root, `scripts/marketing/${name}.js`),
  "utf8",
)
  .replace(/^;async/m, "async")
  .trim()
  .replace(/;$/, "")
  .replaceAll("D:/FreeTalk-gifs", root.replaceAll("\\", "/"))
mkdirSync(resolve(root, "output/playwright"), { recursive: true })
const target = `output/playwright/marketing-${name}-runner.js`
writeFileSync(resolve(root, target), source)
const command = `npx --yes --package @playwright/cli playwright-cli -s=marketing run-code --filename ${target} --json`
const result = spawnSync(command, {
  cwd: root,
  shell: true,
  encoding: "utf8",
  timeout: 180000,
})
writeFileSync(
  resolve(root, `output/playwright/marketing-${name}-result.json`),
  result.stdout || result.stderr || "",
)
process.stdout.write(result.stdout || "")
process.stderr.write(result.stderr || "")
process.exitCode = result.status ?? 1
