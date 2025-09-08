// app.js – אפליקציה מלאה עם לוגין, טיוטת שבוע, גלילה אופקית, סינון זמינות,
// שיבוץ/עריכה/הסרה, תצוגת יום (שעה -> רשימת עובדים) והגשת זמינות לעובד.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ===== Supabase Client (schema: shifts) =====
const SUPABASE_URL = window.__SUPABASE_URL__;
const SUPABASE_ANON = window.__SUPABASE_ANON_KEY__;
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { db: { schema: 'shifts' } });
window.supa = supabase; // דיבוג

// ===== Elements =====
const authSection = document.getElementById('authSection');
const employeeSection = document.getElementById('employeeSection');
const managerSection = document.getElementById('managerSection');
const whoami = document.getElementById('whoami');
const btnSignOut = document.getElementById('btnSignOut');
const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passInput = document.getElementById('password');

// Manager controls
const wkWeekStart = document.getElementById('wkWeekStart');
const btnCreateDraftWeek = document.getElementById('btnCreateDraftWeek');
const btnPublishWeek = document.getElementById('btnPublishWeek');
const btnDeleteWeek = document.getElementById('btnDeleteWeek');
const daysScroller = document.getElementById('daysScroller');

const mgrDate = document.getElementById('mgrDate');
const mgrSlot = document.getElementById('mgrSlot');
const mgrEmployee = document.getElementById('mgrEmployee');
const mgrStart = document.getElementById('mgrStart');
const mgrEnd = document.getElementById('mgrEnd');
const mgrVehicle = document.getElementById('mgrVehicle');
const btnAssign = document.getElementById('btnAssign');
const adHocName = document.getElementById('adHocName');
const btnAddAdHoc = document.getElementById('btnAddAdHoc');
const dayTitle = document.getElementById('dayTitle');
const dayGrid = document.getElementById('dayGrid');
const btnPrevDay = document.getElementById('btnPrevDay');
const btnNextDay = document.getElementById('btnNextDay');

// Employee controls
const avWeekStart = document.getElementById('avWeekStart');
const avDay = document.getElementById('avDay');
const avSlot = document.getElementById('avSlot');
const avNote = document.getElementById('avNote');
const btnSubmitAvailability = document.getElementById('btnSubmitAvailability');
const myShiftsBox = document.getElementById('myShifts');

// ===== State =====
let currentUser = null;
let currentRole = null; // 'manager' | 'employee'
let currentWeekStartISO = null;
let currentDayISO = null;
let vehiclesCache = [];

// ===== Helpers =====
const fmtISO = (d) => d.toISOString().slice(0,10);
function tzISO(dateLike) {
  // מחזיר yyyy-mm-dd לפי אזור זמן מקומי
  const d = new Date(dateLike);
  const z = d.getTimezoneOffset()*60000;
  return new Date(d - z).toISOString().slice(0,10);
}
function upcomingSundayISO() {
  const d = new Date();
  // בישראל: 0=ראשון
  const day = d.getDay(); // 0..6
  const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return tzISO(sunday);
}
function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return tzISO(d);
}
function dayNameHe(iso) {
  return new Date(iso+'T00:00:00').toLocaleDateString('he-IL', { weekday:'long', day:'2-digit', month:'2-digit' });
}
function timeToMinutes(hhmm) { const [h,m]=hhmm.split(':').map(Number); return h*60+m; }
function uniqueBy(arr, keyFn) {
  const s = new Set(); const out=[];
  for (const x of arr) { const k=keyFn(x); if (!s.has(k)) { s.add(k); out.push(x); } }
  return out;
}
function withinDeadline(weekStartISO){
  const ws = new Date(weekStartISO+'T00:00:00');
  const deadline = new Date(ws);
  deadline.setDate(deadline.getDate()-2); // שישי לפני
  deadline.setHours(14,0,0,0);
  return new Date() <= deadline;
}

// ===== Auth =====
loginForm?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = (emailInput.value || '').trim();
  const password = passInput.value || '';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { alert('שגיאת התחברות: ' + error.message); return; }
  await afterAuth();
});

