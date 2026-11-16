(() => {
  const CACHE_KEY = 'pfd-cache-v1';
  const today = new Date();
  const $ = (id) => document.getElementById(id);
  const freshState = () => ({ version: 1, income: { name: 'เงินเดือน', amount: 0 }, deductions: [], expenses: [] });
  const positive = (value) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
  const validExpense = (x) => x && typeof x.id === 'string' && typeof x.title === 'string' && positive(x.amount) > 0 && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date);
  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const currency = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const amount = (value) => currency.format(value);
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dateLabel = (date) => { const [y, m, d] = date.split('-').map(Number); return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d)); };
  const categoryColors = ['#4f9b72', '#7a83c4', '#e19961', '#d57575', '#4b9ca0', '#ae81b9', '#86a94f', '#d087ac', '#87949b', '#b3985d'];
  const icons = { 'อาหาร': '🍜', 'เดินทาง': '🚆', 'ที่พัก': '🏠', 'ช้อปปิ้ง': '🛍️', 'สุขภาพ': '✚', 'บิลและสาธารณูปโภค': '▤', 'บันเทิง': '♫', 'การศึกษา': '▣', 'อื่นๆ': '·' };
  let state = freshState();
  let saveQueue = Promise.resolve();
  const monthInput = $('monthFilter');
  monthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  let toastTimer;

  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
  }
  function setStatus(message, stateName = '') {
    const status = $('storageStatus'); status.innerHTML = `<i></i> ${esc(message)}`; status.dataset.state = stateName;
  }
  function persist() {
    const snapshot = JSON.stringify(state, null, 2);
    try { localStorage.setItem(CACHE_KEY, snapshot); } catch { /* JSON file remains the source of truth. */ }
    setStatus('กำลังบันทึกลง data/finance.json', 'saving');
    saveQueue = saveQueue.then(async () => {
      const response = await fetch('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: snapshot });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'บันทึกข้อมูลไม่สำเร็จ');
      setStatus('บันทึกลง data/finance.json แล้ว', 'saved');
    }).catch((error) => { setStatus('บันทึก JSON ไม่สำเร็จ · ตรวจสอบเซิร์ฟเวอร์', 'error'); toast(error.message); });
    return saveQueue;
  }
  async function loadData() {
    try {
      setStatus('กำลังอ่าน data/finance.json', 'loading');
      const response = await fetch('/api/data', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'อ่านไฟล์ข้อมูลไม่สำเร็จ');
      state = result;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* Optional local recovery cache. */ }
      render(); setStatus('อ่านข้อมูลจาก data/finance.json แล้ว', 'saved');
    } catch {
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached?.version === 1 && cached.income && Array.isArray(cached.deductions) && Array.isArray(cached.expenses)) state = cached;
      } catch { /* Start with an empty record if there is no local cache. */ }
      render(); setStatus('ไม่ได้เชื่อมต่อไฟล์ JSON · เปิดผ่าน start.bat', 'error');
      toast('เปิด start.bat หรือรัน node server.js ก่อนใช้งาน');
    }
  }
  function switchView(view) {
    const isDashboard = view === 'dashboard';
    $('recordSummary').hidden = isDashboard;
    $('recordView').hidden = isDashboard;
    $('dashboardView').hidden = !isDashboard;
    document.querySelectorAll('[data-view]').forEach((link) => link.classList.toggle('active', link.dataset.view === view));
    const title = isDashboard ? 'My Finance Dashboard' : 'My Finance Record';
    $('pageTitle').textContent = title; $('pageCrumb').textContent = title;
    $('pageDescription').textContent = isDashboard ? 'ภาพรวมรายรับ รายจ่าย และเงินคงเหลือของเดือนที่เลือก' : 'จัดการรายรับ รายการหัก และบันทึกรายจ่ายของคุณ';
    render();
  }
  function render() {
    const selectedMonth = monthInput.value || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const [year, month] = selectedMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const expenses = state.expenses.filter((item) => item.date.startsWith(selectedMonth)).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const gross = positive(state.income.amount);
    const deductions = state.deductions.reduce((sum, item) => sum + positive(item.amount), 0);
    const net = gross - deductions;
    const spent = expenses.reduce((sum, item) => sum + positive(item.amount), 0);
    const balance = net - spent;

    $('grossTotal').textContent = amount(gross); $('deductionTotal').textContent = amount(deductions); $('netTotal').textContent = amount(net); $('balanceTotal').textContent = amount(balance);
    $('incomeName').textContent = state.income.name || 'เงินเดือน'; $('incomeAmount').textContent = amount(gross);
    $('expensesTotal').textContent = amount(spent); $('breakdownIncome').textContent = amount(net); $('breakdownExpenses').textContent = amount(spent);
    $('expenseCount').textContent = `${expenses.length} รายการในเดือนนี้`; $('tableFooter').textContent = `แสดง ${expenses.length} รายการ`;
    $('emptyState').classList.toggle('visible', expenses.length === 0);
    $('expenseRows').innerHTML = expenses.map((item) => `<tr class="expense-row"><td><div class="expense-name"><span class="category-icon">${icons[item.category] || '·'}</span><span>${esc(item.title || 'ไม่มีชื่อรายการ')}${item.note ? `<small class="row-note">${esc(item.note)}</small>` : ''}</span></div></td><td><span class="category-label">${esc(item.category)}</span></td><td><span class="date-label">${dateLabel(item.date)}</span></td><td class="amount">${amount(item.amount)}</td><td><div class="row-actions"><button type="button" aria-label="แก้ไข ${esc(item.title || 'รายการ')}" data-edit-expense="${esc(item.id)}">✎</button><button type="button" aria-label="ลบ ${esc(item.title || 'รายการ')}" data-delete-expense="${esc(item.id)}">×</button></div></td></tr>`).join('');
    $('deductionList').innerHTML = state.deductions.length ? state.deductions.map((item) => `<div class="deduction-item"><i class="deduction-bullet"></i><span class="deduction-name">${esc(item.name)}</span><strong class="deduction-amount">−${amount(item.amount)}</strong><span class="deduction-actions"><button type="button" title="แก้ไข" data-edit-deduction="${esc(item.id)}">✎</button><button type="button" title="ลบ" data-delete-deduction="${esc(item.id)}">×</button></span></div>`).join('') : '<div class="no-deductions">ยังไม่มีรายการหักประจำ</div>';
    const ratio = net > 0 ? Math.min(100, spent / net * 100) : spent > 0 ? 100 : 0;
    $('incomeBar').style.width = `${100 - ratio}%`; $('expenseBar').style.width = `${ratio}%`; $('expensePercent').textContent = `${Math.round(ratio)}%`;
    $('breakdownNote').textContent = net > 0 ? (balance >= 0 ? `เหลือ ${amount(balance)} หลังหักรายจ่าย` : `รายจ่ายเกินรายรับสุทธิ ${amount(Math.abs(balance))}`) : net < 0 ? `รายการหักสูงกว่ารายรับ ${amount(Math.abs(net))}` : 'เพิ่มรายรับประจำเพื่อเริ่มต้น';
    $('dashGross').textContent = amount(gross); $('dashDeductions').textContent = amount(deductions); $('dashNet').textContent = amount(net); $('dashBalance').textContent = amount(balance);
    $('chartMonth').textContent = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
    $('chartSubtitle').textContent = `${expenses.length} รายการ · แท่งแสดงรายจ่ายรายวัน เส้นแสดงเงินคงเหลือปลายวัน`;
    $('chartTotal').textContent = `รายจ่ายรวม ${amount(spent)}`;
    renderCharts(expenses, year, month, daysInMonth, net);
  }
  function renderCharts(expenses, year, month, daysInMonth, netIncome) {
    const totals = new Map();
    for (const item of expenses) totals.set(item.category, (totals.get(item.category) || 0) + positive(item.amount));
    const categories = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
    const total = [...totals.values()].reduce((a, b) => a + b, 0);
    const colors = new Map(categories.map((name, index) => [name, categoryColors[index % categoryColors.length]]));
    $('chartLegend').innerHTML = categories.length ? categories.map((name) => `<span class="chart-legend-item"><i style="--category-color:${colors.get(name)}"></i>${esc(name)} <strong>${total ? Math.round(totals.get(name) / total * 100) : 0}%</strong></span>`).join('') : '<span class="chart-no-data">ยังไม่มีรายจ่ายในเดือนนี้</span>';
    $('categoryBreakdown').innerHTML = categories.length ? categories.map((name) => {
      const percent = total ? totals.get(name) / total * 100 : 0;
      return `<div class="category-row"><span class="category-color" style="--category-color:${colors.get(name)}"></span><span class="category-row-name">${esc(name)}</span><span class="category-track"><i style="width:${percent}%;--category-color:${colors.get(name)}"></i></span><strong>${Math.round(percent)}%</strong><span class="category-total">${amount(totals.get(name))}</span></div>`;
    }).join('') : '<div class="category-empty">บันทึกรายจ่ายเพื่อดูสัดส่วนแต่ละหมวดหมู่</div>';

    const daily = Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1, expenses: [], total: 0, balance: netIncome }));
    for (const item of expenses) {
      const day = Number(item.date.slice(8, 10));
      if (day >= 1 && day <= daysInMonth) {
        daily[day - 1].expenses.push(item);
        daily[day - 1].total += positive(item.amount);
      }
    }
    let spentToDate = 0;
    for (const point of daily) { spentToDate += point.total; point.balance = netIncome - spentToDate; }
    const width = 900, height = 320, left = 64, right = 24, top = 20, bottom = 42;
    const plotW = width - left - right, plotH = height - top - bottom, step = plotW / daysInMonth;
    const maxExpense = Math.max(0, ...daily.map((d) => d.total));
    const balanceValues = daily.map((d) => d.balance);
    const domainMin = Math.min(0, ...balanceValues);
    const domainMax = Math.max(1, maxExpense, ...balanceValues);
    const y = (value) => top + (domainMax - value) / (domainMax - domainMin || 1) * plotH;
    const zeroY = y(0), barWidth = Math.max(3, step * 0.62);
    const grid = Array.from({ length: 5 }, (_, i) => {
      const value = domainMin + (domainMax - domainMin) * i / 4;
      const yy = y(value);
      return `<g><line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" class="chart-grid-line"/><text x="${left - 8}" y="${yy + 3}" text-anchor="end" class="chart-axis-label">${Math.round(value).toLocaleString('th-TH')}</text></g>`;
    }).join('');
    const bars = daily.map((point) => {
      let offset = 0;
      const rects = categories.map((name) => {
        const value = point.expenses.filter((x) => x.category === name).reduce((sum, x) => sum + positive(x.amount), 0);
        if (!value) return '';
        const rectY = y(offset + value), rectH = Math.max(0.75, y(offset) - rectY);
        offset += value;
        return `<rect x="${(left + (point.day - 1) * step + (step - barWidth) / 2).toFixed(1)}" y="${rectY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${rectH.toFixed(1)}" rx="2" fill="${colors.get(name)}"><title>${point.day} · ${esc(name)} · ${amount(value)}</title></rect>`;
      }).join('');
      return rects;
    }).join('');
    const linePoints = daily.map((point) => `${(left + (point.day - .5) * step).toFixed(1)},${y(point.balance).toFixed(1)}`).join(' ');
    const markers = daily.map((point) => `<circle cx="${(left + (point.day - .5) * step).toFixed(1)}" cy="${y(point.balance).toFixed(1)}" r="2.1" class="balance-marker"><title>${point.day} · คงเหลือ ${amount(point.balance)}</title></circle>`).join('');
    const ticks = daily.filter((point) => point.day === 1 || point.day % 5 === 0 || point.day === daysInMonth).map((point) => `<text x="${(left + (point.day - .5) * step).toFixed(1)}" y="${height - 14}" text-anchor="middle" class="chart-axis-label">${point.day}</text>`).join('');
    $('monthlyChart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="กราฟรายจ่ายรายวันแยกสีตามหมวดหมู่ และเส้นเงินคงเหลือปลายวัน"><text x="${left}" y="${height - 1}" class="chart-axis-caption">วันที่ของเดือน</text>${grid}<line x1="${left}" y1="${zeroY}" x2="${width - right}" y2="${zeroY}" class="chart-zero-line"/>${bars}<polyline points="${linePoints}" class="balance-line"/>${markers}${ticks}</svg>`;
  }
  function openExpense(item) {
    $('expenseForm').reset(); $('expenseId').value = item?.id || ''; $('expenseTitle').value = item?.title || '';
    $('expenseAmount').value = item?.amount ?? ''; $('expenseCategory').value = item?.category || 'อาหาร';
    $('expenseDate').value = item?.date || localDate(today); $('expenseNote').value = item?.note || '';
    $('expenseDialogTitle').textContent = item ? 'แก้ไขรายจ่าย' : 'เพิ่มรายจ่าย'; $('expenseDialog').showModal(); $('expenseTitle').focus();
  }
  function openDeduction(item) {
    $('deductionForm').reset(); $('deductionId').value = item?.id || ''; $('deductionNameInput').value = item?.name || '';
    $('deductionAmountInput').value = item?.amount ?? ''; $('deductionDialogTitle').textContent = item ? 'แก้ไขรายการหัก' : 'เพิ่มรายการหัก';
    $('deductionDialog').showModal(); $('deductionNameInput').focus();
  }
  async function downloadData() {
    const json = JSON.stringify(state, null, 2);
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'personal-finance-on-dashboard.json',
          types: [{ description: 'ไฟล์ข้อมูล JSON', accept: { 'application/json': ['.json'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        toast(`บันทึกไฟล์ไว้ที่ ${handle.name} แล้ว`);
      } catch (error) {
        if (error?.name !== 'AbortError') toast('บันทึกไฟล์ JSON ไม่สำเร็จ');
      }
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'personal-finance-on-dashboard.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('ส่งออกข้อมูล JSON แล้ว · เลือกตำแหน่งได้จากหน้าต่างดาวน์โหลดของเบราว์เซอร์');
  }
  async function importData(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || parsed.version !== 1 || !parsed.income || !Array.isArray(parsed.deductions) || !Array.isArray(parsed.expenses) || parsed.expenses.some((item) => !validExpense(item))) {
        throw new Error('ไฟล์ไม่ตรงกับรูปแบบข้อมูลของ Personal Finance on Dashboard');
      }
      const response = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'นำเข้าข้อมูลไม่สำเร็จ');
      state = result.data; render();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* Optional recovery cache. */ }
      setStatus('นำเข้าข้อมูลลง data/finance.json แล้ว', 'saved'); toast('นำเข้าข้อมูลและบันทึกลง data/finance.json แล้ว');
    } catch (error) { toast(error.message || 'อ่านไฟล์ JSON ไม่สำเร็จ'); }
    $('importFile').value = '';
  }

  document.querySelectorAll('[data-view]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); switchView(link.dataset.view); }));
  $('databaseToggle').addEventListener('click', () => {
    const open = $('databaseGroup').classList.toggle('open');
    $('databaseToggle').setAttribute('aria-expanded', String(open));
  });
  $('exportData').addEventListener('click', downloadData);
  $('importData').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (event) => { if (event.target.files[0]) importData(event.target.files[0]); });
  $('addExpense').addEventListener('click', () => openExpense()); $('addExpenseSecondary').addEventListener('click', () => openExpense()); $('emptyAdd').addEventListener('click', () => openExpense());
  $('editIncome').addEventListener('click', () => { $('incomeNameInput').value = state.income.name; $('incomeAmountInput').value = state.income.amount || ''; $('incomeDialog').showModal(); });
  $('addDeduction').addEventListener('click', () => openDeduction()); monthInput.addEventListener('change', render);
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
  $('expenseForm').addEventListener('submit', (event) => {
    event.preventDefault(); if (!$('expenseForm').reportValidity()) return;
    const id = $('expenseId').value || crypto.randomUUID();
    const entry = { id, title: $('expenseTitle').value.trim() || 'ไม่มีชื่อรายการ', amount: $('expenseAmount').value, category: $('expenseCategory').value, date: $('expenseDate').value, note: $('expenseNote').value.trim() };
    const index = state.expenses.findIndex((item) => item.id === id);
    if (index >= 0) state.expenses[index] = entry; else state.expenses.push(entry);
    persist(); render(); $('expenseDialog').close(); toast(index >= 0 ? 'แก้ไขรายจ่ายแล้ว' : 'เพิ่มรายจ่ายแล้ว');
  });
  $('incomeForm').addEventListener('submit', (event) => {
    event.preventDefault(); if (!$('incomeForm').reportValidity()) return;
    state.income = { name: $('incomeNameInput').value.trim() || 'เงินเดือน', amount: positive($('incomeAmountInput').value) };
    persist(); render(); $('incomeDialog').close(); toast('บันทึกรายรับประจำแล้ว');
  });
  $('deductionForm').addEventListener('submit', (event) => {
    event.preventDefault(); if (!$('deductionForm').reportValidity()) return;
    const id = $('deductionId').value || crypto.randomUUID();
    const entry = { id, name: $('deductionNameInput').value.trim() || 'รายการหัก', amount: positive($('deductionAmountInput').value) };
    const index = state.deductions.findIndex((item) => item.id === id);
    if (index >= 0) state.deductions[index] = entry; else state.deductions.push(entry);
    persist(); render(); $('deductionDialog').close(); toast(index >= 0 ? 'แก้ไขรายการหักแล้ว' : 'เพิ่มรายการหักแล้ว');
  });
  $('expenseRows').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-expense]'), remove = event.target.closest('[data-delete-expense]');
    if (edit) openExpense(state.expenses.find((item) => item.id === edit.dataset.editExpense));
    if (remove) { const item = state.expenses.find((x) => x.id === remove.dataset.deleteExpense); if (item && confirm(`ลบรายการ “${item.title}” หรือไม่?`)) { state.expenses = state.expenses.filter((x) => x.id !== item.id); persist(); render(); toast('ลบรายจ่ายแล้ว'); } }
  });
  $('deductionList').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-deduction]'), remove = event.target.closest('[data-delete-deduction]');
    if (edit) openDeduction(state.deductions.find((item) => item.id === edit.dataset.editDeduction));
    if (remove) { const item = state.deductions.find((x) => x.id === remove.dataset.deleteDeduction); if (item && confirm(`ลบรายการหัก “${item.name}” หรือไม่?`)) { state.deductions = state.deductions.filter((x) => x.id !== item.id); persist(); render(); toast('ลบรายการหักแล้ว'); } }
  });
  render();
  loadData();
})();
