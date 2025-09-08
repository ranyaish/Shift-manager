import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ====== קונפיגורציה – עדכן ======
const SUPABASE_URL = 'https://uzaqpwbejceyuhnmfdmq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6YXFwd2JlamNleXVobm1mZG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyODc3NzMsImV4cCI6MjA3MDg2Mzc3M30.Wcuu97xzFvJCt8x2ubHLwc19-ZsfrRLK9YZHICV3T3A';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: 'shifts' } });
window.supa = supabase;

// ====== DOM ======
const authSection   = document.getElementById('authSection');
const employeePanel = document.getElementById('employeePanel');
const managerPanel  = document.getElementById('managerPanel');
const whoami        = document.getElementById('whoami');
const btnSignOut    = document.getElementById('btnSignOut');

const weekStartInp  = document.getElementById('weekStart');
const btnOpenWeek   = document.getElementById('btnOpenWeek');
const btnReloadWeek = document.getElementById('btnReloadWeek');
const weekScroller  = document.getElementById('weekScroller');

// עובד
const avWeekStart = document.getElementById('avWeekStart');
const avDay       = document.getElementById('avDay');
const avSlot      = document.getElementById('avSlot');
const avNote      = document.getElementById('avNote');
const btnSubmitAvailability = document.getElementById('btnSubmitAvailability');
const myShiftsBox = document.getElementById('myShifts');

// מודלים
const empModal      = document.getElementById('employeeModal');
const empModalTitle = document.getElementById('empModalTitle');
const empModalBody  = document.getElementById('empModalBody');
document.getElementById('closeEmpModal').onclick = () => empModal.close();

const availModal    = document.getElementById('availModal');
const availTitle    = document.getElementById('availTitle');
const availBody     = document.getElementById('availBody');
const btnSaveAvail  = document.getElementById('btnSaveAvail');
document.getElementById('closeAvailModal').onclick = () => availModal.close();

