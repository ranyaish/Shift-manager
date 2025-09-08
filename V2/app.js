// app.js (מלא)
// =============== Supabase Setup ===============
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://uzaqpwbejceyuhnmfdmq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6YXFwd2JlamNleXVobm1mZG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyODc3NzMsImV4cCI6MjA3MDg2Mzc3M30.Wcuu97xzFvJCt8x2ubHLwc19-ZsfrRLK9YZHICV3T3A';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: 'shifts' } });
window.supa = supabase;

// =============== DOM Refs ===============
const authSection   = document.getElementById('authSection');
const employeePanel = document.getElementById('employeePanel');
const managerPanel  = document.getElementById('managerPanel');
const whoami        = document.getElementById('whoami');
const btnSignOut    = document.getElementById('btnSignOut');

const weekStartInp  = document.getElementById('weekStart');
const btnOpenWeek   = document.getElementById('btnOpenWeek');
const btnReloadWeek = document.getElementById('btnReloadWeek');
const weekScroller  = document.getElementById('weekScroller');

const avWeekStart = document.getElementById('avWeekStart');
const avDay       = document.getElementById('avDay');
const avSlot      = document.getElementById('avSlot');
const avNote      = document.getElementById('avNote');
const btnSubmitAvailability = document.getElementById('btnSubmitAvailability');
const myShiftsBox = document.getElementById('myShifts');

const empModal      = document.getElementById('employeeModal');
const empModalTitle = document.getElementById('empModalTitle');
const empModalBody  = document.getElementById('empModalBody');
document.getElementById('closeEmpModal')?.addEventListener('click', ()=>empModal.close());

const availModal    = document.getElementById('availModal');
const availTitle    = document.getElementById('availTitle');
const availBody     = document.getElementById('availBody');
const btnSaveAvail  = document.getElementById('btnSaveAvail');
document.getElementById('closeAvailModal')?.addEventListener('click', ()=>availModal.close());

// Timeline (תצוגת יום)
const timelineCard  = document.getElementById('timelineCard');
const tlDayName     = document.getElementById('tlDayName');
const timelineBars  = document.getElementById('timelineBars');

let _selectedDayISO = null;
let _orderedWeekDays = []; // כל ימי השבוע (ללא שישי)
let _currentDayIndex = 0;

let weekStatusBadge = null;
let btnDeleteWeek   = null;

// =============== Auth ===============
document.getElementById('btnSignIn')?.addEventListener('click', async () => {
  const email = (document.getElementById('email').value || '').trim();
  const password = document.getElementById('password').value || '';
  const btn = document.getElementById('btnSignIn');
  btn.disabled = true; btn.textContent = 'מתחבר…';
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return alert('שגיאת התחברות: ' + error.message);
    await afterAuth();
  } finally {
    btn.disabled = false; btn.textContent = 'כניסה';
  }
});

btnSignOut?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

async function afterAuth() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return alert(error.message);
  if (!user) return;

  whoami?.classList.remove('hidden');
  if (whoami) whoami.textContent = user.email || user.id;
  btnSignOut?.classList.remove('hidden');
  authSection?.classList.add('hidden');

  const { data: prof, error: perr } = await supabase
    .from('user_profiles')
    .select('app_role, employee_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (perr) return alert('שגיאת פרופיל: ' + perr.message);

  if (prof?.app_role === 'manager') {
    managerPanel?.classList.remove('hidden');
    weekStartInp.value = isoOfUpcomingSunday();
    bindManager();
    if (prof?.employee_id) initEmployee(prof.employee_id);
  } else {
    if (!prof?.employee_id) return alert('לא נמצא כרטיס עובד לחשבון זה.');
    initEmployee(prof.employee_id);
  }
}

// =============== Employee Panel ===============
function initEmployee(employeeId) {
  employeePanel?.classList.remove('hidden');
  avWeekStart.value = isoOfUpcomingSunday();

  btnSubmitAvailability?.addEventListener('click', async () => {
    const week_start = avWeekStart.value;
    const day_of_week = Number(avDay.value);
    const slot = avSlot.value;
    const note = (avNote.value || null);

    if (!withinDeadline(week_start)) {
      return alert('עבר הדד-ליין להגשת זמינות לשבוע זה (שישי 14:00).');
    }

    const { error } = await supabase.from('availability').upsert({
      employee_id: employeeId, week_start, day_of_week, slot, note
    }, { onConflict: 'employee_id,week_start,day_of_week,slot' });
    if (error) return alert('שגיאה בשמירת זמינות: ' + error.message);
    alert('הזמינות נשמרה ✅');
    await refreshMyShifts();
  });

  refreshMyShifts();
}

