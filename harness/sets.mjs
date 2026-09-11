// `--set sim.hurry.enabled=false --set sim.ticks=30`: patch CONFIG in place so a
// harness run can A/B a rule without editing the file.
import { CONFIG } from '../src/config.js';

export function applySets(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--set') continue;
    const [path, raw] = args[i + 1].split('=');
    const keys = path.split('.');
    let o = CONFIG;
    for (const k of keys.slice(0, -1)) o = o[k];
    const v = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : isNaN(Number(raw)) ? raw : Number(raw);
    o[keys[keys.length - 1]] = v;
    console.log(`set ${path} = ${JSON.stringify(v)}`);
  }
}
