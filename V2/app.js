import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ====== קונפיגורציה – החלף לערכים שלך ======
const SUPABASE_URL = 'https://uzaqpwbejceyuhnmfdmq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6YXFwd2JlamNleXVobm1mZG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyODc3NzMsImV4cCI6MjA3MDg2Mzc3M30.Wcuu97xzFvJCt8x2ubHLwc19-ZsfrRLK9YZHICV3T3A';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: 'shifts' } });
// כדי לדבג מהקונסול:
window.supa = supabase;

// ====== אלמנטים ======
const authSection   = document.getElementById('authSection');
const managerPanel  = document.getElementById('managerPanel');
const whoami        = document.getElementById('whoami');
const btnSignOut    = document.getElementById('btnSignOut');

const weekStartInp  = document.getElementById('weekStart');
const btnOpenWeek   = document.getElementById('btnOpenWeek');
const btnReloadWeek = document.getElementById('btnReloadWeek');
const weekScroller  = document.getElementById('weekScroller');

// מודל עובד
const empModal      = document.getElementById('employeeModal');
const empModalTitle = document.getElementById('empModalTitle');
const empModalBody  = document.getElementById('empModalBody');
document.getElementById('closeEmpModal').onclick = () => empModal.close();

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

  // קביעת תפקיד
  const { data: prof, error: perr } = await supabase
    .from('user_profiles')
    .select('app_role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (perr) return alert('שגיאת פרופיל: ' + perr.message);

  // למנהל נטען את תצוגת השבוע
  if (prof?.app_role === 'manager') {
    managerPanel.classList.remove('hidden');
    weekStartInp.value = isoOfUpcomingSunday();
    bindManager();
  } else {
    alert('כרגע הגרסה הזו מיועדת למנהל בלבד (UI לעובד יגיע בשלב הבא).');
  }
}