btnSignOut?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

async function afterAuth() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  currentUser = user;
  whoami.classList.remove('hidden');
  whoami.textContent = user.email || user.id;
  btnSignOut.classList.remove('hidden');
  authSection.classList.add('hidden');

  // תפקיד
  const { data: prof, error } = await supabase
    .from('user_profiles')
    .select('app_role, employee_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) { alert('שגיאת פרופיל: ' + error.message); return; }

  currentRole = prof?.app_role === 'manager' ? 'manager' : 'employee';

  if (currentRole === 'manager') {
    await initManager();
  } else {
    await initEmployee(prof?.employee_id);
  }
}

// ===== Employee =====
async function initEmployee(employeeId) {
  employeeSection.classList.remove('hidden');
  managerSection.classList.add('hidden');

  avWeekStart.value = upcomingSundayISO();
  btnSubmitAvailability.onclick = async () => {
    const week_start = avWeekStart.value;
    const day_of_week = +avDay.value;
    const slot = avSlot.value;
    const note = avNote.value || null;
    if (!withinDeadline(week_start)) return alert('עבר הדד-ליין לשבוע זה.');
    const { error } = await supabase.from('availability').insert({ employee_id: employeeId, week_start, day_of_week, slot, note });
    if (error) return alert('שגיאה בשמירת זמינות: ' + error.message);
    avNote.value = '';
    alert('נשמר ✅');
    await refreshMyShifts();
  };

  await refreshMyShifts();
}

async function refreshMyShifts() {
  myShiftsBox.innerHTML = '<div class="text-gray-500">טוען…</div>';
  const { data, error } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, role, status, vehicle:vehicle_id(code), shift:shift_id(date, slot)')
    .order('start_time');
  if (error) { myShiftsBox.innerHTML = `<div class="text-red-600">${error.message}</div>`; return; }
  if (!data?.length) { myShiftsBox.innerHTML = '<div class="text-gray-500">אין שיבוצים להצגה.</div>'; return; }
  myShiftsBox.innerHTML = '';
  for (const r of data) {
    const day = new Date(r.shift.date).toLocaleDateString('he-IL', { weekday:'long', day:'2-digit', month:'2-digit' });
    const box = document.createElement('div');
    box.className = 'p-3 bg-white rounded-xl shadow flex items-center justify-between';
    box.innerHTML = `
      <div>
        <div class="font-semibold">${day} · ${slotName(r.shift.slot)} ${r.vehicle?.code?('· רכב '+r.vehicle.code):''}</div>
        <div class="text-gray-600">שעות: ${r.start_time?.slice(0,5)}–${r.end_time?.slice(0,5)}</div>
      </div>
      <span class="chip">${statusName(r.status)}</span>`;
    myShiftsBox.appendChild(box);
  }
}

// ===== Manager =====
async function initManager() {
  managerSection.classList.remove('hidden');
  employeeSection.classList.add('hidden');

  // ברירות מחדל
  currentWeekStartISO = upcomingSundayISO();
  wkWeekStart.value = currentWeekStartISO;
  mgrDate.value = currentWeekStartISO;
  currentDayISO = mgrDate.value;

  await loadVehicles();
  await createOrLoadDraftWeek(); // יוצר/טוען טיוטה + ימי שבוע + משמרת בסיס
  await renderDayList();
  await loadAvailableEmployeesForDaySlot(); // סינון לפי זמינות

  // אירועים
  btnCreateDraftWeek.onclick = async () => { currentWeekStartISO = wkWeekStart.value; await createOrLoadDraftWeek(); await renderDayList(); setSelectedDay(currentWeekStartISO); };
  btnDeleteWeek.onclick = async () => { await deleteWeek(); };
  btnPublishWeek.onclick = async () => { await publishWeek(); };

  mgrDate.onchange = async () => { currentDayISO = mgrDate.value; await renderDayList(); await loadAvailableEmployeesForDaySlot(); };
  mgrSlot.onchange = async () => { await loadAvailableEmployeesForDaySlot(); };

  btnAssign.onclick = async () => { await assignSelected(); };
  btnAddAdHoc.onclick = async () => { await addAdHocEmployee(); };

  btnPrevDay.onclick = () => { shiftDay(-1); };
  btnNextDay.onclick = () => { shiftDay(1); };
}

