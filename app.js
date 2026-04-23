const STORAGE_KEY = 'dienstplan-generator-state-v1';
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WEEKDAY_KEYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const STATES = [
  ['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'],
  ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'],
  ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'],
  ['SL', 'Saarland'], ['SN', 'Sachsen'], ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen']
];

const defaultState = {
  employees: [],
  absences: [],
  plans: [],
  generation: {
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    federalState: 'BE'
  },
  settings: {
    shifts: {
      early: { start: '09:45', end: '18:15' },
      late: { start: '10:45', end: '19:15' },
      saturday: { start: '09:45', end: '18:15' },
      special: { start: '09:45', end: '14:15' }
    },
    staffing: {
      minLate: 2,
      allowSingleEarlyWhenThreePeople: true
    },
    hours: {
      weekdayPresent: { soll: 8, ist: 8 },
      weekdayAbsent: { soll: 8, ist: 0 },
      saturdayPresent: { soll: 0, ist: 8 },
      saturdayFree: { soll: 0, ist: 8 },
      specialPresent: { soll: 0, ist: 4 },
      specialAbsent: { soll: 0, ist: 0 }
    }
  }
};

let state = loadState();
let deferredPrompt = null;
let currentAbsenceDraft = null;

init();

function init() {
  registerServiceWorker();
  setupInstallPrompt();
  bindNavigation();
  renderAll();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return mergeDeep(structuredClone(defaultState), parsed);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function mergeDeep(target, source) {
  for (const key of Object.keys(source || {})) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      target[key] = mergeDeep(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function setupInstallPrompt() {
  const installBtn = document.getElementById('installBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.remove('hidden');
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add('hidden');
  });
}

function bindNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });
}

function setActiveTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.tab-page').forEach(panel => panel.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
}

function renderAll() {
  renderTeamTab();
  renderAbsenceTab();
  renderGenerateTab();
  renderPlansTab();
  renderSettingsTab();
  saveState();
}

function renderTeamTab() {
  const root = document.getElementById('tab-team');
  const pairedCount = state.employees.filter(e => e.pairId).length;
  const saturdayCount = state.employees.filter(e => e.saturdayRule).length;
  const fixedFreeCount = state.employees.filter(e => e.fixedFreeDay !== '').length;
  root.innerHTML = `
    <div class="card">
      <div class="section-title">
        <div>
          <h2>Team</h2>
          <div class="muted">Mitarbeiter verwalten, Reihenfolge bleibt erhalten</div>
        </div>
        <button class="primary-btn" id="addEmployeeBtn">Mitarbeiter anlegen</button>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="muted">Mitarbeiter</div><div class="stat-value">${state.employees.length}</div></div>
        <div class="stat-card"><div class="muted">Mit Pairing</div><div class="stat-value">${pairedCount}</div></div>
        <div class="stat-card"><div class="muted">Fix frei</div><div class="stat-value">${fixedFreeCount}</div></div>
        <div class="stat-card"><div class="muted">Samstags-Regel</div><div class="stat-value">${saturdayCount}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="section-title">
        <div>
          <h3>Teamliste</h3>
          <div class="muted">Bearbeiten, löschen oder neue Mitarbeiter hinzufügen</div>
        </div>
      </div>
      ${state.employees.length === 0 ? `<div class="empty-state">Noch keine Mitarbeiter vorhanden. Lege zuerst dein Team an.</div>` : ''}
      <div class="stack">
        ${state.employees.map((employee, index) => employeeCard(employee, index)).join('')}
      </div>
    </div>
  `;

  root.querySelector('#addEmployeeBtn')?.addEventListener('click', () => openEmployeeModal());
  root.querySelectorAll('[data-action="edit-employee"]').forEach(btn => btn.addEventListener('click', () => openEmployeeModal(btn.dataset.id)));
  root.querySelectorAll('[data-action="delete-employee"]').forEach(btn => btn.addEventListener('click', () => deleteEmployee(btn.dataset.id)));
}

function employeeCard(employee, index) {
  const pairedWith = employee.pairId ? state.employees.find(e => e.id === employee.pairId)?.name || 'Nicht gefunden' : 'Kein Pairing';
  const fixedFree = employee.fixedFreeDay !== '' ? DAYS[Number(employee.fixedFreeDay)] : 'Kein fixer freier Tag';
  return `
    <div class="card">
      <div class="employee-row">
        <img class="avatar" src="${employee.photo || defaultAvatar(employee.color)}" alt="${escapeHtml(employee.name)}" />
        <div class="employee-meta">
          <h3>${index + 1}. ${escapeHtml(employee.name)}</h3>
          <p>Reihenfolge fix · Farbe und Regeln pro Mitarbeiter</p>
          <div class="badges">
            <span class="badge"><span class="color-dot" style="background:${employee.color}"></span>${employee.color}</span>
            <span class="badge">Fix frei: ${fixedFree}</span>
            <span class="badge">Samstags-Regel: ${employee.saturdayRule ? 'Ja' : 'Nein'}</span>
            <span class="badge">Sondertage: ${(employee.specialDays || []).join(', ') || '—'}</span>
            <span class="badge">Pairing: ${escapeHtml(pairedWith)}</span>
          </div>
        </div>
      </div>
      <div class="right-actions" style="margin-top:12px">
        <button class="secondary-btn" data-action="edit-employee" data-id="${employee.id}">Bearbeiten</button>
        <button class="danger-btn" data-action="delete-employee" data-id="${employee.id}">Löschen</button>
      </div>
    </div>
  `;
}

