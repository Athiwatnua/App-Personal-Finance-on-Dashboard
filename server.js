const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'finance.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const PORT = Number(process.env.PFD_PORT) || 4173;
const MAX_BODY = 2 * 1024 * 1024;
const initialData = () => ({ version: 1, income: { name: 'เงินเดือน', amount: 0 }, incomeHistory: [], deductions: [], expenses: [] });

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
  const incomeHistory = input.incomeHistory === undefined ? [] : input.incomeHistory;
  if (!Array.isArray(incomeHistory)) throw new Error('ประวัติรายรับไม่ถูกต้อง');
  const incomeByMonth = new Map();
  for (const item of incomeHistory) {
    if (!item || typeof item.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month)) throw new Error('เดือนในประวัติรายรับไม่ถูกต้อง');
    incomeByMonth.set(item.month, { month: item.month, name: cleanText(item.name, 60) || 'เงินเดือน', amount: cleanAmount(item.amount) });
  }
  return {
    version: 1,
    income: { name: cleanText(input.income.name, 60) || 'เงินเดือน', amount: cleanAmount(input.income.amount) },
    incomeHistory: [...incomeByMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    deductions: input.deductions.map((item) => {
      if (!item || typeof item.id !== 'string' || !item.id) throw new Error('รายการหักมีข้อมูลไม่ครบ');
      const history = item.history === undefined ? [] : item.history;
      if (!Array.isArray(history)) throw new Error('ประวัติรายการหักไม่ถูกต้อง');
      const amountsByMonth = new Map();
      for (const entry of history) {
        if (!entry || typeof entry.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.month)) throw new Error('เดือนในประวัติรายการหักไม่ถูกต้อง');
        amountsByMonth.set(entry.month, { month: entry.month, amount: cleanAmount(entry.amount) });
      }
      return { id: cleanText(item.id, 100), name: cleanText(item.name, 60) || 'รายการหัก', amount: cleanAmount(item.amount), history: [...amountsByMonth.values()].sort((a, b) => a.month.localeCompare(b.month)) };
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

async function readProfiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const profiles = JSON.parse(await fs.readFile(PROFILES_FILE, 'utf8'));
    if (profiles.version === 1 && Array.isArray(profiles.profiles) && profiles.profiles.length) return profiles;
    throw new Error('รูปแบบ profiles.json ไม่ถูกต้อง');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const profiles = { version: 1, activeProfileId: 'profile-01', profiles: [{ id: 'profile-01', name: 'My Profile 01', file: 'finance.json' }] };
    await writeProfiles(profiles);
    return profiles;
  }
}

async function writeProfiles(profiles) {
  const temp = path.join(DATA_DIR, `profiles.${process.pid}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
  await fs.rename(temp, PROFILES_FILE);
}

async function readProfileData(profile) {
  try { return cleanData(JSON.parse(await fs.readFile(path.join(DATA_DIR, profile.file), 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const data = initialData();
    await writeProfileData(profile, data);
    return data;
  }
}

async function writeProfileData(profile, data) {
  const target = path.join(DATA_DIR, profile.file);
  const temp = path.join(DATA_DIR, `${profile.id}.${process.pid}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(temp, target);
}

function withProfile(data, profile) { return { ...data, profile: { id: profile.id, name: profile.name } }; }

function uniqueProfileName(profiles, requested) {
  const base = cleanText(requested, 60) || `My Profile ${String(profiles.length + 1).padStart(2, '0')}`;
  let name = base, suffix = 2;
  while (profiles.some((profile) => profile.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${base} (${suffix++})`;
  return name;
}

function isPristineProfile(data) { return Number(data.income.amount) === 0 && data.deductions.length === 0 && data.expenses.length === 0; }

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
    if (url.pathname === '/api/profiles' && req.method === 'GET') {
      const profiles = await readProfiles();
      return sendJson(res, 200, { activeProfileId: profiles.activeProfileId, profiles: profiles.profiles.map(({ id, name }) => ({ id, name })) });
    }
    if (url.pathname === '/api/profiles/active' && req.method === 'POST') {
      const profiles = await readProfiles();
      const input = await readBody(req);
      if (!profiles.profiles.some((profile) => profile.id === input.id)) return sendJson(res, 404, { error: 'ไม่พบโปรไฟล์นี้' });
      profiles.activeProfileId = input.id;
      await writeProfiles(profiles);
      return sendJson(res, 200, { activeProfileId: input.id });
    }
    const renameMatch = url.pathname.match(/^\/api\/profiles\/([a-zA-Z0-9-]+)$/);
    if (renameMatch && req.method === 'PATCH') {
      const profiles = await readProfiles();
      const profile = profiles.profiles.find((item) => item.id === renameMatch[1]);
      if (!profile) return sendJson(res, 404, { error: 'ไม่พบโปรไฟล์นี้' });
      const input = await readBody(req);
      const name = cleanText(input.name, 60);
      if (!name) return sendJson(res, 400, { error: 'กรุณาระบุชื่อโปรไฟล์' });
      profile.name = uniqueProfileName(profiles.profiles.filter((item) => item.id !== profile.id), name);
      await writeProfiles(profiles);
      return sendJson(res, 200, { id: profile.id, name: profile.name });
    }
    if (url.pathname === '/api/data' && req.method === 'GET') {
      const profiles = await readProfiles();
      const profile = profiles.profiles.find((item) => item.id === profiles.activeProfileId) || profiles.profiles[0];
      profiles.activeProfileId = profile.id;
      return sendJson(res, 200, withProfile(await readProfileData(profile), profile));
    }
    if ((url.pathname === '/api/data' && req.method === 'PUT') || (url.pathname === '/api/import' && req.method === 'POST')) {
      const input = await readBody(req);
      let data;
      try { data = cleanData(input.data || input); }
      catch (error) { return sendJson(res, 400, { error: error.message }); }
      const profiles = await readProfiles();
      if (url.pathname === '/api/import') {
        const requestedName = cleanText(input.profile?.name, 60);
        const reusable = requestedName && profiles.profiles.find((item) => item.name.toLocaleLowerCase() === requestedName.toLocaleLowerCase());
        const reusableData = reusable ? await readProfileData(reusable) : null;
        const canReuse = reusable && isPristineProfile(reusableData);
        const profile = canReuse
          ? { ...reusable, name: requestedName }
          : { id: `profile-${require('node:crypto').randomUUID()}`, name: uniqueProfileName(profiles.profiles, requestedName), file: `finance-${require('node:crypto').randomUUID()}.json` };
        await writeProfileData(profile, data);
        if (canReuse) profiles.profiles = profiles.profiles.map((item) => item.id === profile.id ? profile : item);
        else profiles.profiles.push(profile);
        profiles.activeProfileId = profile.id;
        await writeProfiles(profiles);
        return sendJson(res, 200, { ok: true, data: withProfile(data, profile), activeProfileId: profile.id, profiles: profiles.profiles.map(({ id, name }) => ({ id, name })) });
      }
      const profileId = input.profile?.id || profiles.activeProfileId;
      const profile = profiles.profiles.find((item) => item.id === profileId);
      if (!profile) return sendJson(res, 404, { error: 'ไม่พบโปรไฟล์สำหรับบันทึกข้อมูล' });
      await writeProfileData(profile, data);
      return sendJson(res, 200, { ok: true, data: withProfile(data, profile) });
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