async function refreshMyShifts() {
  if (!myShiftsBox) return;
  myShiftsBox.innerHTML = '';
  const { data: rows, error } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, status, shift:shift_id(date, slot), vehicle:vehicle_id(code)')
    .order('start_time');
  if (error) return myShiftsBox.innerHTML = `<div class="text-red-600">${error.message}</div>`;
  if (!rows?.length) return myShiftsBox.innerHTML = '<div class="text-gray-500">אין שיבוצים להצגה.</div>';
  rows.forEach(r => {
    const d = new Date(r.shift.date);
    const day = d.toLocaleDateString('he-IL', { weekday:'long', year:'numeric', month:'2-digit', day:'2-digit' });
    const slotTxt = slotName(r.shift.slot);
    const veh = r.vehicle?.code ? ` · רכב ${r.vehicle.code}` : '';
    const el = document.createElement('div');
    el.className = 'assigned-row';
    el.innerHTML = `<div class="font-semibold">${day} · ${slotTxt}${veh}</div>
                    <div class="text-gray-600 text-xs">שעות: ${r.start_time?.slice(0,5)}–${r.end_time?.slice(0,5)} · סטטוס: ${statusName(r.status)}</div>`;
    myShiftsBox.appendChild(el);
  });
}

// =============== Manager Panel ===============
function bindManager() {
  injectWeekControls();

  btnOpenWeek?.addEventListener('click', async () => {
    const ws = weekStartInp.value;
    if (!ws) return alert('בחר תאריך תחילת שבוע (יום ראשון)');

    await upsertWeeklyRoster(ws, 'draft');
    const { error } = await supabase.rpc('generate_weekly_roster', { p_week_start: ws });
    if (error) return alert('שגיאה ביצירת שבוע: ' + error.message);

    btnReloadWeek?.classList.remove('hidden');
    await loadWeek(ws);
  });

  btnReloadWeek?.addEventListener('click', async () => {
    if (!weekStartInp.value) return;
    await loadWeek(weekStartInp.value);
  });

  btnDeleteWeek?.addEventListener('click', async () => {
    const ws = weekStartInp.value;
    if (!ws) return alert('בחר תאריך תחילת שבוע');
    if (!confirm('למחוק את שבוע העבודה (כולל כל השיבוצים) ולהתחיל מחדש?')) return;
    try {
      await deleteWeekData(ws);
      alert('השבוע נמחק. אפשר לפתוח מחדש.');
      weekScroller.innerHTML = '';
      timelineBars.innerHTML = '';
      toggleWeekStatus(null);
    } catch (e) {
      alert('שגיאה במחיקת שבוע: ' + (e.message || e));
    }
  });
}

function injectWeekControls() {
  if (weekStatusBadge && btnDeleteWeek) return;
  const card = weekStartInp.closest('.card');
  const grid = card.querySelector('.grid');
  const ctrlWrap = document.createElement('div');
  ctrlWrap.className = 'flex items-end gap-2 col-span-12 md:col-span-4';

  weekStatusBadge = document.createElement('span');
  weekStatusBadge.className = 'pill';
  weekStatusBadge.textContent = '—';

  btnDeleteWeek = document.createElement('button');
  btnDeleteWeek.className = 'btn btn-danger';
  btnDeleteWeek.textContent = 'מחק שבוע';

  ctrlWrap.appendChild(weekStatusBadge);
  ctrlWrap.appendChild(btnDeleteWeek);
  grid.appendChild(ctrlWrap);
}

