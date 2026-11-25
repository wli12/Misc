#!/usr/bin/env node
// Fetches the public Zhihu hot list and writes site/data/hot.json.
// Exits non-zero on failure so the previous deployment stays in place.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHot } from '../functions/zhihu-hot/hot.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../site/data/hot.json');

const data = await fetchHot();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');
console.log(`wrote ${data.items.length} items to ${OUT}`);
