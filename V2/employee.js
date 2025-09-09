// employee.js  (טעינה כ-module יחיד!)
// ----- קונפיגורציה -----
const SUPABASE_URL  = window.__SUPABASE_URL__  || 'https://uzaqpwbejceyuhnmfdmq.supabase.co';
const SUPABASE_ANON = window.__SUPABASE_ANON__ || 'PASTE_YOUR_ANON_KEY_HERE';

// ----- Supabase client (ESM) -----
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { db: { schema: 'shifts' } });

// ----- אלמנטים -----
const loginCard   = document.getElementById('loginCard');
const panel       = document.getElementById('employeePanel');
const whoami      = document.getElementById('whoami');
const btnSignOut  = document.getElementById('btnSignOut');

const btnLogin    = document.getElementById('btnLogin');
const btnSave     = document.getElementById('btnSaveAvailability');
const btnClear    = document.getElementById('btnClear');
const btnRefresh  = document.getElementById('btnRefresh');

const inpWeek     = document.getElementById('avWeekStart');
const selDay      = document.getElementById('avDay');
const selSlot     = document.getElementById('avSlot');
const inpNote     = document.getElementById('avNote');
const listBox     = document.getElementById('myAvailList');

// ----- מצב לקוח -----
let employee = null; // { id, full_name, phone, ... }

// ----- עזרי תאריכים -----
function tzISODate(d) {
  const z = d.getTimezoneOffset() * 60000;
  return new Date(d - z).toISOString().slice(0, 10);
}
function upcomingSundayISO() {
  const d = new Date();
  // בישראל: נחשב "ראשון הקרוב/נוכחי"
  const weekday = (d.getDay() + 6) % 7; // 0=ראשון
  const diff = -weekday; // חזרה לראשון הנוכחי
  const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return tzISODate(sunday);
}
const dayName = (i) => ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][i] || i;
const slotName = (s) => ({ lunch:'צהריים', dinner:'ערב', long:'ארוכה' }[s] || s);

// ===== התחברות/התנתקות =====
btnLogin.addEventListener('click', login);
btnSignOut.addEventListener('click', signOut);

async function login() {
  const username = (document.getElementById('username').value || '').trim();
  const password = (document.getElementById('password').value || '').trim();
  if (!username || !password) {
    alert('נא למלא שם משתמש וסיסמה');
    return;
  }

  // חיפוש בטבלת האישורים (ללא RLS של Supabase Auth)
  const { data: cred, error } = await supabase
    .from('employee_credentials')
    .select('id, employee_id')
    .eq('username', username)
    .eq('password', password)
    .maybeSingle();

  if (error) {
    alert('שגיאה בכניסה: ' + error.message);
    return;
  }
  if (!cred) {
    alert('שם משתמש או סיסמה אינם נכונים');
    return;
  }

  // שליפת פרטי העובד
  const { data: emp, error: e2 } = await supabase
    .from('employees')
    .select('id, full_name, phone')
    .eq('id', cred.employee_id)
    .maybeSingle();
  if (e2 || !emp) {
    alert('לא נמצאו פרטי עובד');
    return;
  }

  employee = emp;
  localStorage.setItem('employee_id', employee.id);
  localStorage.setItem('employee_name', employee.full_name || '');

  whoami.textContent = employee.full_name || `עובד ${employee.id}`;
  whoami.classList.remove('hidden');
  btnSignOut.classList.remove('hidden');

  loginCard.classList.add('hidden');
  panel.classList.remove('hidden');

  // ברירות מחדל לטופס
  inpWeek.value = upcomingSundayISO();

  await refreshMyAvailabilities();
}

function signOut() {
  employee = null;
  localStorage.removeItem('employee_id');
  localStorage.removeItem('employee_name');
  whoami.classList.add('hidden');
  btnSignOut.classList.add('hidden');
  loginCard.classList.remove('hidden');
  panel.classList.add('hidden');
  // ניקוי
  listBox.innerHTML = '';
}

// Auto-login אם יש זיהוי ב־localStorage
(async function autoLogin() {
  const empId = localStorage.getItem('employee_id');
  const empName = localStorage.getItem('employee_name');
  if (!empId) return;

  // נבדוק שהעובד עדיין קיים/פעיל
  const { data: emp, error } = await supabase
    .from('employees')
    .select('id, full_name, phone, active')
    .eq('id', empId)
    .maybeSingle();

  if (error || !emp || emp.active === false) {
    // נקה מזהה לא חוקי
    localStorage.removeItem('employee_id');
    localStorage.removeItem('employee_name');
    return;
  }

  employee = emp;
  whoami.textContent = emp.full_name || empName || `עובד ${emp.id}`;
  whoami.classList.remove('hidden');
  btnSignOut.classList.remove('hidden');
  loginCard.classList.add('hidden');
  panel.classList.remove('hidden');

  inpWeek.value = upcomingSundayISO();
  await refreshMyAvailabilities();
})();

