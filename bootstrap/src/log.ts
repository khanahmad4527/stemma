const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  teal: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

/**
 * Non-fatal failures are counted, not merely printed.
 *
 * A run that logs three red lines and then exits 0 with a success banner
 * makes a half-built instance look identical to a good one. The scripts
 * here read this before deciding what to print at the end.
 */
let failures = 0;

export const log = {
  step: (s: string) => console.log(`\n${c.teal("▸")} ${c.bold(s)}`),
  made: (s: string) => console.log(`  ${c.green("+")} ${s}`),
  skip: (s: string) => console.log(`  ${c.dim("·")} ${c.dim(`${s} (exists)`)}`),
  warn: (s: string) => console.log(`  ${c.yellow("!")} ${s}`),
  fail: (s: string) => { failures++; console.log(`  ${c.red("✗")} ${s}`); },
  failures: () => failures,
  info: (s: string) => console.log(`  ${c.dim(s)}`),
  done: (s: string) => console.log(`\n${c.green("✓")} ${c.bold(s)}\n`),
};
