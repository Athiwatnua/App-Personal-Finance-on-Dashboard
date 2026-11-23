const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'finance.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PORT = Number(process.env.PFD_PORT) || 4173;
const MAX_BODY = 2 * 1024 * 1024;
const initialData = () => ({ version: 1, income: { name: 'เงินเดือน', amount: 0 }, incomeHistory: [], deductions: [], expenses: [] });
const initialSettings = () => ({
  version: 1,
  expenseCategories: [
    { id: 'category-food', name: 'ค่าอาหาร' },
    { id: 'category-travel', name: 'ค่าเดินทาง' },
    { id: 'category-housing', name: 'ค่าที่พัก' },
    { id: 'category-shopping', name: 'ค่าช้อปปิ้ง' },
    { id: 'category-medical', name: 'ค่ารักษา' },
    { id: 'category-utilities', name: 'ค่าสาธารณูปโภค (ของใช้ประจำวัน)' },
    { id: 'category-other', name: 'ค่าใช้จ่ายอื่นๆ' }
  ],
  deductionOptions: [
    { id: 'deduction-social-security', name: 'ประกันสังคม' },
    { id: 'deduction-credit-card', name: 'บัตรเครดิต' },
    { id: 'deduction-cash-card', name: 'บัตรกดเงินสด' }
  ]
});

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanAmount(value, allowZero = true) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) throw new Error('จำนวนเงินไม่ถูกต้อง');
  return Math.round(amount * 100) / 100;
}

function cleanSettings(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.expenseCategories) || !Array.isArray(input.deductionOptions)) {
    throw new Error('รูปแบบการตั้งค่าไม่ถูกต้อง หรือไม่ใช่ schema version 1');
  }
  const cleanOptions = (items, label, maxNameLength) => {
    const ids = new Set(), names = new Set();
    return items.map((item) => {
      if (!item || typeof item.id !== 'string') throw new Error(`${label} มีข้อมูลไม่ครบ`);
      const id = cleanText(item.id, 100), name = cleanText(item.name, maxNameLength);
      if (!id || !name) throw new Error(`${label} ต้องมีรหัสและชื่อ`);
      const normalizedName = name.toLocaleLowerCase();
      if (ids.has(id) || names.has(normalizedName)) throw new Error(`${label} ห้ามมีรหัสหรือชื่อซ้ำ`);
      ids.add(id); names.add(normalizedName);
      return { id, name };
    });
  };
  return {
    version: 1,
    expenseCategories: cleanOptions(input.expenseCategories, 'หมวดหมู่รายจ่าย', 60),
    deductionOptions: cleanOptions(input.deductionOptions, 'ตัวเลือกรายการหัก', 60)
  };
}

async function readSettings() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { return cleanSettings(JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const settings = initialSettings();
    await writeSettings(settings);
    return settings;
  }
}