function openEmployeeModal(id = null) {
  const employee = id ? state.employees.find(e => e.id === id) : null;
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-body">
      <div class="section-title">
        <h3>${employee ? 'Mitarbeiter bearbeiten' : 'Mitarbeiter anlegen'}</h3>
        <button class="small-btn" id="closeModalBtn">Schließen</button>
      </div>
      <form id="employeeForm" class="stack">
        <label>Name<input name="name" required value="${escapeAttr(employee?.name || '')}" /></label>
        <div class="grid-2">
          <label>Farbe<input name="color" type="color" value="${employee?.color || '#4f46e5'}" /></label>
          <label>Profilfoto<input name="photo" type="file" accept="image/*" /></label>
        </div>
        <div class="grid-2">
          <label>Fixer freier Tag
            <select name="fixedFreeDay">
              <option value="">Keiner</option>
              ${DAYS.map((d, i) => `<option value="${i}" ${String(employee?.fixedFreeDay ?? '') === String(i) ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </label>
          <label>Pairing mit
            <select name="pairId">
              <option value="">Kein Pairing</option>
              ${state.employees.filter(e => e.id !== id).map(e => `<option value="${e.id}" ${employee?.pairId === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="grid-2">
          <label>2 Samstage frei / Monat
            <select name="saturdayRule">
              <option value="true" ${employee?.saturdayRule !== false ? 'selected' : ''}>Ja</option>
              <option value="false" ${employee?.saturdayRule === false ? 'selected' : ''}>Nein</option>
            </select>
          </label>
          <label>Freiwillige Sondertage
            <select multiple name="specialDays" size="2">
              <option value="24.12" ${(employee?.specialDays || []).includes('24.12') ? 'selected' : ''}>24.12</option>
              <option value="31.12" ${(employee?.specialDays || []).includes('31.12') ? 'selected' : ''}>31.12</option>
            </select>
          </label>
        </div>
        <div class="notice">Hinweis: Pairing sorgt dafür, dass beide Mitarbeiter möglichst in derselben Schicht eingeplant werden.</div>
        <button class="primary-btn" type="submit">${employee ? 'Speichern' : 'Anlegen'}</button>
      </form>
    </div>
  `;
  modal.showModal();
  modal.querySelector('#closeModalBtn').addEventListener('click', () => modal.close());
  modal.querySelector('#employeeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const photoFile = form.photo.files[0];
    const photo = photoFile ? await fileToDataUrl(photoFile) : employee?.photo || '';
    const selectedSpecialDays = [...form.specialDays.selectedOptions].map(o => o.value);
    const payload = {
      id: employee?.id || uid(),
      name: form.name.value.trim(),
      color: form.color.value,
      photo,
      pairId: form.pairId.value || null,
      fixedFreeDay: form.fixedFreeDay.value === '' ? '' : Number(form.fixedFreeDay.value),
      saturdayRule: form.saturdayRule.value === 'true',
      specialDays: selectedSpecialDays
    };
    if (!payload.name) return;
    if (employee) {
      Object.assign(employee, payload);
      normalizePairing();
    } else {
      state.employees.push(payload);
      normalizePairing();
    }
    renderAll();
    modal.close();
  });
}

function normalizePairing() {
  const ids = new Set(state.employees.map(e => e.id));
  state.employees.forEach(e => {
    if (e.pairId && !ids.has(e.pairId)) e.pairId = null;
  });
  state.employees.forEach(e => {
    if (e.pairId) {
      const other = state.employees.find(x => x.id === e.pairId);
      if (other && other.pairId !== e.id) other.pairId = e.id;
    }
  });
}

function deleteEmployee(id) {
  if (!confirm('Mitarbeiter wirklich löschen?')) return;
  state.employees = state.employees.filter(e => e.id !== id);
  state.absences = state.absences.filter(a => a.employeeId !== id);
  state.employees.forEach(e => { if (e.pairId === id) e.pairId = null; });
  renderAll();
}

function renderAbsenceTab() {
  const root = document.getElementById('tab-urlaub');
  root.innerHTML = `
    <div class="card">
      <div class="section-title">
        <div>
          <h2>Urlaub, Wunschfrei, Krank</h2>
          <div class="muted">Abwesenheiten per Kalender eintragen</div>
        </div>
        <button class="primary-btn" id="addAbsenceBtn" ${state.employees.length === 0 ? 'disabled' : ''}>Abwesenheit eintragen</button>
      </div>
      ${state.absences.length === 0 ? `<div class="notice">Noch keine Abwesenheiten eingetragen.</div>` : ''}
      <div class="stack">
        ${state.absences.map(absenceCard).join('')}
      </div>
    </div>
  `;
  root.querySelector('#addAbsenceBtn')?.addEventListener('click', () => openAbsenceModal());
  root.querySelectorAll('[data-action="delete-absence"]').forEach(btn => btn.addEventListener('click', () => deleteAbsence(btn.dataset.id)));
}

function absenceCard(a) {
  const employee = state.employees.find(e => e.id === a.employeeId);
  const label = { vacation: 'Urlaub', wishfree: 'Wunschfrei', sick: 'Krankmeldung' }[a.type];
  const days = a.dates.length === 1 ? formatDate(a.dates[0]) : `${formatDate(a.dates[0])} – ${formatDate(a.dates[a.dates.length - 1])}`;
  return `
    <div class="card">
      <div class="employee-row">
        <img class="avatar" src="${employee?.photo || defaultAvatar(employee?.color || '#4f46e5')}" alt="${escapeHtml(employee?.name || '')}" />
        <div class="employee-meta">
          <h3>${escapeHtml(employee?.name || 'Unbekannt')}</h3>
          <p>${label} · ${days}</p>
          <div class="badges"><span class="badge">${a.dates.length} Tag(e)</span></div>
        </div>
      </div>
      <div class="right-actions" style="margin-top:12px">
        <button class="danger-btn" data-action="delete-absence" data-id="${a.id}">Löschen</button>
      </div>
    </div>
  `;
}

function openAbsenceModal() {
  currentAbsenceDraft = { month: state.generation.month, year: state.generation.year, selectedDates: [] };
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-body">
      <div class="section-title">
        <h3>Abwesenheit eintragen</h3>
        <button class="small-btn" id="closeModalBtn">Schließen</button>
      </div>
      <form id="absenceForm" class="stack">
        <div class="grid-2">
          <label>Mitarbeiter
            <select name="employeeId" required>
              ${state.employees.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}
            </select>
          </label>
          <label>Typ
            <select name="type">
              <option value="vacation">Urlaub</option>
              <option value="wishfree">Wunschfrei</option>
              <option value="sick">Krankmeldung</option>
            </select>
          </label>
        </div>
        <div class="grid-2">
          <label>Monat<input type="month" name="monthPicker" value="${toMonthInput(currentAbsenceDraft.year, currentAbsenceDraft.month)}" /></label>
          <div class="notice">Urlaub = Zeitraum, Wunschfrei/Krank = Mehrfachauswahl möglich.</div>
        </div>
        <div id="absenceCalendar"></div>
        <div id="absenceSelectionInfo" class="muted"></div>
        <button class="primary-btn" type="submit">Speichern</button>
      </form>
    </div>
  `;
  modal.showModal();
  modal.querySelector('#closeModalBtn').addEventListener('click', () => modal.close());
  renderAbsenceCalendar();
  modal.querySelector('[name="monthPicker"]').addEventListener('change', (e) => {
    const [y, m] = e.target.value.split('-').map(Number);
    currentAbsenceDraft.year = y;
    currentAbsenceDraft.month = m;
    currentAbsenceDraft.selectedDates = [];
    renderAbsenceCalendar();
  });
  modal.querySelector('#absenceForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const type = form.type.value;
    const dates = normalizeAbsenceDates(currentAbsenceDraft.selectedDates, type);
    if (dates.length === 0) {
      alert('Bitte Tage auswählen.');
      return;
    }
    state.absences.push({ id: uid(), employeeId: form.employeeId.value, type, dates });
    renderAll();
    modal.close();
  });
}

function renderAbsenceCalendar() {
  const container = document.getElementById('absenceCalendar');
  if (!container) return;
  const year = currentAbsenceDraft.year;
  const month = currentAbsenceDraft.month;
  const holidays = getHolidayMap(year, state.generation.federalState);
  container.innerHTML = `
    <div class="card">
      <div class="section-title">
        <h3>${monthName(month)} ${year}</h3>
        <div class="muted">Kalenderauswahl</div>
      </div>
      ${renderCalendarGrid(year, month, currentAbsenceDraft.selectedDates, holidays)}
    </div>
  `;
  container.querySelectorAll('.calendar-day[data-date]').forEach(day => {
    day.addEventListener('click', () => {
      const date = day.dataset.date;
      const type = document.querySelector('#absenceForm [name="type"]').value;
      if (type === 'vacation') {
        toggleVacationRange(date);
      } else {
        toggleSingleDate(date);
      }
      renderAbsenceCalendar();
      updateAbsenceSelectionInfo();
    });
  });
  document.querySelector('#absenceForm [name="type"]').onchange = () => {
    currentAbsenceDraft.selectedDates = [];
    renderAbsenceCalendar();
    updateAbsenceSelectionInfo();
  };
  updateAbsenceSelectionInfo();
}

function updateAbsenceSelectionInfo() {
  const info = document.getElementById('absenceSelectionInfo');
  if (!info) return;
  const dates = normalizeAbsenceDates(currentAbsenceDraft.selectedDates, document.querySelector('#absenceForm [name="type"]').value);
  info.textContent = dates.length ? `${dates.length} Tag(e) ausgewählt: ${dates.map(formatDate).join(', ')}` : 'Noch keine Tage ausgewählt.';
}

function toggleSingleDate(date) {
  const idx = currentAbsenceDraft.selectedDates.indexOf(date);
  if (idx >= 0) currentAbsenceDraft.selectedDates.splice(idx, 1);
  else currentAbsenceDraft.selectedDates.push(date);
}

function toggleVacationRange(date) {
  if (currentAbsenceDraft.selectedDates.length >= 2) {
    currentAbsenceDraft.selectedDates = [date];
    return;
  }
  if (currentAbsenceDraft.selectedDates.includes(date)) {
    currentAbsenceDraft.selectedDates = currentAbsenceDraft.selectedDates.filter(d => d !== date);
  } else {
    currentAbsenceDraft.selectedDates.push(date);
    currentAbsenceDraft.selectedDates.sort();
  }
}

function normalizeAbsenceDates(selectedDates, type) {
  if (type !== 'vacation') return [...selectedDates].sort();
  if (selectedDates.length === 0) return [];
  if (selectedDates.length === 1) return [selectedDates[0]];
  const [start, end] = [...selectedDates].sort();
  return dateRange(start, end);
}

function deleteAbsence(id) {
  state.absences = state.absences.filter(a => a.id !== id);
  renderAll();
}

function renderGenerateTab() {
  const root = document.getElementById('tab-generieren');
  const latestPlan = state.plans[0];
  const nextMonthDays = getMonthDays(state.generation.year, state.generation.month).length;
  root.innerHTML = `
    <div class="card">
      <div class="section-title">
        <div>
          <h2>Dienstplan generieren</h2>
          <div class="muted">Bundesland und Monat werden gespeichert</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="muted">Teamgröße</div><div class="stat-value">${state.employees.length}</div></div>
        <div class="stat-card"><div class="muted">Abwesenheiten</div><div class="stat-value">${state.absences.length}</div></div>
        <div class="stat-card"><div class="muted">Tage im Monat</div><div class="stat-value">${nextMonthDays}</div></div>
        <div class="stat-card"><div class="muted">Gespeicherte Pläne</div><div class="stat-value">${state.plans.length}</div></div>
      </div>
      <div class="grid-2" style="margin-top:12px">
        <label>Monat
          <input id="genMonth" type="month" value="${toMonthInput(state.generation.year, state.generation.month)}" />
        </label>
        <label>Bundesland
          <select id="federalState">
            ${STATES.map(([code, name]) => `<option value="${code}" ${state.generation.federalState === code ? 'selected' : ''}>${name}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="legend">
        <span class="badge">F = Früh</span>
        <span class="badge">S = Spät</span>
        <span class="badge">FR = Frei</span>
        <span class="badge">U = Urlaub</span>
        <span class="badge">W = Wunschfrei</span>
        <span class="badge">K = Krank</span>
        <span class="badge">SO = Sondertag</span>
      </div>
      <div class="right-actions" style="margin-top:12px">
        <button class="secondary-btn" id="checkConflictsBtn">Konflikte prüfen</button>
        <button class="primary-btn" id="generatePlanBtn" ${state.employees.length < 3 ? 'disabled' : ''}>Monatsplan erstellen</button>
      </div>
      <div id="conflictOutput" style="margin-top:12px"></div>
    </div>

    ${latestPlan ? renderPlanPreview(latestPlan, true) : `<div class="card"><div class="notice">Noch kein Plan vorhanden.</div></div>`}
  `;
  root.querySelector('#genMonth').addEventListener('change', (e) => {
    const [y, m] = e.target.value.split('-').map(Number);
    state.generation.year = y;
    state.generation.month = m;
    saveState();
    renderAbsenceTab();
    renderGenerateTab();
  });
  root.querySelector('#federalState').addEventListener('change', (e) => {
    state.generation.federalState = e.target.value;
    saveState();
    renderAbsenceTab();
    renderGenerateTab();
    renderSettingsTab();
  });
  root.querySelector('#checkConflictsBtn').addEventListener('click', () => {
    const result = validatePlanInputs(state.generation.year, state.generation.month);
    root.querySelector('#conflictOutput').innerHTML = renderValidation(result);
  });
  root.querySelector('#generatePlanBtn')?.addEventListener('click', () => {
    generatePlanAction();
  });
}

function renderValidation(result) {
  if (result.ok && result.warnings.length === 0) return `<div class="success-box">Keine Konflikte gefunden. Die Planung kann erstellt werden.</div>`;
  return `
    ${result.ok ? '' : `<div class="error-box"><strong>Fehler:</strong><br>${result.errors.map(escapeHtml).join('<br>')}</div>`}
    ${result.warnings.length ? `<div class="warning-box" style="margin-top:10px"><strong>Hinweise:</strong><br>${result.warnings.map(escapeHtml).join('<br>')}</div>` : ''}
  `;
}

function renderPlanPreview(plan, latest = false) {
  const days = plan.days;
  return `
    <div class="card">
      <div class="section-title">
        <div>
          <h3>${latest ? 'Letzter Plan' : escapeHtml(plan.label)}</h3>
          <div class="muted">${escapeHtml(plan.label)} · ${plan.meta.federalState}</div>
        </div>
      </div>
      <div class="plan-table-wrap">${renderPlanTable(plan)}</div>
      <div class="legend"><span class="badge">F = Früh</span><span class="badge">S = Spät</span><span class="badge">FR = Frei</span><span class="badge">U = Urlaub</span><span class="badge">W = Wunschfrei</span><span class="badge">K = Krank</span><span class="badge">SO = Sondertag</span></div>
      <div style="height:14px"></div>
      ${renderSummaryTable(plan)}
    </div>
  `;
}

function renderPlanTable(plan) {
  const holidays = new Set(plan.meta.holidays);
  return `
    <table class="plan-table">
      <thead>
        <tr>
          <th>Mitarbeiter</th>
          ${plan.days.map(day => `<th>
            <div class="plan-header-date">
              <span>${day.day}</span>
              <span>${DAYS[new Date(day.date).getDay() === 0 ? 6 : new Date(day.date).getDay()-1]}</span>
            </div>
          </th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${plan.employees.map(emp => `<tr>
          <td><strong>${escapeHtml(emp.name)}</strong></td>
          ${plan.days.map(day => {
            const key = day.date;
            const code = emp.assignments[key] || '';
            const classes = `${code || 'empty'} ${holidays.has(key) ? 'H' : ''}`;
            const title = describeCode(code, day, plan.meta.settings.shifts);
            return `<td title="${escapeAttr(title)}"><div class="plan-cell ${classes}">${code || '—'}</div></td>`;
          }).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderSummaryTable(plan) {
  return `
    <table class="summary-table">
      <thead><tr><th>Mitarbeiter</th><th>Soll</th><th>Ist</th><th>Mehr / Minus</th></tr></thead>
      <tbody>
        ${plan.summary.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${formatHours(row.soll)}</td><td>${formatHours(row.ist)}</td><td>${formatSignedHours(row.delta)}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderPlansTab() {
  const root = document.getElementById('tab-plaene');
  root.innerHTML = `
    <div class="card">
      <div class="section-title">
        <div>
          <h2>Gespeicherte Pläne</h2>
          <div class="muted">Öffnen, drucken, als CSV exportieren oder löschen</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="muted">Pläne gesamt</div><div class="stat-value">${state.plans.length}</div></div>
        <div class="stat-card"><div class="muted">Letzter Monat</div><div class="stat-value">${state.plans[0]?.label || '—'}</div></div>
      </div>
      ${state.plans.length === 0 ? `<div class="empty-state">Noch keine Pläne gespeichert.</div>` : ''}
      <div class="stack" style="margin-top:12px">
        ${state.plans.map(plan => `
          <div class="card">
            <div class="section-title">
              <div>
                <h3>${escapeHtml(plan.label)}</h3>
                <div class="muted">Erstellt am ${new Date(plan.createdAt).toLocaleString('de-DE')}</div>
              </div>
            </div>
            <div class="inline-list">
              <span class="badge">${plan.employees.length} Mitarbeiter</span>
              <span class="badge">${plan.days.length} Tage</span>
              <span class="badge">${plan.meta.federalState}</span>
            </div>
            <div class="plan-toolbar">
              <button class="secondary-btn" data-action="open-plan" data-id="${plan.id}">Öffnen</button>
              <button class="small-btn" data-action="share-pdf" data-id="${plan.id}">PDF / Drucken</button>
              <button class="small-btn" data-action="share-csv" data-id="${plan.id}">CSV / Excel</button>
              <button class="danger-btn" data-action="delete-plan" data-id="${plan.id}">Löschen</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  root.querySelectorAll('[data-action="open-plan"]').forEach(btn => btn.addEventListener('click', () => openPlanModal(btn.dataset.id)));
  root.querySelectorAll('[data-action="share-pdf"]').forEach(btn => btn.addEventListener('click', () => sharePdf(btn.dataset.id)));
  root.querySelectorAll('[data-action="share-csv"]').forEach(btn => btn.addEventListener('click', () => shareCsv(btn.dataset.id)));
  root.querySelectorAll('[data-action="delete-plan"]').forEach(btn => btn.addEventListener('click', () => deletePlan(btn.dataset.id)));
}

function openPlanModal(id) {
  const plan = state.plans.find(p => p.id === id);
  if (!plan) return;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-body">${renderPlanPreview(plan)}<div class="right-actions no-print" style="margin-top:12px"><button class="small-btn" id="closeModalBtn">Schließen</button></div></div>`;
  modal.showModal();
  modal.querySelector('#closeModalBtn').addEventListener('click', () => modal.close());
}

function sharePdf(id) {
  const plan = state.plans.find(p => p.id === id);
  if (!plan) return;
  const printable = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(plan.label)}</title><link rel="stylesheet" href="styles.css"><style>
@page{size:A4 portrait !important;margin:4mm !important}
html,body{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;background:#fff !important}
body{font-size:10px !important}
.topbar,.app-header,.bottom-nav,.right-actions,.no-print{display:none !important}
.main-content,.content{padding:0 !important;margin:0 !important}
.card{box-shadow:none !important;border:0 !important;margin:0 !important;padding:0 !important;background:#fff !important}
.section-title{margin:0 0 3px 0 !important;align-items:flex-start !important}
.section-title h2,.section-title h3{font-size:10px !important;line-height:1.05 !important;margin:0 !important}
.muted{font-size:6.2px !important;line-height:1 !important}
.legend{font-size:6.2px !important;gap:3px !important;margin:4px 0 0 0 !important}
.badge{padding:1px 4px !important;font-size:6.2px !important;border-radius:999px !important}
.plan-table-wrap{overflow:visible !important}
.plan-table{table-layout:fixed !important;width:100% !important;min-width:0 !important;border-collapse:collapse !important;border-spacing:0 !important;border:1px solid #8ea7ca !important;background:#fff !important}
.plan-table th,.plan-table td{padding:1px 2px !important;font-size:6.0px !important;border:1px solid #8ea7ca !important;text-align:center !important;background:#fff !important}
.plan-table thead th{background:#d7e3f6 !important;color:#1f2937 !important;font-weight:800 !important}
.plan-table th:first-child,.plan-table td:first-child{width:46px !important;min-width:46px !important;max-width:46px !important}
.plan-table tr[style*="background:#d7dde7"] td,.plan-table tr[style*="background:#eef4ff"] td,.plan-table tr[style*="background:#fef3c7"] td{background:#fff !important}
.plan-header-date{display:flex !important;flex-direction:column !important;gap:0 !important;align-items:flex-start !important}
.plan-header-date span:first-child{font-size:6px !important;line-height:1 !important;font-weight:700 !important}
.plan-header-date span:last-child{font-size:5.4px !important;line-height:1 !important;color:#4b5563 !important;font-weight:600 !important}
.plan-cell{min-width:0 !important;padding:1px 1px !important;font-size:5.6px !important;line-height:1.02 !important;border-radius:7px !important;font-weight:700 !important;box-shadow:none !important}
.plan-cell.F{background:#dbeafe !important;color:#1d4ed8 !important}
.plan-cell.S{background:#eee7ff !important;color:#6d28d9 !important}
.plan-cell.FR{background:#edf0f3 !important;color:#4b5563 !important}
.plan-cell.U{background:#fff1c7 !important;color:#92400e !important}
.plan-cell.W{background:#fee2e2 !important;color:#b91c1c !important}
.plan-cell.K{background:#fecdd3 !important;color:#be123c !important}
.plan-cell.H{background:#fff1c7 !important;color:#a16207 !important}
.plan-cell.SO{background:#dcfce7 !important;color:#166534 !important}
.plan-cell.empty{background:#fff !important;color:#9ca3af !important}
.summary-table{width:100% !important;border-collapse:collapse !important;margin-top:3px !important;page-break-inside:avoid !important}
.summary-table th,.summary-table td{padding:2px 3px !important;font-size:6.2px !important;border-bottom:1px solid #d1d5db !important;background:#fff !important}
</style></head><body><main class="main-content">${renderPlanPreview(plan)}</main><script>window.onload=()=>window.print()</script></body></html>`;
  const win = window.open('', '_blank');
  win.document.write(printable);
  win.document.close();
}

async function shareCsv(id) {
  const plan = state.plans.find(p => p.id === id);
  if (!plan) return;
  const csv = buildCsv(plan);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const file = new File([blob], `${slugify(plan.label)}.csv`, { type: 'text/csv' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: plan.label });
  } else {
    downloadBlob(blob, `${slugify(plan.label)}.csv`);
  }
}

function deletePlan(id) {
  if (!confirm('Plan wirklich löschen?')) return;
  state.plans = state.plans.filter(p => p.id !== id);
  renderAll();
}

function renderSettingsTab() {
  const s = state.settings;
  const root = document.getElementById('tab-settings');
  root.innerHTML = `
    <div class="card">
      <div class="section-title">
        <div>
          <h2>Einstellungen</h2>
          <div class="muted">Schichten, Mindestbesetzung, Stundenregeln und Datensicherung</div>
        </div>
      </div>
      <div class="right-actions" style="margin-bottom:12px">
        <button class="secondary-btn" id="exportBackupBtn" type="button">Backup exportieren</button>
        <label class="small-btn" style="display:inline-flex;align-items:center;justify-content:center;cursor:pointer">Backup importieren<input id="importBackupInput" type="file" accept="application/json" hidden></label>
      </div>
      <form id="settingsForm" class="stack">
        <div class="card">
          <h3>Schichtzeiten</h3>
          <div class="grid-2">
            <label>Früh Beginn<input name="earlyStart" value="${s.shifts.early.start}" type="time"></label>
            <label>Früh Ende<input name="earlyEnd" value="${s.shifts.early.end}" type="time"></label>
            <label>Spät Beginn<input name="lateStart" value="${s.shifts.late.start}" type="time"></label>
            <label>Spät Ende<input name="lateEnd" value="${s.shifts.late.end}" type="time"></label>
            <label>Samstag Beginn<input name="satStart" value="${s.shifts.saturday.start}" type="time"></label>
            <label>Samstag Ende<input name="satEnd" value="${s.shifts.saturday.end}" type="time"></label>
            <label>Sondertag Beginn<input name="specStart" value="${s.shifts.special.start}" type="time"></label>
            <label>Sondertag Ende<input name="specEnd" value="${s.shifts.special.end}" type="time"></label>
          </div>
        </div>
        <div class="card">
          <h3>Planungsregeln</h3>
          <div class="grid-2">
            <label>Mindestens Mitarbeiter in Spätschicht<input type="number" name="minLate" min="1" value="${s.staffing.minLate}"></label>
            <label>Früh darf bei 3 Personen alleine sein
              <select name="allowSingleEarly"><option value="true" ${s.staffing.allowSingleEarlyWhenThreePeople ? 'selected' : ''}>Ja</option><option value="false" ${!s.staffing.allowSingleEarlyWhenThreePeople ? 'selected' : ''}>Nein</option></select>
            </label>
          </div>
        </div>
        <div class="card">
          <h3>Stundenberechnung</h3>
          <div class="grid-2">
            ${hourInputGroup('weekdayPresent', 'Mo-Fr anwesend', s.hours.weekdayPresent)}
            ${hourInputGroup('weekdayAbsent', 'Mo-Fr abwesend', s.hours.weekdayAbsent)}
            ${hourInputGroup('saturdayPresent', 'Sa anwesend', s.hours.saturdayPresent)}
            ${hourInputGroup('saturdayFree', 'Sa frei', s.hours.saturdayFree)}
            ${hourInputGroup('specialPresent', 'Sondertag anwesend', s.hours.specialPresent)}
            ${hourInputGroup('specialAbsent', 'Sondertag abwesend', s.hours.specialAbsent)}
          </div>
        </div>
        <button class="primary-btn" type="submit">Einstellungen speichern</button>
      </form>
    </div>
  `;
  root.querySelector('#settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    state.settings.shifts.early = { start: f.earlyStart.value, end: f.earlyEnd.value };
    state.settings.shifts.late = { start: f.lateStart.value, end: f.lateEnd.value };
    state.settings.shifts.saturday = { start: f.satStart.value, end: f.satEnd.value };
    state.settings.shifts.special = { start: f.specStart.value, end: f.specEnd.value };
    state.settings.staffing.minLate = Number(f.minLate.value || 2);
    state.settings.staffing.allowSingleEarlyWhenThreePeople = f.allowSingleEarly.value === 'true';
    for (const key of Object.keys(state.settings.hours)) {
      state.settings.hours[key] = {
        soll: Number(f[`${key}_soll`].value || 0),
        ist: Number(f[`${key}_ist`].value || 0)
      };
    }
    renderAll();
    alert('Einstellungen gespeichert.');
  });
  root.querySelector('#exportBackupBtn').addEventListener('click', exportBackup);
  root.querySelector('#importBackupInput').addEventListener('change', importBackup);
}


function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `dienstplan-backup-${new Date().toISOString().slice(0,10)}.json`);
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    state = mergeDeep(structuredClone(defaultState), parsed);
    saveState();
    renderAll();
    alert('Backup importiert.');
  } catch (error) {
    alert('Backup konnte nicht importiert werden.');
  } finally {
    event.target.value = '';
  }
}

function hourInputGroup(key, title, values) {
  return `
    <div class="card">
      <strong>${title}</strong>
      <div class="grid-2" style="margin-top:10px">
        <label>Soll<input type="number" step="0.25" name="${key}_soll" value="${values.soll}"></label>
        <label>Ist<input type="number" step="0.25" name="${key}_ist" value="${values.ist}"></label>
      </div>
    </div>
  `;
}

function validatePlanInputs(year, month) {
  const errors = [];
  const warnings = [];
  if (state.employees.length < 3) errors.push('Mindestens 3 Mitarbeiter werden benötigt.');
  const roster = buildMonthContext(year, month);
  roster.weeks.forEach(week => {
    const workDays = week.days.filter(d => d.weekday < 6);
    workDays.forEach(day => {
      const unavailable = unavailableEmployees(day.date);
      const availableCount = state.employees.length - unavailable.length;
      if (day.weekday === 6) return;
      if (availableCount < 3) errors.push(`${formatDate(day.date)}: Weniger als 3 verfügbare Mitarbeiter.`);
      if (availableCount === 3) warnings.push(`${formatDate(day.date)}: Nur 3 Mitarbeiter verfügbar. Frühschicht läuft dann ggf. alleine.`);
    });
    const saturdays = week.days.filter(d => d.weekday === 5 && isInTargetMonth(d.date, year, month));
    saturdays.forEach(day => {
      const available = state.employees.filter(e => !isAbsent(e.id, day.date, ['vacation', 'wishfree', 'sick']));
      if (available.length < Math.max(1, state.employees.length - 2)) {
        warnings.push(`${formatDate(day.date)}: Samstag könnte wegen Abwesenheiten oder Frei-Regeln knapp werden.`);
      }
    });
  });
  return { ok: errors.length === 0, errors, warnings };
}

function generatePlanAction() {
  const { year, month } = state.generation;
  const validation = validatePlanInputs(year, month);
  const output = document.getElementById('conflictOutput');
  output.innerHTML = renderValidation(validation);
  if (!validation.ok) return;
  try {
    const plan = generatePlan(year, month, state.generation.federalState);
    state.plans.unshift(plan);
    state.absences = [];
    renderAll();
    setActiveTab('plans');
    alert('Plan erstellt, gespeichert und in Pläne geöffnet. Die eingetragenen Abwesenheiten wurden danach geleert.');
  } catch (error) {
    output.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
  }
}

function generatePlan(year, month, federalState) {
  const context = buildMonthContext(year, month);
  const holidays = getHolidayMap(year, federalState);
  if (context.extendedEnd.getFullYear() !== year) {
    Object.assign(holidays, getHolidayMap(year + 1, federalState));
  }
  if (context.extendedStart.getFullYear() !== year) {
    Object.assign(holidays, getHolidayMap(year - 1, federalState));
  }

  const employeeMap = new Map(state.employees.map(e => [e.id, { ...e, assignments: {}, weeklyShiftPreference: null, saturdayOffCount: 0 }]));
  const weeklyShiftStart = estimateInitialWeeklyShift(context.weeks[0]);

  context.weeks.forEach((week, weekIndex) => {
    const desiredShift = weekIndex % 2 === 0 ? weeklyShiftStart : oppositeShift(weeklyShiftStart);
    const seen = new Set();
    const groups = [];
    state.employees.forEach(emp => {
      if (seen.has(emp.id)) return;
      if (emp.pairId) {
        const other = state.employees.find(e => e.id === emp.pairId);
        if (other) {
          groups.push([emp.id, other.id]);
          seen.add(emp.id); seen.add(other.id);
          return;
        }
      }
      groups.push([emp.id]);
      seen.add(emp.id);
    });

    const inTargetMonthDays = week.days.filter(d => isInTargetMonth(d.date, year, month));
    const saturdayInWeek = week.days.find(d => d.weekday === 5 && isInTargetMonth(d.date, year, month));
    let saturdayOffEmployeeId = null;
    const eligibleSaturday = state.employees.filter(e => e.saturdayRule && !hasVacationMonFriFullWeek(e.id, week.days));
    if (saturdayInWeek && eligibleSaturday.length > 0) {
      saturdayOffEmployeeId = eligibleSaturday.sort((a, b) => (employeeMap.get(a.id).saturdayOffCount - employeeMap.get(b.id).saturdayOffCount) || state.employees.findIndex(x => x.id===a.id) - state.employees.findIndex(x => x.id===b.id))[0].id;
      employeeMap.get(saturdayOffEmployeeId).saturdayOffCount += 1;
    }

    const weekdayFreeAssigned = {};
    inTargetMonthDays.filter(d => d.weekday < 5).forEach(day => {
      const unavailable = new Set(unavailableEmployees(day.date));
      const availGroups = groups.filter(group => group.every(id => !unavailable.has(id)));
      const availableEmployees = state.employees.filter(e => !unavailable.has(e.id));
      if (availableEmployees.length < 3) throw new Error(`${formatDate(day.date)}: Planung nicht möglich, weniger als 3 Mitarbeiter verfügbar.`);

      const mustFree = new Set();
      state.employees.forEach(emp => {
        if (emp.fixedFreeDay === day.weekday) mustFree.add(emp.id);
      });
      if (saturdayOffEmployeeId) {
        // in der Woche mit Samstag frei kein weiterer Wochentag frei
        mustFree.delete(saturdayOffEmployeeId);
      }

      const noAdditionalFree = new Set();
      state.employees.forEach(emp => {
        if (emp.fixedFreeDay !== '') noAdditionalFree.add(emp.id);
        if (saturdayOffEmployeeId === emp.id) noAdditionalFree.add(emp.id);
      });

      const alreadyWeekFree = new Set(Object.keys(weekdayFreeAssigned).filter(id => weekdayFreeAssigned[id]));
      let freeEmployeeId = [...mustFree][0] || null;

      if (!freeEmployeeId) {
        const freeCandidates = state.employees.filter(emp => !unavailable.has(emp.id) && !alreadyWeekFree.has(emp.id) && !noAdditionalFree.has(emp.id));
        freeCandidates.sort((a, b) => weeklyFreeScore(a.id, week.days, employeeMap, day.date) - weeklyFreeScore(b.id, week.days, employeeMap, day.date));
        freeEmployeeId = freeCandidates[0]?.id || null;
      }

      const workingIds = availableEmployees.map(e => e.id).filter(id => id !== freeEmployeeId);
      if (workingIds.length < 2) throw new Error(`${formatDate(day.date)}: Zu wenige Mitarbeiter nach Zuteilung des freien Tages.`);
      if (freeEmployeeId) weekdayFreeAssigned[freeEmployeeId] = true;

      const lateMin = Math.min(state.settings.staffing.minLate, Math.max(1, workingIds.length - 1));
      if (workingIds.length === 3 && state.settings.staffing.allowSingleEarlyWhenThreePeople) {
        assignShiftsForDay(day.date, workingIds, lateMin, desiredShift, employeeMap, groups);
      } else {
        assignShiftsForDay(day.date, workingIds, lateMin, desiredShift, employeeMap, groups);
      }

      availableEmployees.forEach(emp => {
        if (emp.id === freeEmployeeId) employeeMap.get(emp.id).assignments[day.date] = 'FR';
      });
      unavailable.forEach(id => {
        employeeMap.get(id).assignments[day.date] = absenceCodeFor(id, day.date, holidays);
      });
    });

    if (saturdayInWeek) {
      const date = saturdayInWeek.date;
      const unavailable = new Set(unavailableEmployees(date));
      state.employees.forEach(emp => {
        if (unavailable.has(emp.id)) {
          employeeMap.get(emp.id).assignments[date] = absenceCodeFor(emp.id, date, holidays);
          return;
        }
        if (saturdayOffEmployeeId === emp.id || hasVacationMonFriFullWeek(emp.id, week.days)) {
          employeeMap.get(emp.id).assignments[date] = 'FR';
          return;
        }
        employeeMap.get(emp.id).assignments[date] = isSpecialDay(date, emp) ? 'SO' : 'F';
      });
    }

    const sunday = week.days.find(d => d.weekday === 6 && isInTargetMonth(d.date, year, month));
    if (sunday) {
      state.employees.forEach(emp => {
        employeeMap.get(emp.id).assignments[sunday.date] = 'FR';
      });
    }
  });

  const planDays = getMonthDays(year, month).map(date => ({ date, day: Number(date.slice(8, 10)) }));
  const employees = state.employees.map(emp => ({
    id: emp.id,
    name: emp.name,
    color: emp.color,
    assignments: cropAssignmentsToMonth(employeeMap.get(emp.id).assignments, year, month)
  }));

  const summary = employees.map(emp => ({
    name: emp.name,
    ...calculateHours(emp.assignments, year, month, federalState, state.settings.hours)
  }));

  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    label: `${monthName(month)} ${year}`,
    days: planDays,
    employees,
    summary,
    meta: {
      federalState,
      holidays: Object.keys(holidays).filter(d => isInTargetMonth(d, year, month)),
      settings: structuredClone(state.settings)
    }
  };
}

function assignShiftsForDay(date, workingIds, lateMin, desiredShift, employeeMap, groups) {
  const desiredFirst = desiredShift === 'F' ? 'F' : 'S';
  const late = new Set();
  const early = new Set();

  const sortedGroups = groups
    .map(group => group.filter(id => workingIds.includes(id)))
    .filter(group => group.length > 0)
    .sort((a, b) => b.length - a.length);

  for (const group of sortedGroups) {
    const currentLateSize = late.size;
    const remainingAfter = workingIds.length - (late.size + early.size + group.length);
    const needLate = lateMin - currentLateSize;
    if (desiredFirst === 'S' && needLate > 0) {
      group.forEach(id => late.add(id));
    } else if (desiredFirst === 'F' && early.size === 0) {
      group.forEach(id => early.add(id));
    } else if (needLate > remainingAfter) {
      group.forEach(id => late.add(id));
    } else {
      group.forEach(id => early.add(id));
    }
  }

  for (const id of workingIds) {
    if (!late.has(id) && !early.has(id)) {
      if (late.size < lateMin) late.add(id);
      else early.add(id);
    }
  }

  if (late.size < lateMin) {
    const movable = [...early];
    while (late.size < lateMin && movable.length) {
      late.add(movable.pop());
    }
    early.clear();
    workingIds.forEach(id => { if (!late.has(id)) early.add(id); });
  }

  if (early.size === 0 && workingIds.length > lateMin) {
    const moved = [...late][0];
    late.delete(moved);
    early.add(moved);
  }

  workingIds.forEach(id => {
    employeeMap.get(id).assignments[date] = late.has(id) ? 'S' : 'F';
  });
}

function calculateHours(assignments, year, month, federalState, hourSettings) {
  const holidays = getHolidayMap(year, federalState);
  let soll = 0, ist = 0;
  Object.entries(assignments).forEach(([date, code]) => {
    const weekday = getWeekday(date);
    const special = isSpecialDay(date);
    const holiday = !!holidays[date];
    if (weekday === 6) return;
    if (special) {
      if (['F', 'S', 'SO'].includes(code)) {
        soll += hourSettings.specialPresent.soll;
        ist += hourSettings.specialPresent.ist;
      } else {
        soll += hourSettings.specialAbsent.soll;
        ist += hourSettings.specialAbsent.ist;
      }
      return;
    }
    if (weekday === 5) {
      if (['F', 'S', 'SO'].includes(code)) {
        soll += hourSettings.saturdayPresent.soll;
        ist += hourSettings.saturdayPresent.ist;
      } else {
        soll += hourSettings.saturdayFree.soll;
        ist += hourSettings.saturdayFree.ist;
      }
      return;
    }
    if (holiday) {
      return;
    }
    if (['F', 'S', 'SO'].includes(code)) {
      soll += hourSettings.weekdayPresent.soll;
      ist += hourSettings.weekdayPresent.ist;
    } else {
      soll += hourSettings.weekdayAbsent.soll;
      ist += hourSettings.weekdayAbsent.ist;
    }
  });
  return { soll, ist, delta: ist - soll };
}

function buildCsv(plan) {
  const header = ['Mitarbeiter', ...plan.days.map(d => `${String(d.day).padStart(2,'0')}.${String(new Date(plan.days[0].date).getMonth()+1).padStart(2,'0')}`), 'Soll', 'Ist', 'Delta'];
  const rows = plan.employees.map(emp => {
    const summary = plan.summary.find(s => s.name === emp.name);
    return [
      emp.name,
      ...plan.days.map(d => emp.assignments[d.date] || ''),
      summary.soll,
      summary.ist,
      summary.delta
    ];
  });
  return [header, ...rows].map(row => row.map(csvEscape).join(';')).join('\n');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[;"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildMonthContext(year, month) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const start = startOfWeek(first);
  const end = endOfWeek(last);
  const weeks = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const date = formatIso(cursor);
      weekDays.push({ date, weekday: getWeekday(date) });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push({ days: weekDays });
  }
  return { weeks, extendedStart: start, extendedEnd: end };
}

function estimateInitialWeeklyShift(firstWeek) {
  const prevWeekStart = new Date(new Date(firstWeek.days[0].date));
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const iso = formatIso(prevWeekStart);
  const previousPlans = state.plans;
  for (const plan of previousPlans) {
    const any = plan.employees.some(emp => emp.assignments[iso] === 'F');
    if (any) return 'S';
  }
  return 'F';
}

function weeklyFreeScore(id, weekDays, employeeMap, currentDate) {
  const emp = employeeMap.get(id);
  const existingFree = weekDays.filter(d => emp.assignments[d.date] === 'FR').length;
  const order = state.employees.findIndex(e => e.id === id);
  return existingFree * 10 + order + currentDate.charCodeAt(9) / 100;
}

function unavailableEmployees(date) {
  return state.absences.filter(a => a.dates.includes(date)).map(a => a.employeeId);
}

function isAbsent(employeeId, date, types) {
  return state.absences.some(a => a.employeeId === employeeId && a.dates.includes(date) && (!types || types.includes(a.type)));
}

function absenceCodeFor(employeeId, date, holidays) {
  const absence = state.absences.find(a => a.employeeId === employeeId && a.dates.includes(date));
  if (!absence) return holidays[date] ? 'H' : '';
  if (absence.type === 'vacation') return 'U';
  if (absence.type === 'wishfree') return 'W';
  if (absence.type === 'sick') return 'K';
  return '';
}

function hasVacationMonFriFullWeek(employeeId, weekDays) {
  const monFri = weekDays.filter(d => d.weekday < 5);
  return monFri.length === 5 && monFri.every(d => isAbsent(employeeId, d.date, ['vacation']));
}

function isSpecialDate(date) {
  const [, m, d] = date.split('-').map(Number);
  const key = `${String(d).padStart(2,'0')}.${String(m).padStart(2,'0')}`;
  return ['24.12', '31.12'].includes(key);
}

function isSpecialDay(date, employee) {
  const [, m, d] = date.split('-').map(Number);
  const key = `${String(d).padStart(2,'0')}.${String(m).padStart(2,'0')}`;
  if (!employee) return isSpecialDate(date);
  return Array.isArray(employee.specialDays) && employee.specialDays.includes(key);
}

function cropAssignmentsToMonth(assignments, year, month) {
  return Object.fromEntries(Object.entries(assignments).filter(([date]) => isInTargetMonth(date, year, month)));
}

function getMonthDays(year, month) {
  const result = [];
  const last = new Date(year, month, 0).getDate();
  for (let day = 1; day <= last; day++) result.push(formatIso(new Date(year, month - 1, day)));
  return result;
}

function renderCalendarGrid(year, month, selectedDates, holidays) {
  const first = new Date(year, month - 1, 1);
  const startPad = (first.getDay() + 6) % 7;
  const lastDay = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push('<div class="calendar-day outside"></div>');
  for (let day = 1; day <= lastDay; day++) {
    const date = formatIso(new Date(year, month - 1, day));
    const holidayName = holidays[date];
    cells.push(`
      <button type="button" class="calendar-day ${selectedDates.includes(date) ? 'selected' : ''} ${holidayName ? 'holiday' : ''}" data-date="${date}">
        <span>${day}</span>
        ${holidayName ? `<span class="tiny">FT</span>` : ''}
      </button>
    `);
  }
  return `<div class="calendar-grid">${DAYS.map(d => `<div class="calendar-head">${d}</div>`).join('')}${cells.join('')}</div>`;
}

function getHolidayMap(year, federalState) {
  const map = {};
  const add = (m, d, name) => map[formatIso(new Date(year, m - 1, d))] = name;
  add(1, 1, 'Neujahr');
  add(5, 1, 'Tag der Arbeit');
  add(10, 3, 'Tag der Deutschen Einheit');
  add(12, 25, '1. Weihnachtstag');
  add(12, 26, '2. Weihnachtstag');
  const easter = easterSunday(year);
  addFromDate(offsetDate(easter, -2), 'Karfreitag', map);
  addFromDate(offsetDate(easter, 1), 'Ostermontag', map);
  addFromDate(offsetDate(easter, 39), 'Christi Himmelfahrt', map);
  addFromDate(offsetDate(easter, 50), 'Pfingstmontag', map);

  if (['BW', 'BY', 'ST'].includes(federalState)) add(1, 6, 'Heilige Drei Könige');
  if (['BB', 'MV', 'SN', 'ST', 'TH', 'HB', 'HH', 'NI', 'SH'].includes(federalState)) add(10, 31, 'Reformationstag');
  if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(federalState)) addFromDate(offsetDate(easter, 60), 'Fronleichnam', map);
  if (['SL'].includes(federalState)) add(8, 15, 'Mariä Himmelfahrt');
  if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(federalState)) add(11, 1, 'Allerheiligen');
  if (['SN'].includes(federalState)) {
    const buss = bussUndBettag(year);
    addFromDate(buss, 'Buß- und Bettag', map);
  }
  if (['BE'].includes(federalState)) add(3, 8, 'Internationaler Frauentag');
  if (['TH'].includes(federalState)) add(9, 20, 'Weltkindertag');
  return map;
}

function addFromDate(date, name, map) {
  map[formatIso(date)] = name;
}

function bussUndBettag(year) {
  const date = new Date(year, 10, 23);
  while (date.getDay() !== 3) date.setDate(date.getDate() - 1);
  return date;
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function offsetDate(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0,0,0,0);
  return copy;
}

function endOfWeek(date) {
  const copy = startOfWeek(date);
  copy.setDate(copy.getDate() + 6);
  return copy;
}

function dateRange(start, end) {
  const result = [];
  let current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    result.push(formatIso(current));
    current.setDate(current.getDate() + 1);
  }
  return result;
}

function formatIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekday(dateString) {
  const date = new Date(dateString);
  return (date.getDay() + 6) % 7;
}

function toMonthInput(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function isInTargetMonth(date, year, month) {
  const d = new Date(date);
  return d.getFullYear() === year && d.getMonth() + 1 === month;
}

function monthName(month) {
  return new Date(2026, month - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('de-DE');
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function defaultAvatar(color) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="32" fill="${color}"/><circle cx="60" cy="44" r="20" fill="white" opacity="0.95"/><path d="M28 98c7-18 21-28 32-28s25 10 32 28" fill="white" opacity="0.95"/></svg>`)}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function oppositeShift(shift) { return shift === 'F' ? 'S' : 'F'; }

function formatHours(value) {
  return `${Number(value).toFixed(2).replace('.', ',')} h`;
}

function formatSignedHours(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${Number(value).toFixed(2).replace('.', ',')} h`;
}

function describeCode(code, day, shifts) {
  if (code === 'F') return `Früh ${shifts.early.start}-${shifts.early.end}`;
  if (code === 'S') return `Spät ${shifts.late.start}-${shifts.late.end}`;
  if (code === 'FR') return 'Frei';
  if (code === 'U') return 'Urlaub';
  if (code === 'W') return 'Wunschfrei';
  if (code === 'K') return 'Krank';
  if (code === 'H') return 'Feiertag';
  if (code === 'SO') return `Sondertag ${shifts.special.start}-${shifts.special.end}`;
  return 'Keine Zuordnung';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function escapeAttr(text) { return escapeHtml(text); }