// Weekly roster helpers
async function getWeeklyRoster(ws) {
  const { data } = await supabase.from('weekly_rosters').select('id, week_start, status').eq('week_start', ws).maybeSingle();
  return data || null;
}
async function upsertWeeklyRoster(ws, status='draft') {
  await supabase.from('weekly_rosters').upsert({ week_start: ws, status }, { onConflict:'week_start' });
}
function toggleWeekStatus(roster) {
  if (!weekStatusBadge) return;
  if (!roster) {
    weekStatusBadge.textContent = 'אין שבוע פעיל';
    weekStatusBadge.style.background = '#f3f4f6';
    weekStatusBadge.style.color = '#374151';
    return;
  }
  const st = roster.status || 'draft';
  weekStatusBadge.textContent = st === 'draft' ? 'טיוטה' : st;
  weekStatusBadge.style.background = st === 'draft' ? '#e0f2fe' : '#dcfce7';
  weekStatusBadge.style.color = st === 'draft' ? '#075985' : '#166534';
}

async function deleteWeekData(weekStartISO) {
  const from = weekStartISO;
  const to = addDaysISO(weekStartISO, 6);

  const { data: shifts, error: e1 } = await supabase.from('shifts').select('id').gte('date', from).lte('date', to);
  if (e1) throw e1;
  const ids = (shifts || []).map(s => s.id);

  if (ids.length) {
    const { error: e2 } = await supabase.from('shift_assignments').delete().in('shift_id', ids);
    if (e2) throw e2;
  }
  const { error: e3 } = await supabase.from('shifts').delete().gte('date', from).lte('date', to);
  if (e3) throw e3;
  const { error: e4 } = await supabase.from('weekly_rosters').delete().eq('week_start', weekStartISO);
  if (e4) throw e4;
}

// =============== Load Week & Columns ===============
async function loadWeek(weekStartISO) {
  weekScroller.innerHTML = '';

  const roster = await getWeeklyRoster(weekStartISO);
  toggleWeekStatus(roster);

  const { data: shifts, error } = await supabase
    .from('shifts')
    .select('id, date, slot, planned_start, planned_end')
    .gte('date', weekStartISO)
    .lte('date', addDaysISO(weekStartISO, 6))
    .order('date', { ascending:true })
    .order('slot', { ascending:true });
  if (error) {
    weekScroller.innerHTML = `<div class="text-red-600 p-3">${error.message}</div>`;
    return;
  }

  const byDay = new Map();
  shifts?.forEach(s => {
    if (!byDay.has(s.date)) byDay.set(s.date, { date:s.date, slots:{ lunch:null, dinner:null, long:null } });
    byDay.get(s.date).slots[s.slot] = s;
  });

  _orderedWeekDays = [];
  for (let i=0;i<7;i++){ if(i===5)continue; _orderedWeekDays.push(addDaysISO(weekStartISO,i)); }

  for (const d of _orderedWeekDays) {
    const dayData = byDay.get(d) || { date:d, slots:{ lunch:null, dinner:null, long:null } };
    const col = await renderDayColumn(dayData, weekStartISO);
    col.querySelector('.day-head').addEventListener('click', async () => {
      _selectedDayISO = dayData.date;
      _currentDayIndex = _orderedWeekDays.indexOf(_selectedDayISO);
      await renderTimeline(_selectedDayISO);
    });
    weekScroller.appendChild(col);
  }

  _selectedDayISO = _orderedWeekDays[0];
  _currentDayIndex = 0;
  await renderTimeline(_selectedDayISO);
}

async function renderDayColumn(dayData, weekStartISO) {
  const col = document.createElement('div');
  col.className = 'day-col';

  const dayName = new Date(dayData.date).toLocaleDateString('he-IL', { weekday:'long' });
  const dateTxt = new Date(dayData.date).toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit' });

  col.innerHTML = `
    <div class="day-head">
      <div class="font-extrabold">${dayName}</div>
      <div class="badge">${dateTxt}</div>
    </div>
    <div class="shift-box" data-slot="lunch"></div>
    <div class="shift-box" data-slot="dinner"></div>
    <div class="shift-box" data-slot="long"></div>
  `;

  for (const slot of ['lunch','dinner','long']) {
    await renderShiftBox(col.querySelector(`[data-slot="${slot}"]`), dayData, slot, weekStartISO);
  }
  return col;
}

