import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
let count = 0;
async function check(folder) {
  for (const file of await readdir(resolve(root, folder), { withFileTypes: true })) {
    const path = `${folder}/${file.name}`;
    if (file.isDirectory()) { if (!["vendor", "validation", "fixtures"].includes(file.name)) await check(path); }
    else if (/\.(mjs|js)$/.test(file.name)) {
      const result = spawnSync(process.execPath, ["--check", resolve(root, path)], { stdio: "inherit" });
      if (result.status !== 0) process.exit(result.status || 1);
      count++;
    }
  }
}
for (const folder of ["web", "worker", "server", "scripts", "test"]) await check(folder);
console.log(`${count} source files checked`);
