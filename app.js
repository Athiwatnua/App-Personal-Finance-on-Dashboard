(() => {
  const CACHE_KEY = 'pfd-cache-v1';
  const today = new Date();
  const $ = (id) => document.getElementById(id);
  const freshState = () => ({ version: 1, income: { name: 'เงินเดือน', amount: 0 }, incomeHistory: [], deductions: [], expenses: [] });
  const positive = (value) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
  const moneyNumber = (value) => { const n = Number(String(value ?? '').trim().replace(',', '.')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
  const validExpense = (x) => x && typeof x.id === 'string' && typeof x.title === 'string' && positive(x.amount) > 0 && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date);
  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const escAttr = (value) => esc(value).replace(/\n/g, '&#10;');
  const currency = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const amount = (value) => currency.format(value);
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dateLabel = (date) => { const [y, m, d] = date.split('-').map(Number); return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d)); };
  const categoryColors = ['#4f9b72', '#7a83c4', '#e19961', '#d57575', '#4b9ca0', '#ae81b9', '#86a94f', '#d087ac', '#87949b', '#b3985d'];
  const medicalKit = '<svg class="medical-kit-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6V4.7A1.7 1.7 0 0 1 9.7 3h4.6A1.7 1.7 0 0 1 16 4.7V6" fill="none" stroke="#c83232" stroke-width="1.7"/><rect x="3.5" y="6" width="17" height="15" rx="3" fill="#e84b4b"/><path d="M10.7 9h2.6v3.1h3.2v2.7h-3.2V18h-2.6v-3.2H7.5v-2.7h3.2z" fill="#fff"/></svg>';
  const icons = { 'ค่าอาหาร': '🍜', 'อาหาร': '🍜', 'ค่าเดินทาง': '🚆', 'เดินทาง': '🚆', 'ค่าที่พัก': '🏢', 'ที่พัก': '🏢', 'ค่าช้อปปิ้ง': '🛍️', 'ช้อปปิ้ง': '🛍️', 'ค่ารักษา': medicalKit, 'สุขภาพ': medicalKit, 'ค่าสาธารณูปโภค (ของใช้ประจำวัน)': '▤', 'สาธารณูปโภค (ของใช้ประจำวัน)': '▤', 'บิลและสาธารณูปโภค': '▤', 'บันเทิง': '·', 'การศึกษา': '▣', 'ค่าใช้จ่ายอื่นๆ': '·', 'อื่นๆ': '·' };
  const categoryLabel = (name) => ({ 'อาหาร': 'ค่าอาหาร', 'เดินทาง': 'ค่าเดินทาง', 'ที่พัก': 'ค่าที่พัก', 'ช้อปปิ้ง': 'ค่าช้อปปิ้ง', 'สุขภาพ': 'ค่ารักษา', 'บิลและสาธารณูปโภค': 'ค่าสาธารณูปโภค (ของใช้ประจำวัน)', 'สาธารณูปโภค (ของใช้ประจำวัน)': 'ค่าสาธารณูปโภค (ของใช้ประจำวัน)', 'บันเทิง': 'ค่าใช้จ่ายอื่นๆ', 'การศึกษา': 'ค่าใช้จ่ายอื่นๆ', 'อื่นๆ': 'ค่าใช้จ่ายอื่นๆ' }[name] || name);
  let state = freshState();
  let profiles = [];
  let chartZoom = 1;
  let chartDrag = null;
  let moneyPadTargetId = '';
  let moneyPadValue = '';
  let calendarTargetId = '';
  let calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let calendarMode = 'date';
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
  function renderProfiles() {
    const select = $('profileSelect');
    select.innerHTML = profiles.map((profile) => `<option value="${esc(profile.id)}">${esc(profile.name)}</option>`).join('');
    select.value = state.profile?.id || '';
  }
  function profileStatus(action, stateName) {
    setStatus(`${action} · ${state.profile?.name || 'My Profile'}`, stateName);
  }
  function incomeForMonth(selectedMonth) {
    let income = state.income;
    for (const entry of state.incomeHistory || []) {
      if (entry.month > selectedMonth) break;
      income = entry;
    }
    return income;
  }
  function deductionForMonth(item, selectedMonth) {
    let amount = positive(item.amount);
    for (const entry of item.history || []) {
      if (entry.month > selectedMonth) break;
      amount = positive(entry.amount);
    }
    return amount;
  }
  function deductionIsConfiguredForMonth(item, selectedMonth) {
    return positive(item.amount) > 0 || (item.history || []).some((entry) => entry.month <= selectedMonth);
  }
  function persist() {
    const snapshot = JSON.stringify(state, null, 2);
    try { localStorage.setItem(CACHE_KEY, snapshot); } catch { /* JSON file remains the source of truth. */ }
    profileStatus('กำลังบันทึก', 'saving');
    saveQueue = saveQueue.then(async () => {
      const response = await fetch('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: snapshot });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'บันทึกข้อมูลไม่สำเร็จ');
      profileStatus('บันทึกข้อมูลแล้ว', 'saved');
    }).catch((error) => { profileStatus('บันทึกไม่สำเร็จ · ตรวจสอบเซิร์ฟเวอร์', 'error'); toast(error.message); });
    return saveQueue;
  }
  async function loadData() {
    try {
      setStatus(`กำลังอ่าน ${state.profile?.name || 'โปรไฟล์'}…`, 'loading');
      const profileResponse = await fetch('/api/profiles', { cache: 'no-store' });
      const profileResult = await profileResponse.json();
      if (!profileResponse.ok) throw new Error(profileResult.error || 'อ่านรายชื่อโปรไฟล์ไม่สำเร็จ');
      profiles = profileResult.profiles;
      const response = await fetch('/api/data', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'อ่านไฟล์ข้อมูลไม่สำเร็จ');
      state = result;
      if (!Array.isArray(state.incomeHistory)) state.incomeHistory = [];
      renderProfiles();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* Optional local recovery cache. */ }
      render(); profileStatus('พร้อมใช้งาน', 'saved');
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
    $('overview').classList.toggle('dashboard-active', isDashboard);
    $('recordSummary').hidden = isDashboard;
    $('recordView').hidden = isDashboard;
    $('dashboardView').hidden = !isDashboard;
    $('chartControls').hidden = !isDashboard;
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
    const monthlyIncome = incomeForMonth(selectedMonth);
    const gross = positive(monthlyIncome.amount);
    const deductions = state.deductions.reduce((sum, item) => sum + deductionForMonth(item, selectedMonth), 0);
    const net = gross - deductions;
    const spent = expenses.reduce((sum, item) => sum + positive(item.amount), 0);
    const balance = net - spent;

    $('grossTotal').textContent = amount(gross); $('deductionTotal').textContent = amount(deductions); $('netTotal').textContent = amount(net); $('balanceTotal').textContent = amount(balance);
    $('incomeName').textContent = monthlyIncome.name || 'เงินเดือน'; $('incomeAmount').textContent = amount(gross);
    $('expensesTotal').textContent = amount(spent); $('breakdownIncome').textContent = amount(net); $('breakdownExpenses').textContent = amount(spent);
    $('expenseCount').textContent = `${expenses.length} รายการในเดือนนี้`; $('tableFooter').textContent = `แสดง ${expenses.length} รายการ`;
    $('emptyState').classList.toggle('visible', expenses.length === 0);
    $('expenseRows').innerHTML = expenses.map((item) => `<tr class="expense-row"><td><div class="expense-name"><span class="category-icon">${icons[categoryLabel(item.category)] || icons[item.category] || '·'}</span><span>${esc(categoryLabel(item.category || item.title || 'อื่นๆ'))}${item.note ? `<small class="row-note">${esc(item.note)}</small>` : ''}</span></div></td><td><span class="date-label">${dateLabel(item.date)}</span></td><td class="amount">${amount(item.amount)}</td><td><div class="row-actions"><button type="button" aria-label="แก้ไข ${esc(categoryLabel(item.category || 'รายการ'))}" data-edit-expense="${esc(item.id)}">✎</button><button type="button" aria-label="ลบ ${esc(categoryLabel(item.category || 'รายการ'))}" data-delete-expense="${esc(item.id)}">×</button></div></td></tr>`).join('');
    const activeDeductions = state.deductions.filter((item) => deductionIsConfiguredForMonth(item, selectedMonth));
    $('deductionList').innerHTML = activeDeductions.length ? activeDeductions.map((item) => `<div class="deduction-item" draggable="true" data-deduction-row="${esc(item.id)}" title="กดค้างแล้วลากเพื่อจัดลำดับ"><span class="deduction-drag-handle" aria-hidden="true">⠿</span><i class="deduction-bullet"></i><span class="deduction-name">${esc(item.name)}</span><strong class="deduction-amount">−${amount(deductionForMonth(item, selectedMonth))}</strong><span class="deduction-actions"><button type="button" title="แก้ไข" data-edit-deduction="${esc(item.id)}">✎</button><button type="button" title="ลบ" data-delete-deduction="${esc(item.id)}">×</button></span></div>`).join('') : '<div class="no-deductions">ยังไม่มีรายการหักประจำ</div>';
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
    for (const item of expenses) { const category = categoryLabel(item.category); totals.set(category, (totals.get(category) || 0) + positive(item.amount)); }
    const categories = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
    const total = [...totals.values()].reduce((a, b) => a + b, 0);
    const colors = new Map(categories.map((name, index) => [name, categoryColors[index % categoryColors.length]]));
    $('chartLegend').innerHTML = categories.length ? categories.map((name) => `<span class="chart-legend-item"><i style="--category-color:${colors.get(name)}"></i>${esc(categoryLabel(name))} <strong>${total ? Math.round(totals.get(name) / total * 100) : 0}%</strong></span>`).join('') : '<span class="chart-no-data">ยังไม่มีรายจ่ายในเดือนนี้</span>';
    $('categoryBreakdown').innerHTML = categories.length ? categories.map((name) => {
      const percent = total ? totals.get(name) / total * 100 : 0;
      return `<div class="category-row"><span class="category-color" style="--category-color:${colors.get(name)}"></span><span class="category-row-name">${esc(categoryLabel(name))}</span><span class="category-track"><i style="width:${percent}%;--category-color:${colors.get(name)}"></i></span><strong>${Math.round(percent)}%</strong><span class="category-total">${amount(totals.get(name))}</span></div>`;
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
      const date = dateLabel(`${year}-${String(month).padStart(2, '0')}-${String(point.day).padStart(2, '0')}`);
      let offset = 0;
      const rects = categories.map((name) => {
        const value = point.expenses.filter((x) => categoryLabel(x.category) === name).reduce((sum, x) => sum + positive(x.amount), 0);
        if (!value) return '';
        const rectY = y(offset + value), rectH = Math.max(0.75, y(offset) - rectY);
        offset += value;
        const tooltip = `วันที่ ${date}\n${categoryLabel(name)} ${amount(value)}`;
        return `<rect tabindex="0" aria-describedby="chartTooltip" aria-label="${escAttr(tooltip)}" data-tooltip="${escAttr(tooltip)}" class="chart-bar" style="--bar-index:${point.day}" x="${(left + (point.day - 1) * step + (step - barWidth) / 2).toFixed(1)}" y="${rectY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${rectH.toFixed(1)}" rx="2" fill="${colors.get(name)}"/>`;
      }).join('');
      return rects;
    }).join('');
    const linePoints = daily.map((point) => `${(left + (point.day - .5) * step).toFixed(1)},${y(point.balance).toFixed(1)}`).join(' ');
    const range = domainMax - domainMin || 1;
    const stop = (value) => `${Math.max(0, Math.min(100, (domainMax - value) / range * 100)).toFixed(2)}%`;
    const gradient = netIncome > 0
      ? `<linearGradient id="balanceGradient" gradientUnits="userSpaceOnUse" x1="${left}" y1="${y(domainMax)}" x2="${left}" y2="${y(domainMin)}"><stop offset="${stop(netIncome)}" stop-color="#3e9b68"/><stop offset="${stop(netIncome / 2)}" stop-color="#e5b940"/><stop offset="${stop(0)}" stop-color="#d85e58"/></linearGradient>`
      : '<linearGradient id="balanceGradient"><stop offset="0%" stop-color="#d85e58"/><stop offset="100%" stop-color="#d85e58"/></linearGradient>';
    const markers = daily.map((point) => {
      const date = dateLabel(`${year}-${String(month).padStart(2, '0')}-${String(point.day).padStart(2, '0')}`);
      const tooltip = `วันที่ ${date}\nยอดเงินคงเหลือ ${amount(point.balance)}`;
      return `<circle tabindex="0" aria-describedby="chartTooltip" aria-label="${escAttr(tooltip)}" data-tooltip="${escAttr(tooltip)}" cx="${(left + (point.day - .5) * step).toFixed(1)}" cy="${y(point.balance).toFixed(1)}" r="4.5" class="balance-marker"/>`;
    }).join('');
    const ticks = daily.map((point) => `<text x="${(left + (point.day - .5) * step).toFixed(1)}" y="${height - 14}" text-anchor="middle" class="chart-axis-label${point.day % 7 === 0 ? ' chart-axis-label-major' : ''}">${point.day}</text>`).join('');
    $('monthlyChart').innerHTML = `<svg style="width:${(chartZoom * 100).toFixed(0)}%;min-width:${Math.max(320, 620 * chartZoom).toFixed(0)}px" viewBox="0 0 ${width} ${height}" role="group" aria-label="กราฟแท่งรายจ่ายรายวันและกราฟเส้นเงินคงเหลือ ใช้ Tab เพื่อดูรายละเอียดแต่ละจุด"><defs>${gradient}</defs><text x="${left}" y="${height - 1}" class="chart-axis-caption">วันที่ของเดือน</text>${grid}<line x1="${left}" y1="${zeroY}" x2="${width - right}" y2="${zeroY}" class="chart-zero-line"/>${bars}<polyline points="${linePoints}" pathLength="1" class="balance-line"/>${markers}${ticks}</svg>`;
  }
  function updateZoomButtons() {
    $('zoomIn').disabled = chartZoom >= 2;
    $('zoomOut').disabled = chartZoom <= 1;
  }
  function showChartTooltip(target, x, y) {
    const tooltip = $('chartTooltip');
    tooltip.textContent = target.dataset.tooltip;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(y + 14, window.innerHeight - tooltip.offsetHeight - 8))}px`;
  }
  function openMoneyPad(targetId) {
    moneyPadTargetId = targetId;
    moneyPadValue = $(targetId).value.trim().replace(',', '.');
    $('moneyPadDisplay').textContent = moneyPadValue || '0';
    const dialog = $('moneyPadDialog');
    if (!dialog.open) dialog.showModal();
  }
  function renderMoneyPad() { $('moneyPadDisplay').textContent = moneyPadValue || '0'; }
  function openDatePicker(targetId) {
    calendarTargetId = targetId;
    calendarMode = targetId === 'monthFilter' ? 'month' : 'date';
    const selected = $(targetId).value;
    const [year, month] = selected ? selected.split('-').map(Number) : [today.getFullYear(), today.getMonth() + 1];
    calendarMonth = new Date(year, month - 1, 1);
    renderDatePicker();
    $('calendarDialog').showModal();
  }
  function renderDatePicker() {
    const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
    $('calendarDialog').dataset.mode = calendarMode;
    $('calendarTitle').textContent = calendarMode === 'month' ? 'เลือกเดือน' : 'เลือกวันที่';
    $('calendarMonthLabel').textContent = new Intl.DateTimeFormat('th-TH', calendarMode === 'month' ? { year: 'numeric' } : { month: 'long', year: 'numeric' }).format(calendarMonth);
    if (calendarMode === 'month') {
      const current = $(calendarTargetId).value;
      $('calendarGrid').classList.add('month-mode');
      $('calendarGrid').innerHTML = Array.from({ length: 12 }, (_, index) => {
        const value = `${year}-${String(index + 1).padStart(2, '0')}`;
        const label = new Intl.DateTimeFormat('th-TH', { month: 'short' }).format(new Date(year, index, 1));
        return `<button type="button" class="calendar-month${value === current ? ' selected' : ''}" data-calendar-month="${value}" aria-pressed="${value === current}">${label}</button>`;
      }).join('');
      return;
    }
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const selectedDate = $(calendarTargetId)?.value || '';
    const weekdays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((day) => `<span class="calendar-weekday">${day}</span>`).join('');
    const blanks = Array.from({ length: firstDay }, () => '<span class="calendar-day-empty" aria-hidden="true"></span>').join('');
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1, value = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const selected = value === selectedDate, todayClass = value === localDate(today);
      return `<button type="button" class="calendar-day${selected ? ' selected' : ''}${todayClass ? ' today' : ''}" data-calendar-day="${value}" aria-pressed="${selected}">${day}</button>`;
    }).join('');
    $('calendarGrid').innerHTML = weekdays + blanks + days;
    $('calendarGrid').classList.remove('month-mode');
  }
  function openExpense(item) {
    $('expenseForm').reset(); $('expenseId').value = item?.id || '';
    $('expenseAmount').value = item?.amount ?? ''; $('expenseCategory').value = categoryLabel(item?.category || 'อาหาร');
    $('expenseDate').value = item?.date || localDate(today); $('expenseNote').value = item?.note || '';
    $('expenseDialogTitle').textContent = item ? 'แก้ไขรายจ่าย' : 'เพิ่มรายจ่าย'; $('expenseDialog').showModal(); $('expenseCategory').focus();
  }
  function openDeduction(item) {
    $('deductionForm').reset(); $('deductionId').value = item?.id || ''; $('deductionNameInput').value = item?.name || '';
    $('deductionAmountInput').value = item ? deductionForMonth(item, monthInput.value) : ''; $('deductionEffectiveMonth').value = monthInput.value;
    $('deductionDialogTitle').textContent = item ? 'แก้ไขรายการหัก' : 'เพิ่มรายการหัก';
    $('deductionDialog').showModal(); $('deductionNameInput').focus();
  }
  async function downloadData() {
    try {
      await saveQueue;
      const response = await fetch('/api/data', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'อ่านข้อมูลจากไฟล์ไม่สำเร็จ');
      state = result;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* Optional local recovery cache. */ }
      render();
    } catch (error) {
      toast(error.message || 'อ่านข้อมูลจาก data/finance.json ไม่สำเร็จ');
      return;
    }
    const profileName = state.profile?.name || 'My Profile';
    const safeName = profileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().replace(/\s+/g, '-');
    const fileName = `personal-finance-${safeName}-${localDate(new Date())}.json`;
    const exportData = { version: 1, profile: { name: profileName }, exportedAt: new Date().toISOString(), income: state.income, incomeHistory: state.incomeHistory || [], deductions: state.deductions, expenses: state.expenses };
    const json = `${JSON.stringify(exportData, null, 2)}\n`;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
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
    link.href = url; link.download = fileName; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`ส่งออก ${profileName} แล้ว`);
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
      state = result.data; profiles = result.profiles || profiles; renderProfiles(); render();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* Optional recovery cache. */ }
      profileStatus('นำเข้าข้อมูลแล้ว', 'saved'); toast(`นำเข้าข้อมูลเป็นโปรไฟล์ ${state.profile?.name || ''} แล้ว`);
    } catch (error) { toast(error.message || 'อ่านไฟล์ JSON ไม่สำเร็จ'); }
    $('importFile').value = '';
  }

  document.querySelectorAll('[data-view]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); switchView(link.dataset.view); }));
  $('databaseToggle').addEventListener('click', () => {
    const open = $('databaseGroup').classList.toggle('open');
    $('databaseToggle').setAttribute('aria-expanded', String(open));
    $('databaseToggle').querySelector('.database-chevron').textContent = open ? '⌃' : '⌄';
  });
  $('exportData').addEventListener('click', downloadData);
  $('importData').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (event) => { if (event.target.files[0]) importData(event.target.files[0]); });
  $('profileSelect').addEventListener('change', async (event) => {
    await saveQueue;
    const response = await fetch('/api/profiles/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: event.target.value }) });
    if (!response.ok) { toast('เปลี่ยนโปรไฟล์ไม่สำเร็จ'); renderProfiles(); return; }
    await loadData();
  });
  $('renameProfile').addEventListener('click', () => { $('profileNameInput').value = state.profile?.name || ''; $('profileDialog').showModal(); $('profileNameInput').focus(); });
  $('profileForm').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!$('profileForm').reportValidity()) return;
    const response = await fetch(`/api/profiles/${encodeURIComponent(state.profile.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('profileNameInput').value.trim() }) });
    const result = await response.json();
    if (!response.ok) { toast(result.error || 'เปลี่ยนชื่อโปรไฟล์ไม่สำเร็จ'); return; }
    state.profile.name = result.name; profiles = profiles.map((profile) => profile.id === result.id ? result : profile); renderProfiles(); profileStatus('พร้อมใช้งาน', 'saved'); $('profileDialog').close(); toast('เปลี่ยนชื่อโปรไฟล์แล้ว');
  });
  $('themeToggle').addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark-theme');
    localStorage.setItem('pfd-theme', dark ? 'dark' : 'light');
    $('themeToggle').innerHTML = dark ? '☀ <span>Light</span>' : '☾ <span>Dark</span>';
    $('themeToggle').setAttribute('aria-label', dark ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด');
  });
  if (localStorage.getItem('pfd-theme') === 'dark') { document.documentElement.classList.add('dark-theme'); $('themeToggle').innerHTML = '☀ <span>Light</span>'; $('themeToggle').setAttribute('aria-label', 'เปลี่ยนเป็นธีมสว่าง'); }
  $('addExpense').addEventListener('click', () => openExpense()); $('addExpenseSecondary').addEventListener('click', () => openExpense()); $('emptyAdd').addEventListener('click', () => openExpense());
  $('editIncome').addEventListener('click', () => {
    const effective = incomeForMonth(monthInput.value);
    $('incomeNameInput').value = effective.name || 'เงินเดือน';
    $('incomeAmountInput').value = effective.amount ?? '';
    $('incomeEffectiveMonth').value = monthInput.value;
    $('incomeDialog').showModal();
  });
  $('addDeduction').addEventListener('click', () => openDeduction()); monthInput.addEventListener('change', render);
  $('zoomIn').addEventListener('click', () => { chartZoom = Math.min(2, +(chartZoom + .5).toFixed(2)); updateZoomButtons(); render(); });
  $('zoomOut').addEventListener('click', () => { chartZoom = Math.max(1, +(chartZoom - .5).toFixed(2)); updateZoomButtons(); render(); });
  updateZoomButtons();
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-money-target]');
    if (button) {
      event.preventDefault();
      openMoneyPad(button.dataset.moneyTarget);
      return;
    }
    const calendarButton = event.target.closest('[data-calendar-target]');
    if (calendarButton) {
      event.preventDefault();
      openDatePicker(calendarButton.dataset.calendarTarget);
    }
  }, true);
  $('moneyPadGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-money-key]');
    if (!button) return;
    const key = button.dataset.moneyKey;
    if (key === 'clear') moneyPadValue = '';
    else if (key === 'backspace') moneyPadValue = moneyPadValue.slice(0, -1);
    else if (key === '.') { if (!moneyPadValue.includes('.')) moneyPadValue = `${moneyPadValue || '0'}.`; }
    else if (/^\d$/.test(key)) {
      const decimal = moneyPadValue.split('.')[1];
      if ((!moneyPadValue.includes('.') && moneyPadValue.length < 12) || (moneyPadValue.includes('.') && decimal.length < 2)) moneyPadValue += key;
    }
    renderMoneyPad();
  });
  $('moneyPadForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const target = $(moneyPadTargetId);
    if (target) { target.value = moneyPadValue; target.dispatchEvent(new Event('input', { bubbles: true })); }
    $('moneyPadDialog').close(); target?.focus();
  });
  $('monthlyChart').addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    chartDrag = { pointerId: event.pointerId, startX: event.clientX, startScroll: $('monthlyChart').scrollLeft };
    $('monthlyChart').setPointerCapture(event.pointerId);
    $('monthlyChart').classList.add('dragging');
    $('chartTooltip').hidden = true;
  });
  $('monthlyChart').addEventListener('pointerover', (event) => {
    const target = event.target.closest('[data-tooltip]');
    if (target) showChartTooltip(target, event.clientX, event.clientY);
  });
  $('monthlyChart').addEventListener('pointermove', (event) => {
    if (chartDrag) {
      const distance = event.clientX - chartDrag.startX;
      $('monthlyChart').scrollLeft = chartDrag.startScroll - distance;
      $('chartTooltip').hidden = true;
      return;
    }
    if (!$('chartTooltip').hidden) {
      const target = event.target.closest('[data-tooltip]');
      if (target) showChartTooltip(target, event.clientX, event.clientY);
    }
  });
  const endChartDrag = (event) => {
    if (!chartDrag || event.pointerId !== chartDrag.pointerId) return;
    chartDrag = null;
    $('monthlyChart').classList.remove('dragging');
  };
  $('monthlyChart').addEventListener('pointerup', endChartDrag);
  $('monthlyChart').addEventListener('pointercancel', endChartDrag);
  $('monthlyChart').addEventListener('pointerleave', () => { $('chartTooltip').hidden = true; });
  $('monthlyChart').addEventListener('focusin', (event) => {
    const target = event.target.closest('[data-tooltip]');
    if (target) { const rect = target.getBoundingClientRect(); showChartTooltip(target, rect.left + rect.width / 2, rect.top + rect.height / 2); }
  });
  $('monthlyChart').addEventListener('focusout', () => { $('chartTooltip').hidden = true; });
  ['incomeEffectiveMonth', 'deductionEffectiveMonth'].forEach((id) => {
    const picker = $(id);
    picker.addEventListener('click', (event) => {
      const rect = picker.getBoundingClientRect();
      if (event.clientX < rect.right - 42) { try { picker.showPicker?.(); } catch { /* Native picker may already be opening. */ } }
    });
    picker.addEventListener('keydown', (event) => { if ((event.key.length === 1 && !event.ctrlKey && !event.metaKey) || event.key === 'Backspace' || event.key === 'Delete') event.preventDefault(); });
    picker.addEventListener('paste', (event) => event.preventDefault());
  });
  document.querySelectorAll('[data-picker-target]').forEach((button) => button.addEventListener('click', () => {
    const picker = $(button.dataset.pickerTarget);
    try { picker.showPicker?.(); } catch { picker.focus(); }
  }));
  $('expenseDate').addEventListener('click', () => openDatePicker('expenseDate'));
  $('monthFilter').addEventListener('click', () => openDatePicker('monthFilter'));
  $('calendarPrevious').addEventListener('click', () => { if (calendarMode === 'month') calendarMonth.setFullYear(calendarMonth.getFullYear() - 1); else calendarMonth.setMonth(calendarMonth.getMonth() - 1); renderDatePicker(); });
  $('calendarNext').addEventListener('click', () => { if (calendarMode === 'month') calendarMonth.setFullYear(calendarMonth.getFullYear() + 1); else calendarMonth.setMonth(calendarMonth.getMonth() + 1); renderDatePicker(); });
  $('calendarGrid').addEventListener('click', (event) => {
    const day = event.target.closest('[data-calendar-day]');
    const monthOption = event.target.closest('[data-calendar-month]');
    if (monthOption && calendarTargetId) {
      const picker = $(calendarTargetId);
      picker.value = monthOption.dataset.calendarMonth;
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      $('calendarDialog').close();
      return;
    }
    if (!day || !calendarTargetId) return;
    const picker = $(calendarTargetId);
    picker.value = day.dataset.calendarDay;
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    $('calendarDialog').close();
  });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
  $('expenseForm').addEventListener('submit', (event) => {
    event.preventDefault(); if (!$('expenseForm').reportValidity()) return;
    if (moneyNumber($('expenseAmount').value) <= 0) { $('expenseAmount').setCustomValidity('จำนวนเงินต้องมากกว่า 0'); $('expenseAmount').reportValidity(); $('expenseAmount').setCustomValidity(''); return; }
    const id = $('expenseId').value || crypto.randomUUID();
    const category = $('expenseCategory').value;
    const entry = { id, title: category, amount: moneyNumber($('expenseAmount').value), category, date: $('expenseDate').value, note: $('expenseNote').value.trim() };
    const index = state.expenses.findIndex((item) => item.id === id);
    if (index >= 0) state.expenses[index] = entry; else state.expenses.push(entry);
    persist(); render(); $('expenseDialog').close(); toast(index >= 0 ? 'แก้ไขรายจ่ายแล้ว' : 'เพิ่มรายจ่ายแล้ว');
  });
  $('incomeForm').addEventListener('submit', (event) => {
    event.preventDefault(); if (!$('incomeForm').reportValidity()) return;
    const entry = { month: $('incomeEffectiveMonth').value, name: $('incomeNameInput').value.trim() || 'เงินเดือน', amount: moneyNumber($('incomeAmountInput').value) };
    state.incomeHistory = (state.incomeHistory || []).filter((item) => item.month !== entry.month);
    state.incomeHistory.push(entry); state.incomeHistory.sort((a, b) => a.month.localeCompare(b.month));
    persist(); render(); $('incomeDialog').close(); toast('บันทึกรายรับประจำแล้ว');
  });
  $('deductionForm').addEventListener('submit', (event) => {
    event.preventDefault(); if (!$('deductionForm').reportValidity()) return;
    const id = $('deductionId').value || crypto.randomUUID();
    const entry = { id, name: $('deductionNameInput').value.trim() || 'รายการหัก', amount: moneyNumber($('deductionAmountInput').value) };
    const index = state.deductions.findIndex((item) => item.id === id);
    if (index >= 0) {
      const current = state.deductions[index];
      current.name = entry.name;
      current.history = (current.history || []).filter((item) => item.month !== $('deductionEffectiveMonth').value);
      current.history.push({ month: $('deductionEffectiveMonth').value, amount: entry.amount });
      current.history.sort((a, b) => a.month.localeCompare(b.month));
    } else {
      state.deductions.push({ ...entry, amount: 0, history: [{ month: $('deductionEffectiveMonth').value, amount: entry.amount }] });
    }
    persist(); render(); $('deductionDialog').close(); toast(index >= 0 ? 'แก้ไขรายการหักแล้ว' : 'เพิ่มรายการหักแล้ว');
  });
  $('expenseRows').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-expense]'), remove = event.target.closest('[data-delete-expense]');
    if (edit) openExpense(state.expenses.find((item) => item.id === edit.dataset.editExpense));
    if (remove) { const item = state.expenses.find((x) => x.id === remove.dataset.deleteExpense); if (item && confirm(`ลบรายการ “${categoryLabel(item.category || item.title)}” หรือไม่?`)) { state.expenses = state.expenses.filter((x) => x.id !== item.id); persist(); render(); toast('ลบรายจ่ายแล้ว'); } }
  });
  $('deductionList').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-deduction]'), remove = event.target.closest('[data-delete-deduction]');
    if (edit) openDeduction(state.deductions.find((item) => item.id === edit.dataset.editDeduction));
    if (remove) { const item = state.deductions.find((x) => x.id === remove.dataset.deleteDeduction); if (item && confirm(`ลบรายการหัก “${item.name}” หรือไม่?`)) { state.deductions = state.deductions.filter((x) => x.id !== item.id); persist(); render(); toast('ลบรายการหักแล้ว'); } }
  });
  let draggedDeductionId = '';
  let draggedDeductionRow = null;
  $('deductionList').addEventListener('dragstart', (event) => {
    const row = event.target.closest('[data-deduction-row]');
    if (!row || event.target.closest('button')) { event.preventDefault(); return; }
    draggedDeductionId = row.dataset.deductionRow;
    draggedDeductionRow = row;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedDeductionId);
  });
  $('deductionList').addEventListener('dragover', (event) => {
    const target = event.target.closest('[data-deduction-row]');
    if (!target || target.dataset.deductionRow === draggedDeductionId) return;
    event.preventDefault();
    const bounds = target.getBoundingClientRect();
    $('deductionList').insertBefore(draggedDeductionRow, event.clientY < bounds.top + bounds.height / 2 ? target : target.nextSibling);
  });
  $('deductionList').addEventListener('drop', (event) => {
    if (!draggedDeductionId) return;
    event.preventDefault();
    const order = [...$('deductionList').querySelectorAll('[data-deduction-row]')].map((row) => row.dataset.deductionRow);
    const visibleIds = new Set(order);
    const reordered = order.map((id) => state.deductions.find((item) => item.id === id)).filter(Boolean);
    let nextVisible = 0;
    state.deductions = state.deductions.map((item) => visibleIds.has(item.id) ? reordered[nextVisible++] : item);
    persist();
  });
  $('deductionList').addEventListener('dragend', () => {
    $('deductionList').querySelectorAll('.dragging').forEach((row) => row.classList.remove('dragging'));
    draggedDeductionId = '';
    draggedDeductionRow = null;
  });
  render();
  loadData();
})();