async function renderShiftBox(container, dayData, slot, weekStartISO) {
  container.innerHTML = `
    <div class="shift-title">
      <span>${slotName(slot)}</span>
      <button class="btn btn-ghost text-xs ml-auto" title="ניהול זמינות">⚙ זמינות</button>
    </div>
    <div class="assigned-list"></div>

    <div class="mt-2 flex items-center gap-2">
      <select class="input grow assign-select" disabled></select>
      <button class="btn btn-primary assign-btn" disabled>שבץ</button>
    </div>

    <div class="quick-add">
      <input class="input qa-name" placeholder="הוסף עובד חדש בשם חופשי…" />
      <button class="btn btn-primary qa-btn">הוסף ושבץ</button>
    </div>
  `;

  const listEl = container.querySelector('.assigned-list');
  const selEl  = container.querySelector('.assign-select');
  const btnEl  = container.querySelector('.assign-btn');
  const availBtn = container.querySelector('.shift-title .btn');
  const qaName = container.querySelector('.qa-name');
  const qaBtn  = container.querySelector('.qa-btn');

  const shiftRow = dayData.slots[slot];
  if (!shiftRow) {
    listEl.innerHTML = `<div class="kicker">אין משמרת קיימת – צור שבוע.</div>`;
    selEl.disabled = true; btnEl.disabled = true; qaBtn.disabled = true;
    return;
  }

  await refreshAssignmentsUI(listEl, shiftRow.id, dayData.date);

  // רשימת עובדים זמינים + הערות
  const avail = await fetchAvailableWithNotes(dayData.date, slot);
  selEl.innerHTML = '';
  if (!avail.length) {
    selEl.innerHTML = `<option>אין עובדים זמינים</option>`;
    selEl.disabled = true; btnEl.disabled = true;
  } else {
    avail.forEach(e => {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.full_name + (e.note ? ` — ${e.note}` : '');
      selEl.appendChild(o);
    });
    selEl.disabled = false; btnEl.disabled = false;
  }

  btnEl.addEventListener('click', async () => {
    const employee_id = selEl.value;
    if (!employee_id) return;
    const start_time = shiftRow.planned_start || '11:00';
    const end_time   = shiftRow.planned_end   || '17:00';
    const { error } = await supabase.from('shift_assignments').insert({
      shift_id: shiftRow.id, employee_id, status:'planned', role:'other', start_time, end_time
    });
    if (error) return alert('שגיאת שיבוץ: ' + error.message);
    await refreshAssignmentsUI(listEl, shiftRow.id, dayData.date);
    if (_selectedDayISO === dayData.date) renderTimeline(dayData.date);
  });

  qaBtn.addEventListener('click', async () => {
    const name = (qaName.value || '').trim();
    if (!name) return alert('כתוב שם מלא');
    const { data: ins, error } = await supabase.from('employees').insert({ full_name: name }).select('id').maybeSingle();
    if (error) return alert('שגיאה בהוספת עובד: ' + error.message);
    const start_time = shiftRow.planned_start || '11:00';
    const end_time   = shiftRow.planned_end   || '17:00';
    const { error: e2 } = await supabase.from('shift_assignments').insert({
      shift_id: shiftRow.id, employee_id: ins.id, status:'planned', role:'other', start_time, end_time
    });
    if (e2) return alert('שגיאת שיבוץ: ' + e2.message);
    qaName.value = '';
    await refreshAssignmentsUI(listEl, shiftRow.id, dayData.date);
    if (_selectedDayISO === dayData.date) renderTimeline(dayData.date);
  });

  availBtn.addEventListener('click', async () => {
    await openAvailManager(dayData.date, slot, weekStartISO);
  });
}

