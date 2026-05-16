import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "main");
const dest = join(__dirname, "public");

mkdirSync(dest, { recursive: true });

function minifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s*([{}:;,])\s*/g, "$1")
    .replace(/;\}/g, "}")
    .replace(/\s+/g, " ")
    .trim();
}

const html = readFileSync(join(src, "index.html"), "utf-8");
writeFileSync(join(dest, "index.html"), html);

const css = readFileSync(join(src, "styles.css"), "utf-8");
writeFileSync(join(dest, "styles.css"), minifyCSS(css));

const js = readFileSync(join(src, "script.js"), "utf-8");
const { code } = await minify(js, {
  module: true,
  mangle: true,
  compress: true,
  format: { comments: false },
});
writeFileSync(join(dest, "script.js"), code);

const solver = readFileSync(join(src, "solver.js"), "utf-8");
const { code: solverCode } = await minify(solver, {
  module: true,
  mangle: true,
  compress: true,
  format: { comments: false },
});
writeFileSync(join(dest, "solver.js"), solverCode);

console.log("Build complete → public/");
