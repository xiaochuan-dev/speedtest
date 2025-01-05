import {
  generateHostKey,
  getRandomNum,
  getTimeStamp,
  generateHostMD5Key,
} from './lib.js';
import { hosts } from './config.js';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import fse from 'fs-extra/esm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const limit = pLimit(10);

async function parseHTML({ host }) {
  const url = `https://tool.chinaz.com/speedtest/${host}`;

  const req = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });
  const text = await req.text();

  const $ = cheerio.load(text);
  const list = [...$('#speedlist .listw')];

  const res = list.map((ele) => {
    const q = $(ele);
    const id = q.attr('id');
    const token = q.attr('token');
    const city = q.find('span[name="city"]').text();

    return {
      city,
      token,
      guid: id,
    };
  });

  return res;
}

async function request({ host, guid, token }) {
  const hostKey = generateHostKey(host);
  const rd = getRandomNum(hostKey);
  const ts = getTimeStamp();
  const secretkey = generateHostMD5Key(hostKey, ts);

  const data = {
    host,
    guid,
    rd,
    ts,
    token,
    secretkey,
    identify: 0,
  };

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 3000 * 10);

  const req = await fetch('https://tool.chinaz.com/pingcheck', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {
      'Content-Type': 'application/json',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    signal: controller.signal,
  });
  clearTimeout(id);

  const res = await req.json();
  return res;
}

function formatTable(data) {
  let s = '';

  let sum = 0;
  let error = 0;

  for (const item of data) {
    if (!item) {
      error += 1;
    } else {
      const { city, timeTotal, size, address } = item;
      sum += Number(timeTotal);

      const row = `|${city}|${address}|${size}|${timeTotal}|\n`;
      s += row;

    }
  }

  const avar = sum / (data.length - error);

  return {
    avar: avar.toString(),
    s,
    error,
  };
}


async function writeToFile({ host, data }) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outputpath = path.join(__dirname, '../output', `${host}.md`);

  await fse.ensureFile(outputpath);

  const { s, error, avar } = formatTable(data)

  const content = `
  # ${host}

  > 更新时间 ${new Date().toISOString()}
  
  总共请求 ${data.length}

  请求报错 ${error}

  平均耗时 ${avar}ms

|城市|ip|下载大小|速度|
|-----|----------|---|---|
${s}
  `;

  await fs.writeFile(outputpath, content, 'utf-8');
}

async function start(host) {
  const list = await parseHTML({ host });
  const tableP = list.map(({ city, token, guid }) => {

    return limit(async () => {
      const res = await request({ host, guid, token });

      const { address, timeTotal, sizeDownload } = res.data;

      return {
        city,
        address,
        timeTotal,
        size: `${sizeDownload}kb`,
      };
    });
  });

  const table = await Promise.allSettled(tableP);

  const res = table.map(({ status, value }) => {
    if (status === 'fulfilled') {
      return value;
    } else {
      return null;
    }
  });

  await writeToFile({ host, data: res });

  console.log(`写入${host}成功`);
}

async function run() {
  for (const host of hosts) {
    await start(host);
  }
}

run();