function bindManager() {
  btnOpenWeek.onclick = async () => {
    const ws = weekStartInp.value;
    if (!ws) return alert('בחר תאריך תחילת שבוע (יום ראשון)');
    // יצירת שבוע דרך RPC (אם כבר קיים – הפונקציה שלך יכולה לעשות UPSERT)
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

// ====== טעינת שבוע ======
async function loadWeek(weekStartISO) {
  weekScroller.innerHTML = '';

  // שולף את המשמרות שנוצרו לשבוע הזה
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

  // בונים מבנה: dayIndex -> {date, shiftsBySlot}
  const byDay = new Map(); // key: yyyy-mm-dd
  shifts?.forEach(s => {
    if (!byDay.has(s.date)) byDay.set(s.date, { date: s.date, slots: { lunch: null, dinner: null, long: null } });
    byDay.get(s.date).slots[s.slot] = s;
  });

  // מסדרים לפי ימים מהראשון עד שבת (חמישי=4, שישי אין, שבת=6)
  const ordered = [];
  for (let i = 0; i < 7; i++) {
    if (i === 5) continue; // שישי סגור
    const d = addDaysISO(weekStartISO, i);
    ordered.push(d);
  }

  for (const d of ordered) {
    const dayData = byDay.get(d) || { date: d, slots: { lunch: null, dinner: null, long: null } };
    weekScroller.appendChild(renderDayColumn(dayData));
  }
}

// ====== יצירת עמודת יום ======
function renderDayColumn(dayData) {
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

  // שלושת המשבצות
  ['lunch','dinner','long'].forEach(slot => {
    renderShiftBox(col.querySelector(`[data-slot="${slot}"]`), dayData, slot);
  });

  return col;
}

// ====== משבצת: הצגה + פעולות ======
async function renderShiftBox(container, dayData, slot) {
  container.innerHTML = `
    <div class="shift-title">
      <span>${slotName(slot)}</span>
    </div>
    <div class="assigned-list"></div>
    <div class="mt-2 flex items-center gap-2">
      <select class="input grow assign-select" disabled></select>
      <button class="btn btn-primary assign-btn" disabled>שבץ</button>
    </div>
  `;

  const listEl = container.querySelector('.assigned-list');
  const selEl  = container.querySelector('.assign-select');
  const btnEl  = container.querySelector('.assign-btn');

  // משבצת קיימת?
  const shiftRow = dayData.slots[slot];
  if (!shiftRow) {
    listEl.innerHTML = `<div class="kicker">אין משמרת קיימת ליום/סלוט – צור שבוע.</div>`;
    return;
  }

  // 1) טען שיבוצים קיימים לאותה משמרת
  await refreshAssignmentsUI(listEl, shiftRow.id);

  // 2) טען עובדים זמינים למשבצת זו (לפי availability)
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

  // 3) שבץ
  btnEl.onclick = async () => {
    const employee_id = selEl.value;
    if (!employee_id) return;

    // ברירת מחדל role='other', שעות מתוכננות לפי המשמרת (אפשר לשנות ידנית אח"כ)
    const start_time = (shiftRow.planned_start || '11:00');
    const end_time   = (shiftRow.planned_end   || '17:00');

    const { error } = await supabase.from('shift_assignments').insert({
      shift_id: shiftRow.id,
      employee_id,
      status: 'planned',
      role: 'other',
      start_time,
      end_time
    });
    if (error) return alert('שגיאת שיבוץ: ' + error.message);
    await refreshAssignmentsUI(listEl, shiftRow.id);
  };
}

// טען רשימת שיבוצים והצג עם כפתור הסרה
async function refreshAssignmentsUI(listEl, shift_id) {
  listEl.innerHTML = '';
  const { data: rows, error } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, employee:employee_id(id, full_name, phone, address, driver_license_verified)')
    .eq('shift_id', shift_id)
    .order('start_time');
  if (error) return listEl.innerHTML = `<div class="text-red-600">${error.message}</div>`;
  if (!rows?.length) return listEl.innerHTML = `<div class="kicker">אין שיבוצים למשבצת זו.</div>`;

  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'assigned-row';

    const empBtn = document.createElement('button');
    empBtn.className = 'emp-link';
    empBtn.textContent = r.employee?.full_name || '—';
    empBtn.onclick = () => openEmployeeCard(r.employee?.id);

    const info = document.createElement('div');
    info.className = 'text-xs text-gray-600';
    info.textContent = `שעות: ${r.start_time?.slice(0,5)}–${r.end_time?.slice(0,5)}`;

    const left = document.createElement('div');
    left.appendChild(empBtn);
    left.appendChild(info);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'הסר';
    delBtn.onclick = async () => {
      if (!confirm(`להסיר את ${r.employee?.full_name || ''} מהמשמרת?`)) return;
      const { error: derr } = await supabase.from('shift_assignments').delete().eq('id', r.id);
      if (derr) return alert('שגיאת הסרה: ' + derr.message);
      await refreshAssignmentsUI(listEl, shift_id);
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center justify-between w-full';
    wrapper.appendChild(left);
    wrapper.appendChild(delBtn);

    row.appendChild(wrapper);
    listEl.appendChild(row);
  });
}

// עובדים זמינים במשבצת
async function fetchAvailableEmployees(isoDate, slot) {
  // מחשב day_of_week יחסית לראשון=0
  const dow = dayIndexFromISO(isoDate);

  // צריך את week_start (יום ראשון של אותו שבוע) כדי להתאים ל-availability
  const ws = weekStartFromISO(isoDate);

  // `availability` -> מצטרף לעובדים פעילים
  const { data, error } = await supabase
    .from('availability')
    .select('employee_id, employees:employee_id(id, full_name)')
    .eq('week_start', ws)
    .eq('day_of_week', dow)
    .eq('slot', slot);
  if (error) { console.error(error); return []; }

  // מפה -> מערך ייחודי של עובדים פעילים בלבד
  const ids = [...new Set((data||[]).map(r => r.employee_id))];
  if (!ids.length) return [];

  const { data: emps, error: e2 } = await supabase
    .from('employees')
    .select('id, full_name, active')
    .in('id', ids)
    .eq('active', true)
    .order('full_name');
  if (e2) { console.error(e2); return []; }

  return emps || [];
}

// ====== כרטיס עובד (מודל) ======
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

// ====== עזרים ======
function slotName(s){ return s==='lunch'?'צהריים':(s==='dinner'?'ערב':'ארוכה'); }
function isoOfUpcomingSunday(){
  const d=new Date(); // ראשון=0 בישראל – נתאים
  const day=(d.getDay()+6)%7; const diff=-day; 
  const sun=new Date(d.getFullYear(),d.getMonth(),d.getDate()+diff);
  const z=sun.getTimezoneOffset()*60000; return new Date(sun - z).toISOString().slice(0,10);
}
function addDaysISO(iso, days){
  const d = new Date(iso+'T00:00:00'); d.setDate(d.getDate()+days);
  const z=d.getTimezoneOffset()*60000; return new Date(d - z).toISOString().slice(0,10);
}
function dayIndexFromISO(iso){ // ראשון=0
  const d=new Date(iso+'T00:00:00'); const g=d.getDay(); // 0=Sun
  // בישראל 0=ראשון כבר, אבל ב-JS 0=Sunday (ראשון) – אז נשאיר 0–6, ונחשיב שישי=5, שבת=6
  return g; 
}
function weekStartFromISO(iso){
  const d = new Date(iso+'T00:00:00');
  const g = d.getDay(); // 0=Sun
  const sun = new Date(d); sun.setDate(d.getDate() - g);
  const z=sun.getTimezoneOffset()*60000; return new Date(sun - z).toISOString().slice(0,10);
}

// ====== Auto init ======
(async () => {
  const { data:{ user } } = await supabase.auth.getUser();
  if (user) afterAuth();
})();
