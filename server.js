const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'finance.json');
const PORT = Number(process.env.PFD_PORT) || 4173;
const MAX_BODY = 2 * 1024 * 1024;
const initialData = () => ({ version: 1, income: { name: 'เงินเดือน', amount: 0 }, deductions: [], expenses: [] });

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanAmount(value, allowZero = true) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) throw new Error('จำนวนเงินไม่ถูกต้อง');
  return Math.round(amount * 100) / 100;
}

function cleanData(input) {
  if (!input || input.version !== 1 || !input.income || !Array.isArray(input.deductions) || !Array.isArray(input.expenses)) {
    throw new Error('รูปแบบ JSON ไม่ถูกต้อง หรือไม่ใช่ schema version 1');
  }
  return {
    version: 1,
    income: { name: cleanText(input.income.name, 60) || 'เงินเดือน', amount: cleanAmount(input.income.amount) },
    deductions: input.deductions.map((item) => {
      if (!item || typeof item.id !== 'string' || !item.id) throw new Error('รายการหักมีข้อมูลไม่ครบ');
      return { id: cleanText(item.id, 100), name: cleanText(item.name, 60) || 'รายการหัก', amount: cleanAmount(item.amount) };
    }),
    expenses: input.expenses.map((item) => {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) throw new Error('รายจ่ายมีข้อมูลไม่ครบ');
      return {
        id: cleanText(item.id, 100), title: cleanText(item.title, 80) || 'ไม่มีชื่อรายการ',
        amount: cleanAmount(item.amount, false), category: cleanText(item.category, 40) || 'อื่นๆ',
        date: item.date, note: cleanText(item.note, 160)
      };
    })
  };
}

async function readData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    return cleanData(JSON.parse(content));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const data = initialData();
    await writeData(data);
    return data;
  }
}

async function writeData(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = path.join(DATA_DIR, `finance.${process.pid}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8' });
  await fs.rename(temp, DATA_FILE);
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY) throw Object.assign(new Error('ไฟล์ JSON ใหญ่เกินไป (สูงสุด 2 MB)'), { status: 413 });
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw Object.assign(new Error('อ่าน JSON ไม่สำเร็จ'), { status: 400 }); }
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/api/data' && req.method === 'GET') return sendJson(res, 200, await readData());
    if ((url.pathname === '/api/data' && req.method === 'PUT') || (url.pathname === '/api/import' && req.method === 'POST')) {
      const input = await readBody(req);
      let data;
      try { data = cleanData(input); }
      catch (error) { return sendJson(res, 400, { error: error.message }); }
      await writeData(data);
      return sendJson(res, 200, { ok: true, data });
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'ไม่พบ API นี้' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = path.resolve(ROOT, `.${requested}`);
    if (!filePath.startsWith(`${ROOT}${path.sep}`)) return sendJson(res, 403, { error: 'Forbidden' });
    const body = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'ไม่พบไฟล์' });
    sendJson(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Personal Finance on Dashboard is ready at http://127.0.0.1:${PORT}`);
  console.log(`JSON data: ${DATA_FILE}`);
});