// מציג שורות משובצים + כפתור "ערוך שעות" ו"הסר"
async function refreshAssignmentsUI(listEl, shift_id, dayISO) {
  listEl.innerHTML = '';
  const { data: rows, error } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, employee:employee_id(id, full_name, phone)')
    .eq('shift_id', shift_id)
    .order('start_time');
  if (error) return (listEl.innerHTML = `<div class="text-red-600">${error.message}</div>`);
  if (!rows?.length) return (listEl.innerHTML = `<div class="kicker">אין שיבוצים למשבצת זו.</div>`);

  rows.forEach(r => {
    const row = document.createElement('div'); row.className = 'assigned-row';

    const left = document.createElement('div');
    const empBtn = document.createElement('button');
    empBtn.className = 'emp-link'; empBtn.textContent = r.employee?.full_name || '—';
    empBtn.addEventListener('click', ()=>openEmployeeCard(r.employee?.id));

    const info = document.createElement('div');
    info.className = 'text-xs text-gray-600';
    info.textContent = `שעות: ${r.start_time?.slice(0,5)}–${r.end_time?.slice(0,5)}`;

    left.appendChild(empBtn); left.appendChild(info);

    const wrapBtns = document.createElement('div');
    wrapBtns.className = 'flex items-center gap-2';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-gray text-sm';
    editBtn.textContent = 'ערוך שעות';
    editBtn.addEventListener('click', async () => {
      const s = prompt('שעת התחלה (HH:MM)', r.start_time?.slice(0,5) || '11:00');
      if (!s) return;
      const e = prompt('שעת סיום (HH:MM)', r.end_time?.slice(0,5) || '17:00');
      if (!e) return;
      const { error: uerr } = await supabase.from('shift_assignments').update({ start_time:s, end_time:e }).eq('id', r.id);
      if (uerr) return alert('שגיאת עדכון: ' + uerr.message);
      await refreshAssignmentsUI(listEl, shift_id, dayISO);
      if (_selectedDayISO === dayISO) renderTimeline(dayISO);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger text-sm'; delBtn.textContent = 'הסר';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`להסיר את ${r.employee?.full_name || ''} מהמשמרת?`)) return;
      const { error: derr } = await supabase.from('shift_assignments').delete().eq('id', r.id);
      if (derr) return alert('שגיאת הסרה: ' + derr.message);
      await refreshAssignmentsUI(listEl, shift_id, dayISO);
      if (_selectedDayISO === dayISO) renderTimeline(dayISO);
    });

    wrapBtns.appendChild(editBtn);
    wrapBtns.appendChild(delBtn);

    const wrap = document.createElement('div');
    wrap.className = 'flex items-center justify-between w-full';
    wrap.appendChild(left); wrap.appendChild(wrapBtns);
    row.appendChild(wrap);
    listEl.appendChild(row);
  });
}

// =============== Availability ===============
async function fetchAvailableWithNotes(isoDate, slot) {
  const dow = dayIndexFromISO(isoDate);
  const ws = weekStartFromISO(isoDate);

  const { data: av, error } = await supabase
    .from('availability').select('employee_id, note')
    .eq('week_start', ws).eq('day_of_week', dow).eq('slot', slot);
  if (error) { console.error(error); return []; }

  const notesByEmp = new Map(av.map(a => [a.employee_id, a.note]));
  const ids = [...new Set(av.map(r => r.employee_id))];
  if (!ids.length) return [];

  const { data: emps, error: e2 } = await supabase
    .from('employees').select('id, full_name, active')
    .in('id', ids).eq('active', true).order('full_name');
  if (e2) { console.error(e2); return []; }

  return (emps || []).map(e => ({ ...e, note: notesByEmp.get(e.id) || '' }));
}

let _availCtx = null;
async function openAvailManager(isoDate, slot, weekStartISO) {
  _availCtx = { isoDate, slot, ws: weekStartISO };
  availTitle.textContent = `ניהול זמינות · ${new Date(isoDate).toLocaleDateString('he-IL',{weekday:'long', day:'2-digit',month:'2-digit'})} · ${slotName(slot)}`;
  availBody.innerHTML = '<div class="kicker">טוען…</div>';

  const { data: employees, error: e1 } = await supabase
    .from('employees').select('id, full_name, active').eq('active', true).order('full_name');
  if (e1) { availBody.innerHTML = `<div class="text-red-600">${e1.message}</div>`; return; }

  const dow = dayIndexFromISO(isoDate);
  const { data: av, error: e2 } = await supabase
    .from('availability').select('employee_id, note')
    .eq('week_start', weekStartISO).eq('day_of_week', dow).eq('slot', slot);
  if (e2) { availBody.innerHTML = `<div class="text-red-600">${e2.message}</div>`; return; }
  const availSet = new Set(av.map(x => x.employee_id));
  const notes = new Map(av.map(x => [x.employee_id, x.note]));

  availBody.innerHTML = '';
  employees.forEach(emp => {
    const note = notes.get(emp.id);
    const row = document.createElement('label');
    row.className = 'assigned-row';
    row.innerHTML = `
      <div class="flex items-center gap-2">
        <input type="checkbox" class="av-chk" data-id="${emp.id}" ${availSet.has(emp.id)?'checked':''}/>
        <span>${emp.full_name}</span>
        ${note ? `<span class="badge">${note}</span>` : ''}
      </div>
    `;
    availBody.appendChild(row);
  });

  availModal.showModal();
}

