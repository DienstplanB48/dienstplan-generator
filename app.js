
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
  setActiveTab('generieren');
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
          <div class="notice">Urlaub = ersten und letzten Tag anklicken. Wunschfrei/Krank = Mehrfachauswahl möglich.</div>
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
  const type = document.querySelector('#absenceForm [name="type"]')?.value || 'vacation';
  const highlightDates = normalizeAbsenceDates(currentAbsenceDraft.selectedDates, type);
  container.innerHTML = `
    <div class="card">
      <div class="section-title">
        <h3>${monthName(month)} ${year}</h3>
        <div class="muted">Kalenderauswahl</div>
      </div>
      ${renderCalendarGrid(year, month, highlightDates, holidays)}
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
  return `
    <div class="card card-plan-preview">
      <div class="section-title">
        <div>
          <h3>${latest ? 'Letzter Plan' : escapeHtml(plan.label)}</h3>
          <div class="muted">${escapeHtml(plan.label)} · ${plan.meta.federalState}</div>
        </div>
      </div>
      <div class="plan-table-wrap">${renderPlanTable(plan)}</div>
      <div class="legend">
        <span class="badge">F = Frei</span>
        <span class="badge">U = Urlaub</span>
        <span class="badge">W = Wunschfrei</span>
        <span class="badge">K = Krank</span>
        <span class="badge">FT = Feiertag</span>
        <span class="badge">Sonntag = Sonntag</span>
      </div>
      <div style="height:10px"></div>
      ${renderSummaryTable(plan)}
    </div>
  `;
}

function renderPlanTable(plan) {
  const holidays = new Set(plan.meta.holidays || []);
  return `
    <table class="plan-table plan-table-compact">
      <thead>
        <tr>
          <th class="day-col">Tag</th>
          ${plan.employees.map(emp => `<th class="emp-col"><div class="plan-header-date"><span>${escapeHtml(emp.name)}</span></div></th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${plan.days.map(day => {
          const weekday = getWeekday(day.date);
          const isSunday = weekday === 6;
          const isSaturday = weekday === 5;
          const isHoliday = holidays.has(day.date);
          const rowClass = isSunday ? 'row-sunday' : isSaturday ? 'row-saturday' : isHoliday ? 'row-holiday' : '';
          const daySub = isSunday ? 'Sonntag' : isHoliday ? 'FT' : DAYS[weekday];
          return `<tr class="${rowClass}">
            <td class="day-col">
              <div class="plan-day-box">
                <strong>${formatPlanDayLabel(day.date)}</strong>
                <span>${daySub}</span>
              </div>
            </td>
            ${plan.employees.map(emp => {
              const code = emp.assignments[day.date] || '';
              const display = getPlanDisplayValue(code, day.date, plan.meta.settings.shifts, holidays);
              const title = describeCode(code, day, plan.meta.settings.shifts, holidays);
              return `<td title="${escapeAttr(title)}"><div class="plan-cell ${display.className}">${escapeHtml(display.text)}</div></td>`;
            }).join('')}
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderSummaryTable(plan) {
  return `
    <table class="summary-table summary-table-compact">
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

function getPlanFileBaseName(plan) {
  const firstDate = plan?.days?.[0]?.date;
  if (!firstDate) return 'Dienstplan';
  const d = new Date(firstDate + 'T00:00:00');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `Dienstplan_${mm}${yy}`;
}

function sharePdf(id) {
  const plan = state.plans.find(p => p.id === id);
  if (!plan) return;
  const fileName = getPlanFileBaseName(plan);
  const printable = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(fileName)}</title><link rel="stylesheet" href="styles.css"><style>@page{size:A4 portrait;margin:7mm} body{font-size:10px;background:#fff} .main-content,.content{padding:0!important} .card{box-shadow:none!important;border:0!important;margin:0!important;padding:0!important} .plan-table-wrap{overflow:visible!important} .plan-table-compact{table-layout:fixed!important;width:100%!important;min-width:0!important} .plan-table-compact th,.plan-table-compact td{padding:3px 4px!important;font-size:9px!important} .plan-table-compact .day-col{width:66px!important;min-width:66px!important;max-width:66px!important} .plan-cell{padding:2px 2px!important;font-size:8.2px!important;line-height:1.1!important;border-radius:4px!important;min-width:0!important} .summary-table th,.summary-table td{padding:4px 5px!important;font-size:9px!important} .legend{font-size:9px!important;gap:4px!important;margin-top:6px!important} .no-print{display:none!important}</style></head><body><main class="main-content">${renderPlanPreview(plan)}</main><script>window.onload=()=>window.print()</script></body></html>`;
  const win = window.open('', '_blank');
  win.document.write(printable);
  win.document.close();
}

async function shareCsv(id) {
  const plan = state.plans.find(p => p.id === id);
  if (!plan) return;
  const csv = buildCsv(plan);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const fileName = `${getPlanFileBaseName(plan)}.csv`;
  const file = new File([blob], fileName, { type: 'text/csv' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: getPlanFileBaseName(plan) });
  } else {
    downloadBlob(blob, fileName);
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

