#!/usr/bin/env node
/**
 * seam:audit — what the screens PASS vs what the seam FORWARDS.
 *
 * components/ui is a compatibility seam (docs/design/INSTRUMENT.md stage 4):
 * ~89 files still call the old API and it translates onto INSTRUMENT. The
 * failure mode of any such seam is silent — a prop the screens pass that the
 * seam quietly drops type-checks, builds, renders, and is simply gone.
 *
 * This script walks app/(app) and prints every (component, prop) pair the
 * authenticated screens actually use, with counts. It does not decide what is
 * a bug — a seam SHOULD drop some props deliberately (Radix's Callout.Icon has
 * no equivalent; Card's size is fixed padding now). It makes the list visible
 * so the decision is made rather than assumed.
 *
 * IT HAS ALREADY EARNED ITS PLACE. Run against the first version of the seam
 * it surfaced three silent drops, none of which any other check could see:
 *
 *   Separator swallowed my/mb/mt      12 rules sat flush against their content
 *   Table cells understood only "end" 63 cells lost centre / between alignment
 *   Select.Trigger dropped `id`       20 <label htmlFor> pointed at nothing
 *
 * Pair it with app/(dev)/seam-harness, which renders these same shapes so the
 * result can be looked at as well as counted.
 *
 * Run: npm run seam:audit
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCAN = join(ROOT, "app", "(app)");

const SEAM = new Set(
  `Text Heading Card Button Badge Callout TextField TextArea Select Table
   AlertDialog Tabs Checkbox Switch Separator Spinner Link Container Code Box
   Flex Grid Section Skeleton RadioGroup RadioCards SegmentedControl DataList
   VisuallyHidden Theme`.split(/\s+/)
);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const pairs = new Map();
for (const file of walk(SCAN)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/<([A-Z]\w*)(?:\.(\w+))?\s([^>]*?)\/?>/gs)) {
    if (!SEAM.has(m[1])) continue;
    const key = m[2] ? `${m[1]}.${m[2]}` : m[1];
    if (!pairs.has(key)) pairs.set(key, new Map());
    const props = pairs.get(key);
    for (const pm of m[3].matchAll(/([\w-]+)=/g)) {
      props.set(pm[1], (props.get(pm[1]) ?? 0) + 1);
    }
  }
}

const names = [...pairs.keys()].sort();
console.log(
  `seam:audit — ${names.length} seam components used across the authenticated screens\n`
);
for (const name of names) {
  const props = [...pairs.get(name).entries()].sort((a, b) => b[1] - a[1]);
  console.log(name.padEnd(26), props.map(([p, c]) => `${p}(${c})`).join(", "));
}
console.log(
  `\nEvery prop above must either be forwarded by components/ui or dropped on ` +
    `purpose with a comment saying why. Anything else is a silent regression.`
);