// ===== שליחת זמינות =====
btnSave.addEventListener('click', saveAvailability);
btnClear.addEventListener('click', clearForm);
btnRefresh.addEventListener('click', refreshMyAvailabilities);

async function saveAvailability() {
  if (!employee?.id) {
    alert('יש להתחבר קודם');
    return;
  }
  const week_start  = inpWeek.value;
  const day_of_week = Number(selDay.value);
  const slot        = selSlot.value;
  const note        = inpNote.value || null;

  if (!week_start) {
    alert('בחר תאריך תחילת שבוע');
    return;
  }

  // מניעת כפילות: ננסה למחוק קודם את הרשומה הקיימת לאותו employee/week/day/slot ואז להכניס
  const { error: dErr } = await supabase
    .from('availability')
    .delete()
    .eq('employee_id', employee.id)
    .eq('week_start', week_start)
    .eq('day_of_week', day_of_week)
    .eq('slot', slot);
  if (dErr && dErr.code !== 'PGRST116') {
    // PGRST116 = no rows deleted, לא חיוני
    console.warn('delete pre-upsert error', dErr);
  }

  const { error } = await supabase
    .from('availability')
    .insert({ employee_id: employee.id, week_start, day_of_week, slot, note });

  if (error) {
    alert('שגיאה בשמירת זמינות: ' + error.message);
    return;
  }
  clearForm();
  await refreshMyAvailabilities();
  alert('הזמינות נשמרה ✅');
}

function clearForm() {
  selDay.value = '0';
  selSlot.value = 'lunch';
  inpNote.value = '';
}

// ===== רשימת הזמינויות שלי =====
async function refreshMyAvailabilities() {
  if (!employee?.id) return;
  listBox.innerHTML = '<div class="text-gray-500">טוען…</div>';

  const today = tzISODate(new Date());

  const { data: rows, error } = await supabase
    .from('availability')
    .select('id, week_start, day_of_week, slot, note, created_at')
    .eq('employee_id', employee.id)
    .gte('week_start', today)        // רק משבוע נוכחי והלאה
    .order('week_start', { ascending: true })
    .order('day_of_week', { ascending: true })
    .order('slot', { ascending: true });

  if (error) {
    listBox.innerHTML = `<div class="text-red-600">${error.message}</div>`;
    return;
  }
  if (!rows?.length) {
    listBox.innerHTML = '<div class="text-gray-500">אין זמינויות להצגה.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  rows.forEach(r => {
    const wrap = document.createElement('div');
    wrap.className = 'p-3 bg-white rounded-xl shadow flex items-center justify-between gap-3';
    const dname = dayName(r.day_of_week);
    const sname = slotName(r.slot);
    wrap.innerHTML = `
      <div>
        <div class="font-semibold">${fmtDate(r.week_start)} · ${dname} · ${sname}</div>
        ${r.note ? `<div class="text-gray-600 text-xs">הערה: ${escapeHtml(r.note)}</div>` : ''}
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-gray text-sm" data-act="edit" data-id="${r.id}">ערוך</button>
        <button class="btn btn-danger text-sm" data-act="del" data-id="${r.id}">מחק</button>
      </div>`;
    frag.appendChild(wrap);
  });
  listBox.innerHTML = '';
  listBox.appendChild(frag);

  // חיבור אירועים
  listBox.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', onAvailAction);
  });
}

async function onAvailAction(ev) {
  const id = ev.currentTarget.getAttribute('data-id');
  const act = ev.currentTarget.getAttribute('data-act');
  const row = await fetchAvailById(id);
  if (!row) return;

  if (act === 'edit') {
    // העמסה לטופס העריכה
    inpWeek.value  = row.week_start;
    selDay.value   = String(row.day_of_week);
    selSlot.value  = row.slot;
    inpNote.value  = row.note || '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (act === 'del') {
    if (!confirm('למחוק את הזמינות הזו?')) return;
    const { error } = await supabase.from('availability').delete().eq('id', id);
    if (error) return alert('שגיאה במחיקה: ' + error.message);
    await refreshMyAvailabilities();
  }
}

async function fetchAvailById(id) {
  const { data, error } = await supabase
    .from('availability')
    .select('id, employee_id, week_start, day_of_week, slot, note')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// ----- עזרי הצגה -----
function fmtDate(iso) {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });
  } catch { return iso; }
}
function escapeHtml(s='') {
  return s.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