async function writeSettings(settings) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = path.join(DATA_DIR, `settings.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await fs.rename(temp, SETTINGS_FILE);
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanKplusReport(report) {
  if (!report || report.source !== 'K_PLUS' || report.currency !== 'THB' || !validIsoDate(report.report_date) || !Array.isArray(report.transactions) || !report.transactions.length || report.transactions.length > 5000) {
    throw new Error('รูปแบบ K PLUS JSON ไม่ถูกต้อง หรือไม่มี transactions');
  }
  return report.transactions.map((transaction) => {
    if (!transaction || !validIsoDate(transaction.transaction_date) || typeof transaction.transaction_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(transaction.transaction_time) || typeof transaction.account !== 'string' || !cleanText(transaction.account, 80)) {
      throw new Error('ข้อมูลวันที่ เวลา หรือบัญชีในธุรกรรมไม่ถูกต้อง');
    }
    const amount = cleanAmount(transaction.amount, false);
    const fee = cleanAmount(transaction.fee ?? 0);
    const balance = cleanAmount(transaction.available_balance);
    const hash = crypto.createHash('sha256').update([report.source, transaction.transaction_date, transaction.transaction_time, transaction.account, amount, fee, balance].join('|')).digest('hex');
    const time = transaction.transaction_time.slice(0, 5);
    return {
      id: `kplus-${hash}`,
      title: `K+ · ${time}`,
      amount: Math.round((amount + fee) * 100) / 100,
      date: transaction.transaction_date,
      transactionTime: transaction.transaction_time,
      account: cleanText(transaction.account, 80),
      fee,
      availableBalance: balance
    };
  });
}

async function archiveKplusReport(report, importedAt) {
  if (!validIsoDate(importedAt)) throw new Error('วันที่นำเข้าไม่ถูกต้อง');
  const [year, month, day] = importedAt.split('-').map(Number);
  const baseName = `import-email-kplus-${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year + 543}`;
  const importDir = path.join(DATA_DIR, 'imports');
  await fs.mkdir(importDir, { recursive: true });
  const content = `${JSON.stringify(report, null, 2)}\n`;
  for (let suffix = 1; suffix <= 1000; suffix++) {
    const fileName = `${baseName}${suffix === 1 ? '' : `-${suffix}`}.json`;
    try {
      await fs.writeFile(path.join(importDir, fileName), content, { encoding: 'utf8', flag: 'wx' });
      return fileName;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('สร้างชื่อไฟล์นำเข้าไม่สำเร็จ');
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
      return { id: cleanText(item.id, 100), ...(typeof item.optionId === 'string' && cleanText(item.optionId, 100) ? { optionId: cleanText(item.optionId, 100) } : {}), name: cleanText(item.name, 60) || 'รายการหัก', amount: cleanAmount(item.amount), history: [...amountsByMonth.values()].sort((a, b) => a.month.localeCompare(b.month)) };
    }),
    expenses: input.expenses.map((item) => {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) throw new Error('รายจ่ายมีข้อมูลไม่ครบ');
      return {
        id: cleanText(item.id, 100), title: cleanText(item.title, 80) || 'ไม่มีชื่อรายการ',
        amount: cleanAmount(item.amount, false), category: cleanText(item.category, 60) || 'อื่นๆ',
        ...(typeof item.categoryId === 'string' && cleanText(item.categoryId, 100) ? { categoryId: cleanText(item.categoryId, 100) } : {}),
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
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      return sendJson(res, 200, { settings: await readSettings() });
    }
    if (url.pathname === '/api/settings' && req.method === 'PUT') {
      let settings;
      try { settings = cleanSettings(await readBody(req)); }
      catch (error) { return sendJson(res, 400, { error: error.message }); }
      await writeSettings(settings);
      return sendJson(res, 200, { ok: true, settings });
    }
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
    if (url.pathname === '/api/import/kplus' && req.method === 'POST') {
      const input = await readBody(req);
      let transactions;
      try { transactions = cleanKplusReport(input.report); }
      catch (error) { return sendJson(res, 400, { error: error.message }); }
      const settings = await readSettings();
      const category = settings.expenseCategories.find((item) => item.id === input.categoryId);
      if (!category) return sendJson(res, 400, { error: 'กรุณาเลือกหมวดหมู่รายจ่ายที่ยังใช้งานอยู่' });
      const profiles = await readProfiles();
      const profile = profiles.profiles.find((item) => item.id === profiles.activeProfileId) || profiles.profiles[0];
      if (!profile) return sendJson(res, 404, { error: 'ไม่พบโปรไฟล์สำหรับนำเข้าข้อมูล' });
      const fileName = await archiveKplusReport(input.report, input.importedAt);
      const data = await readProfileData(profile);
      const existingIds = new Set(data.expenses.map((item) => item.id));
      const expenses = transactions.filter((item) => !existingIds.has(item.id)).map((item) => ({
        id: item.id,
        title: item.title,
        amount: item.amount,
        category: category.name,
        categoryId: category.id,
        date: item.date,
        note: `K PLUS · บัญชี ${item.account} · เวลา ${item.transactionTime} · ค่าธรรมเนียม ${item.fee.toFixed(2)} · คงเหลือ ${item.availableBalance.toFixed(2)}`
      }));
      const uniqueExpenses = [...new Map(expenses.map((item) => [item.id, item])).values()];
      const skipped = transactions.length - uniqueExpenses.length;
      data.expenses.push(...uniqueExpenses);
      const clean = cleanData(data);
      await writeProfileData(profile, clean);
      return sendJson(res, 200, { ok: true, data: withProfile(clean, profile), added: uniqueExpenses.length, skipped, fileName });
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
