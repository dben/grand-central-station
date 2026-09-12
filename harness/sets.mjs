// `--set sim.hurry.enabled=false --set sim.ticks=30`: patch CONFIG in place so a
// harness run can A/B a rule without editing the file. A value with a comma in
// it is a list (`--set shop.week1.fixed=bus_stop,burger`).
import { CONFIG } from '../src/config.js';

export function applySets(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--set') continue;
    const [path, raw] = args[i + 1].split('=');
    const keys = path.split('.');
    let o = CONFIG;
    for (const k of keys.slice(0, -1)) o = o[k];
    const one = r => r === 'true' ? true : r === 'false' ? false : r === 'null' ? null : isNaN(Number(r)) ? r : Number(r);
    // a comma makes it a list, so `--set shop.week1.fixed=bus_stop,burger` works;
    // an empty list is `[]`
    const v = raw === '[]' ? [] : raw.includes(',') ? raw.split(',').map(one) : one(raw);
    o[keys[keys.length - 1]] = v;
    console.log(`set ${path} = ${JSON.stringify(v)}`);
  }
}