// ====== התחברות ======
document.getElementById('btnSignIn').addEventListener('click', async () => {
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

btnSignOut.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

// ====== אחרי התחברות ======
async function afterAuth() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return alert(error.message);
  if (!user) return;

  whoami.classList.remove('hidden');
  whoami.textContent = user.email || user.id;
  btnSignOut.classList.remove('hidden');
  authSection.classList.add('hidden');

  const { data: prof, error: perr } = await supabase
    .from('user_profiles')
    .select('app_role, employee_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (perr) return alert('שגיאת פרופיל: ' + perr.message);

  if (prof?.app_role === 'manager') {
    // מציג גם פאנל מנהל וגם תצוגת עובד (אם יש employee_id)
    managerPanel.classList.remove('hidden');
    weekStartInp.value = isoOfUpcomingSunday();
    bindManager();

    if (prof?.employee_id) initEmployee(prof.employee_id); // תצוגת עובד לעצמי (אם קיים)
  } else {
    if (!prof?.employee_id) return alert('לא נמצא כרטיס עובד לחשבון זה.');
    initEmployee(prof.employee_id);
  }
}

// ====== תצוגת עובד ======
function initEmployee(employeeId) {
  employeePanel.classList.remove('hidden');
  avWeekStart.value = isoOfUpcomingSunday();

  btnSubmitAvailability.onclick = async () => {
    const week_start = avWeekStart.value;
    const day_of_week = Number(avDay.value);
    const slot = avSlot.value;
    const note = (avNote.value || null);

    if (!withinDeadline(week_start)) {
      return alert('עבר הדד-ליין להגשת זמינות לשבוע זה (שישי 14:00).');
    }

    // UPSERT זמינות
    const { error } = await supabase.from('availability').upsert({
      employee_id: employeeId, week_start, day_of_week, slot, note
    }, { onConflict: 'employee_id,week_start,day_of_week,slot' });
    if (error) return alert('שגיאה בשמירת זמינות: ' + error.message);
    alert('הזמינות נשמרה ✅');
    await refreshMyShifts();
  };

  refreshMyShifts();
}

async function refreshMyShifts() {
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

// ====== מנהל ======
function bindManager() {
  btnOpenWeek.onclick = async () => {
    const ws = weekStartInp.value;
    if (!ws) return alert('בחר תאריך תחילת שבוע (יום ראשון)');
    const { error } = await supabase.rpc('generate_weekly_roster', { p_week_start: ws });
    if (error) return alert('שגיאה ביצירת שבוע: ' + error.message);
    btnReloadWeek.classList.remove('hidden');
    await loadWeek(ws);
  };
  btnReloadWeek.onclick = async () => {
    if (!weekStartInp.value) return;
    await loadWeek(weekStartInp.value);
  };
}

async function loadWeek(weekStartISO) {
  weekScroller.innerHTML = '';
  const { data: shifts, error } = await supabase
    .from('shifts')
    .select('id, date, slot, planned_start, planned_end')
    .gte('date', weekStartISO)
    .lte('date', addDaysISO(weekStartISO, 6))
    .order('date', { ascending: true })
    .order('slot', { ascending: true });
  if (error) {
    weekScroller.innerHTML = `<div class="text-red-600 p-3">${error.message}</div>`;
    return;
  }

  const byDay = new Map();
  shifts?.forEach(s => {
    if (!byDay.has(s.date)) byDay.set(s.date, { date: s.date, slots: { lunch: null, dinner: null, long: null } });
    byDay.get(s.date).slots[s.slot] = s;
  });

  const ordered = [];
  for (let i = 0; i < 7; i++) { if (i === 5) continue; ordered.push(addDaysISO(weekStartISO, i)); }

  for (const d of ordered) {
    const dayData = byDay.get(d) || { date: d, slots: { lunch: null, dinner: null, long: null } };
    weekScroller.appendChild(await renderDayColumn(dayData, weekStartISO));
  }
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

  // 1) הצג שיבוצים קיימים
  await refreshAssignmentsUI(listEl, shiftRow.id);

  // 2) עובדים זמינים לאותה משבצת
  const available = await fetchAvailableEmployees(dayData.date, slot);
  selEl.innerHTML = '';
  if (!available.length) {
    selEl.innerHTML = `<option>אין עובדים זמינים</option>`;
    selEl.disabled = true; btnEl.disabled = true;
  } else {
    available.forEach(e => {
      const o = document.createElement('option');
      o.value = e.id; o.textContent = e.full_name;
      selEl.appendChild(o);
    });
    selEl.disabled = false; btnEl.disabled = false;
  }

  // 3) שבץ עובד שנשלחה זמינות שלו
  btnEl.onclick = async () => {
    const employee_id = selEl.value;
    if (!employee_id) return;
    const start_time = shiftRow.planned_start || '11:00';
    const end_time   = shiftRow.planned_end   || '17:00';
    const { error } = await supabase.from('shift_assignments').insert({
      shift_id: shiftRow.id, employee_id, status:'planned', role:'other', start_time, end_time
    });
    if (error) return alert('שגיאת שיבוץ: ' + error.message);
    await refreshAssignmentsUI(listEl, shiftRow.id);
  };

  // 4) הוספת עובד חופשי + שיבוץ
  qaBtn.onclick = async () => {
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
    await refreshAssignmentsUI(listEl, shiftRow.id);
  };

  // 5) ניהול זמינות למשבצת (מנהל יכול להוסיף/להסיר זמינות לכל עובד)
  availBtn.onclick = async () => {
    await openAvailManager(dayData.date, slot, weekStartISO);
  };
}

async function refreshAssignmentsUI(listEl, shift_id) {
  listEl.innerHTML = '';
  const { data: rows, error } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, employee:employee_id(id, full_name, phone, address, driver_license_verified)')
    .eq('shift_id', shift_id)
    .order('start_time');
  if (error) return (listEl.innerHTML = `<div class="text-red-600">${error.message}</div>`);
  if (!rows?.length) return (listEl.innerHTML = `<div class="kicker">אין שיבוצים למשבצת זו.</div>`);

  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'assigned-row';

    const left = document.createElement('div');
    const empBtn = document.createElement('button');
    empBtn.className = 'emp-link';
    empBtn.textContent = r.employee?.full_name || '—';
    empBtn.onclick = () => openEmployeeCard(r.employee?.id);
    const info = document.createElement('div');
    info.className = 'text-xs text-gray-600';
    info.textContent = `שעות: ${r.start_time?.slice(0,5)}–${r.end_time?.slice(0,5)}`;
    left.appendChild(empBtn); left.appendChild(info);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'הסר';
    delBtn.onclick = async () => {
      if (!confirm(`להסיר את ${r.employee?.full_name || ''} מהמשמרת?`)) return;
      const { error: derr } = await supabase.from('shift_assignments').delete().eq('id', r.id);
      if (derr) return alert('שגיאת הסרה: ' + derr.message);
      await refreshAssignmentsUI(listEl, shift_id);
    };

    const wrap = document.createElement('div');
    wrap.className = 'flex items-center justify-between w-full';
    wrap.appendChild(left); wrap.appendChild(delBtn);
    row.appendChild(wrap);
    listEl.appendChild(row);
  });
}

async function fetchAvailableEmployees(isoDate, slot) {
  const dow = dayIndexFromISO(isoDate);
  const ws = weekStartFromISO(isoDate);

  const { data, error } = await supabase
    .from('availability')
    .select('employee_id, employees:employee_id(id, full_name)')
    .eq('week_start', ws).eq('day_of_week', dow).eq('slot', slot);
  if (error) { console.error(error); return []; }

  const ids = [...new Set((data||[]).map(r => r.employee_id))];
  if (!ids.length) return [];

  const { data: emps, error: e2 } = await supabase
    .from('employees')
    .select('id, full_name, active')
    .in('id', ids).eq('active', true)
    .order('full_name');
  if (e2) { console.error(e2); return []; }
  return emps || [];
}

// ====== ניהול זמינות (מודל) ======
let _availCtx = null;
async function openAvailManager(isoDate, slot, weekStartISO) {
  _availCtx = { isoDate, slot, ws: weekStartISO };
  availTitle.textContent = `ניהול זמינות · ${new Date(isoDate).toLocaleDateString('he-IL',{weekday:'long', day:'2-digit',month:'2-digit'})} · ${slotName(slot)}`;
  availBody.innerHTML = '<div class="kicker">טוען…</div>';

  // כל העובדים הפעילים
  const { data: employees, error: e1 } = await supabase
    .from('employees').select('id, full_name, active').eq('active', true).order('full_name');
  if (e1) { availBody.innerHTML = `<div class="text-red-600">${e1.message}</div>`; return; }

  // זמינות קיימת ליום/סלוט
  const dow = dayIndexFromISO(isoDate);
  const { data: av, error: e2 } = await supabase
    .from('availability')
    .select('employee_id')
    .eq('week_start', weekStartISO).eq('day_of_week', dow).eq('slot', slot);
  if (e2) { availBody.innerHTML = `<div class="text-red-600">${e2.message}</div>`; return; }
  const availSet = new Set(av.map(x => x.employee_id));

  // UI
  availBody.innerHTML = '';
  employees.forEach(emp => {
    const row = document.createElement('label');
    row.className = 'assigned-row';
    row.innerHTML = `
      <div class="flex items-center gap-2">
        <input type="checkbox" class="av-chk" data-id="${emp.id}" ${availSet.has(emp.id)?'checked':''}/>
        <span>${emp.full_name}</span>
      </div>
    `;
    availBody.appendChild(row);
  });

  availModal.showModal();
}

btnSaveAvail.onclick = async () => {
  if (!_availCtx) return availModal.close();
  const { isoDate, slot, ws } = _availCtx;
  const dow = dayIndexFromISO(isoDate);
  // אוסף בחירות
  const chks = [...availBody.querySelectorAll('.av-chk')];
  const toKeep = new Set(chks.filter(c=>c.checked).map(c=>c.getAttribute('data-id')));

  // שליפת מצב נוכחי
  const { data: cur } = await supabase
    .from('availability')
    .select('employee_id')
    .eq('week_start', ws).eq('day_of_week', dow).eq('slot', slot);
  const curSet = new Set(cur?.map(x=>String(x.employee_id)) || []);

  // חישוב פעולות
  const toInsert = [...toKeep].filter(id => !curSet.has(String(id)));
  const toDelete = [...curSet].filter(id => !toKeep.has(String(id)));

  if (toInsert.length) {
    const rows = toInsert.map(id => ({ employee_id: id, week_start: ws, day_of_week: dow, slot }));
    const { error } = await supabase.from('availability').insert(rows);
    if (error) return alert('שגיאת שמירה: ' + error.message);
  }
  if (toDelete.length) {
    const { error } = await supabase
      .from('availability')
      .delete()
      .eq('week_start', ws).eq('day_of_week', dow).eq('slot', slot)
      .in('employee_id', toDelete);
    if (error) return alert('שגיאת מחיקה: ' + error.message);
  }

  availModal.close();
  alert('נשמר ✅');
};

// ====== כרטיס עובד ======
async function openEmployeeCard(employeeId) {
  if (!employeeId) return;
  const { data: e, error } = await supabase
    .from('employees')
    .select('full_name, phone, address, driver_license_verified, active')
    .eq('id', employeeId)
    .maybeSingle();
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

// ====== Utils ======
function slotName(s){ return s==='lunch'?'צהריים':(s==='dinner'?'ערב':'ארוכה'); }
function statusName(s){ return {planned:'מתוכנן',confirmed:'מאושר',canceled:'מבוטל'}[s]||s; }
function isoOfUpcomingSunday(){
  const d=new Date(); const day=(d.getDay()+0)%7; // 0=ראשון ב-JS
  const sun=new Date(d.getFullYear(),d.getMonth(),d.getDate()-day);
  const z=sun.getTimezoneOffset()*60000; return new Date(sun - z).toISOString().slice(0,10);
}
function addDaysISO(iso, days){
  const d = new Date(iso+'T00:00:00'); d.setDate(d.getDate()+days);
  const z=d.getTimezoneOffset()*60000; return new Date(d - z).toISOString().slice(0,10);
}
function dayIndexFromISO(iso){ return new Date(iso+'T00:00:00').getDay(); } // 0=ראשון
function weekStartFromISO(iso){
  const d = new Date(iso+'T00:00:00');
  const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
  const z=sun.getTimezoneOffset()*60000; return new Date(sun - z).toISOString().slice(0,10);
}
function withinDeadline(weekStartISO){
  const ws = new Date(weekStartISO+'T00:00:00');
  const friday = new Date(ws); friday.setDate(ws.getDate()-2); friday.setHours(14,0,0,0);
  return new Date() <= friday;
}

// ====== Auto init ======
(async () => {
  const { data:{ user } } = await supabase.auth.getUser();
  if (user) afterAuth();
})();