async function loadVehicles() {
  const { data, error } = await supabase.from('vehicles').select('id, code').eq('active', true).order('code');
  if (!error && data) vehiclesCache = data; else vehiclesCache = [];
  mgrVehicle.innerHTML = '<option value="">—</option>' + vehiclesCache.map(v => `<option value="${v.id}">${v.code}</option>`).join('');
}

async function createOrLoadDraftWeek() {
  // RPC/Upsert: generate_weekly_roster(p_week_start) – אם יש, יחזיר; אם אין, ייצור
  const { error } = await supabase.rpc('generate_weekly_roster', { p_week_start: currentWeekStartISO });
  if (error) console.warn('generate_weekly_roster:', error.message);

  // משוך שוב לוודא קיום
  const { data: roster, error: rErr } = await supabase
    .from('weekly_rosters')
    .select('id, week_start, status')
    .eq('week_start', currentWeekStartISO).maybeSingle();
  if (rErr) { alert('שגיאה בטעינת שבוע: ' + rErr.message); return; }
  if (!roster) { alert('לא נמצאה טיוטת שבוע (בדוק פונקציית RPC).'); return; }
}

async function deleteWeek() {
  if (!confirm('למחוק את השבוע והמשמרות?')) return;
  const { error } = await supabase.from('weekly_rosters').delete().eq('week_start', currentWeekStartISO);
  if (error) return alert('שגיאה במחיקה: ' + error.message);
  alert('השבוע נמחק.');
  // אפס תצוגה
  daysScroller.innerHTML = '';
  dayGrid.innerHTML = '<div class="text-gray-500">אין נתונים.</div>';
}

async function publishWeek() {
  // דוגמא: עדכון סטטוס ל-published
  const { error } = await supabase.from('weekly_rosters').update({ status: 'published' }).eq('week_start', currentWeekStartISO);
  if (error) return alert('שגיאה בפרסום: ' + error.message);
  alert('השבוע פורסם ✅');
}

async function renderDayList() {
  // בנה 6 ימי עבודה (א- ה, שבת) בלי שישי
  const days = [0,1,2,3,4,6].map(i => addDays(currentWeekStartISO, i));
  daysScroller.innerHTML = '';
  for (const iso of days) {
    const btn = document.createElement('button');
    btn.className = 'px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 whitespace-nowrap';
    btn.textContent = dayNameHe(iso);
    if (iso === currentDayISO) btn.classList.add('ring-2','ring-blue-400');
    btn.onclick = () => { setSelectedDay(iso); };
    daysScroller.appendChild(btn);
  }
  await renderDayAssignments(currentDayISO);
}

function setSelectedDay(iso) {
  currentDayISO = iso;
  mgrDate.value = iso;
  renderDayList();
  loadAvailableEmployeesForDaySlot();
}

function shiftDay(step) {
  const allowed = [0,1,2,3,4,6]; // בלי שישי
  const base = [0,1,2,3,4,6].map(i => addDays(currentWeekStartISO, i));
  let idx = base.indexOf(currentDayISO);
  if (idx === -1) idx = 0;
  idx = Math.max(0, Math.min(base.length-1, idx+step));
  setSelectedDay(base[idx]);
}