btnSaveAvail?.addEventListener('click', async () => {
  if (!_availCtx) return availModal.close();
  const { isoDate, slot, ws } = _availCtx;
  const dow = dayIndexFromISO(isoDate);
  const chks = [...availBody.querySelectorAll('.av-chk')];
  const toKeep = new Set(chks.filter(c=>c.checked).map(c=>c.getAttribute('data-id')));

  const { data: cur } = await supabase
    .from('availability').select('employee_id')
    .eq('week_start', ws).eq('day_of_week', dow).eq('slot', slot);
  const curSet = new Set(cur?.map(x=>String(x.employee_id)) || []);

  const toInsert = [...toKeep].filter(id => !curSet.has(String(id)));
  const toDelete = [...curSet].filter(id => !toKeep.has(String(id)));

  if (toInsert.length) {
    const rows = toInsert.map(id => ({ employee_id: id, week_start: ws, day_of_week: dow, slot }));
    const { error } = await supabase.from('availability').insert(rows);
    if (error) return alert('שגיאת שמירה: ' + error.message);
  }
  if (toDelete.length) {
    const { error } = await supabase
      .from('availability').delete()
      .eq('week_start', ws).eq('day_of_week', dow).eq('slot', slot)
      .in('employee_id', toDelete);
    if (error) return alert('שגיאת מחיקה: ' + error.message);
  }

  availModal.close(); alert('נשמר ✅');
});

// =============== Employee Card ===============
async function openEmployeeCard(employeeId) {
  if (!employeeId) return;
  const { data: e, error } = await supabase
    .from('employees')
    .select('full_name, phone, address, driver_license_verified, active')
    .eq('id', employeeId).maybeSingle();
  if (error) return alert(error.message);
  empModalTitle.textContent = e?.full_name || 'כרטיס עובד';
  empModalBody.innerHTML = `
    <div><b>טלפון:</b> ${e?.phone || '—'}</div>
    <div><b>כתובת:</b> ${e?.address || '—'}</div>
    <div><b>רישיון נהיגה:</b> ${e?.driver_license_verified ? 'מאושר ✅' : 'לא מאושר'}</div>
    <div><b>סטטוס:</b> ${e?.active ? 'פעיל' : 'מושבת'}</div>
  `;
  empModal.showModal();
}

// =============== Timeline (שורות לפי שעה) ===============
function ensureTimelineNav() {
  // מוסיף כפתורי יום קודם/הבא בראש הכרטיס (פעם אחת)
  if (document.getElementById('tlPrev')) return;
  const head = tlDayName.parentElement;
  const left = document.createElement('div');
  left.className = 'flex items-center gap-2';

  const prev = document.createElement('button');
  prev.id = 'tlPrev';
  prev.className = 'btn btn-gray';
  prev.textContent = '‹ יום קודם';
  prev.addEventListener('click', async () => {
    if (_currentDayIndex > 0) {
      _currentDayIndex--;
      _selectedDayISO = _orderedWeekDays[_currentDayIndex];
      await renderTimeline(_selectedDayISO);
    }
  });

  const next = document.createElement('button');
  next.id = 'tlNext';
  next.className = 'btn btn-gray';
  next.textContent = 'יום הבא ›';
  next.addEventListener('click', async () => {
    if (_currentDayIndex < _orderedWeekDays.length - 1) {
      _currentDayIndex++;
      _selectedDayISO = _orderedWeekDays[_currentDayIndex];
      await renderTimeline(_selectedDayISO);
    }
  });

  left.appendChild(prev);
  left.appendChild(next);
  head.appendChild(left);
}