// רשימת עובדים זמינים (לפי זמינות)
async function loadAvailableEmployeesForDaySlot() {
  mgrEmployee.innerHTML = '';
  const date = mgrDate.value;
  const slot = mgrSlot.value;

  // יום בשבוע: 0=ראשון...
  const weekday = new Date(date + 'T00:00:00').getDay(); // 0..6
  const mapSunday0 = weekday; // בהתאם ליצירה

  const { data, error } = await supabase
    .from('availability')
    .select('employee_id, employees!inner(id, full_name, active)')
    .eq('week_start', currentWeekStartISO)
    .eq('day_of_week', mapSunday0)
    .eq('slot', slot);
  if (error) { mgrEmployee.innerHTML = '<option>שגיאה</option>'; return; }

  const actives = (data||[])
    .map(r => r.employees)
    .filter(e => e?.active);

  // ביטול כפילויות
  const uniq = uniqueBy(actives, e => e.id);

  if (!uniq.length) {
    mgrEmployee.innerHTML = '<option value="">אין עובדים זמינים למשבצת</option>';
  } else {
    mgrEmployee.innerHTML = uniq.map(e => `<option value="${e.id}">${e.full_name}</option>`).join('');
  }
}

// שיבוץ עובד
async function assignSelected() {
  const date = mgrDate.value;
  const slot = mgrSlot.value;
  const employee_id = mgrEmployee.value;
  const start_time = mgrStart.value;
  const end_time = mgrEnd.value;
  const vehicle_id = mgrVehicle.value || null;

  if (!date || !slot || !employee_id) return alert('בחר תאריך/משבצת/עובד');

  // ודא שמשמרת קיימת לתאריך+סלוט
  const { data: shiftRow, error: sErr } = await supabase
    .from('shifts')
    .select('id')
    .eq('date', date).eq('slot', slot)
    .maybeSingle();
  if (sErr) return alert('שגיאה בחיפוש משמרת: ' + sErr.message);
  if (!shiftRow) return alert('לא נמצאה משמרת – צור שבוע/משמרות');

  // מניעת כפילויות לוגיות: עובד כבר שובץ לאותה משמרת?
  const { data: dup, error: dErr } = await supabase
    .from('shift_assignments')
    .select('id')
    .eq('shift_id', shiftRow.id)
    .eq('employee_id', employee_id)
    .limit(1);
  if (dErr) return alert('שגיאת בדיקת כפילות: ' + dErr.message);
  if (dup && dup.length) return alert('העובד כבר שובץ למשמרת זו.');

  const { error } = await supabase.from('shift_assignments').insert({
    shift_id: shiftRow.id, employee_id, start_time, end_time, vehicle_id, status: 'planned'
  });
  if (error) return alert('שגיאה בשיבוץ: ' + error.message);

  await renderDayAssignments(date);
  alert('שובץ ✅');
}

// הוספת עובד חופשי (שם חופשי) ואז ניתן לשבץ
async function addAdHocEmployee() {
  const name = (adHocName.value || '').trim();
  if (!name) return;
  const { data, error } = await supabase.from('employees').insert({ full_name: name, active: true }).select('id');
  if (error) return alert('שגיאה בהוספה: ' + error.message);
  adHocName.value = '';
  await loadAvailableEmployeesForDaySlot(); // יופיע רק אם יסמן זמינות; אם רוצים לשבץ בלי זמינות, בעתיד נוכל לאפשר "כל העובדים".
  alert('עובד נוצר ✅ – ספק זמינות כדי שיופיע לבחירה.');
}