async function renderTimeline(isoDate) {
  ensureTimelineNav();

  // כותרת היום
  tlDayName.textContent =
    'שיבוצים ליום ' + new Date(isoDate).toLocaleDateString('he-IL',{weekday:'long', day:'2-digit', month:'2-digit'});
  timelineCard?.classList.remove('hidden');
  timelineBars.innerHTML = '';

  // שלוף כל השיבוצים לאותו יום
  const { data: shifts, error: e1 } = await supabase
    .from('shifts').select('id').eq('date', isoDate);
  if (e1) return (timelineBars.innerHTML = `<div class="text-red-600 p-3">${e1.message}</div>`);
  if (!shifts?.length) return (timelineBars.innerHTML = `<div class="kicker p-3">אין משמרות ליום זה.</div>`);

  const ids = shifts.map(s => s.id);
  const { data: assigns, error: e2 } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, shift_id, employee:employee_id(id, full_name)')
    .in('shift_id', ids);
  if (e2) return (timelineBars.innerHTML = `<div class="text-red-600 p-3">${e2.message}</div>`);
  if (!assigns?.length) return (timelineBars.innerHTML = `<div class="kicker p-3">אין שיבוצים ליום זה.</div>`);

  // ביטול כפילויות: (employee_id + start_time) ייחודי
  const uniq = [];
  const seen = new Set();
  for (const a of assigns) {
    const key = `${a.employee?.id || 'x'}|${a.start_time||''}`;
    if (seen.has(key)) continue;
    seen.add(key); uniq.push(a);
  }

  // קיבוץ לפי שעת התחלה (HH:MM)
  const byTime = new Map();
  uniq.forEach(a => {
    const hhmm = (a.start_time||'').slice(0,5) || '—';
    if (!byTime.has(hhmm)) byTime.set(hhmm, []);
    byTime.get(hhmm).push(a.employee?.full_name || '—');
  });

  // מיון לפי שעה
  const times = [...byTime.keys()].sort((a,b)=>a.localeCompare(b));

  // בנייה: "שעה 11:00 — שם1, שם2..."
  times.forEach(t => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    const name = document.createElement('div');
    name.className = 'emp-name';
    name.textContent = `שעה ${t}`;
    const list = document.createElement('div');
    list.className = 'emp-chips';
    const names = byTime.get(t).sort((a,b)=>a.localeCompare(b));
    // מציג שמות כצ'יפים קטנים
    names.forEach(n => {
      const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = n;
      list.appendChild(chip);
    });
    row.appendChild(name); row.appendChild(list);
    timelineBars.appendChild(row);
  });

  // עדכן מצב ניווט
  _currentDayIndex = _orderedWeekDays.indexOf(isoDate);
  document.getElementById('tlPrev').disabled = _currentDayIndex <= 0;
  document.getElementById('tlNext').disabled = _currentDayIndex >= (_orderedWeekDays.length - 1);
}

// =============== Utils ===============
function slotName(s){ return s==='lunch'?'צהריים':(s==='dinner'?'ערב':'ארוכה'); }
function statusName(s){ return {planned:'מתוכנן',confirmed:'מאושר',canceled:'מבוטל'}[s]||s; }
function isoOfUpcomingSunday(){
  const d=new Date(); const day=d.getDay(); // 0=א'
  const sun=new Date(d.getFullYear(),d.getMonth(),d.getDate()-day);
  const z=sun.getTimezoneOffset()*60000; return new Date(sun - z).toISOString().slice(0,10);
}
function addDaysISO(iso, days){
  const d = new Date(iso+'T00:00:00'); d.setDate(d.getDate()+days);
  const z=d.getTimezoneOffset()*60000; return new Date(d - z).toISOString().slice(0,10);
}
function dayIndexFromISO(iso){ return new Date(iso+'T00:00:00').getDay(); } // 0=א'
function weekStartFromISO(iso){
  const d = new Date(iso+'T00:00:00'); const sun = new Date(d); sun.setDate(d.getDate()-d.getDay());
  const z=sun.getTimezoneOffset()*60000; return new Date(sun - z).toISOString().slice(0,10);
}
function withinDeadline(weekStartISO){
  const ws = new Date(weekStartISO+'T00:00:00');
  const friday = new Date(ws); friday.setDate(ws.getDate()-2); friday.setHours(14,0,0,0);
  return new Date() <= friday;
}

// =============== Auto init ===============
(async () => {
  const { data:{ user } } = await supabase.auth.getUser();
  if (user) afterAuth();
})();