// תצוגת יום: שורה לכל שעה עם רשימת שמות (לפי זמן התחלה של השיבוץ)
async function renderDayAssignments(dateISO) {
  dayTitle.textContent = dayNameHe(dateISO);
  dayGrid.innerHTML = '<div class="text-gray-500">טוען…</div>';

  // גלה את כל המשבצות של אותו יום
  const { data: shiftsRows, error: sErr } = await supabase
    .from('shifts')
    .select('id, slot, planned_start, planned_end')
    .eq('date', dateISO);
  if (sErr) { dayGrid.innerHTML = `<div class="text-red-600">${sErr.message}</div>`; return; }
  if (!shiftsRows?.length) { dayGrid.innerHTML = '<div class="text-gray-500">אין משמרות ביום זה.</div>'; return; }

  // משוך שיבוצים לכל המשמרות של היום
  const shiftIds = shiftsRows.map(s => s.id);
  const { data: assigns, error } = await supabase
    .from('shift_assignments')
    .select(`
      id, start_time, end_time, status,
      employee:employee_id(id, full_name),
      vehicle:vehicle_id(code),
      shift:shift_id(id, slot)
    `)
    .in('shift_id', shiftIds);
  if (error) { dayGrid.innerHTML = `<div class="text-red-600">${error.message}</div>`; return; }

  // בטל כפילויות שגויות (במידה ונוצרו)
  const dedup = uniqueBy(assigns || [], a => `${a.shift.id}::${a.employee?.id}`);

  // קיימות שעות מ-10:00 עד 24:00 – לפי הצורך
  const hours = Array.from({ length: 15 }, (_,i) => 10+i); // 10..24
  dayGrid.innerHTML = '';
  for (const hour of hours) {
    const hStr = `${String(hour).padStart(2,'0')}:00`;

    // מי מתחיל בשעה זו?
    const atHour = dedup
      .filter(a => a.start_time?.slice(0,2) === String(hour).padStart(2,'0'))
      .sort((a,b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

    const row = document.createElement('div');
    row.className = 'flex items-center justify-between rounded-xl border p-3';

    const left = document.createElement('div');
    left.className = 'font-bold text-gray-700';
    left.textContent = hStr;

    const right = document.createElement('div');
    if (!atHour.length) {
      right.innerHTML = `<span class="text-gray-400 text-sm">—</span>`;
    } else {
      // שמות + כפתורי עריכה/הסרה
      for (const a of atHour) {
        const pill = document.createElement('div');
        pill.className = 'inline-flex items-center gap-2 bg-blue-50 text-blue-800 rounded-full px-3 py-1 ml-2';
        const name = a.employee?.full_name || '—';
        pill.innerHTML = `
          <span class="font-semibold">${name}</span>
          <span class="text-xs text-blue-700">${a.start_time?.slice(0,5)}–${a.end_time?.slice(0,5)}</span>
          <button class="text-xs underline text-blue-700" data-action="edit" data-id="${a.id}">ערוך</button>
          <button class="text-xs underline text-red-600" data-action="remove" data-id="${a.id}">הסר</button>`;
        right.appendChild(pill);
      }
    }

    row.appendChild(right);
    row.appendChild(left);
    dayGrid.appendChild(row);
  }

  // האזנה לכפתורי עריכה/הסרה
  dayGrid.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      const id = ev.currentTarget.getAttribute('data-id');
      const action = ev.currentTarget.getAttribute('data-action');
      if (action === 'remove') {
        if (!confirm('להסיר שיבוץ?')) return;
        const { error: delErr } = await supabase.from('shift_assignments').delete().eq('id', id);
        if (delErr) return alert('שגיאת הסרה: ' + delErr.message);
        await renderDayAssignments(dateISO);
      } else if (action === 'edit') {
        const newStart = prompt('שעת התחלה (HH:MM):', '11:00');
        if (!newStart) return;
        const newEnd = prompt('שעת סיום (HH:MM):', '17:00');
        if (!newEnd) return;
        const { error: uErr } = await supabase.from('shift_assignments').update({ start_time: newStart, end_time: newEnd }).eq('id', id);
        if (uErr) return alert('שגיאת עדכון: ' + uErr.message);
        await renderDayAssignments(dateISO);
      }
    });
  });
}

// ===== Utils (labels) =====
function slotName(s) { return s==='lunch'?'צהריים':(s==='dinner'?'ערב':'ארוכה'); }
function statusName(s){ return {planned:'טיוטה',confirmed:'מאושר',canceled:'מבוטל', published:'פורסם'}[s]||s; }

// ===== Auto-init if logged-in =====
(async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    whoami.classList.remove('hidden'); whoami.textContent = user.email || user.id;
    btnSignOut.classList.remove('hidden');
    authSection.classList.add('hidden');
    await afterAuth();
  }
})();
