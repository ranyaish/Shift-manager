// app.js – לוגין, טיוטת שבוע, גלילה אופקית, סינון זמינות,
// שיבוץ/עריכה/הסרה, תצוגת יום (שעה -> שמות), הגשת זמינות,
// + חדש: מודאל "ניהול זמינות" למנהל (צ'קבוקסים+הערות לכל העובדים הפעילים),
// + קיים: אפשרות "סמן כזמין" לעובד בודד,
// + תצוגת יום ללא שעות ריקות.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ===== Supabase Client =====
const SUPABASE_URL = window.__SUPABASE_URL__;
const SUPABASE_ANON = window.__SUPABASE_ANON_KEY__;
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { db: { schema: 'shifts' } });
window.supa = supabase; // debug

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

// NEW: show-all toggle + mark-available + manage-availability modal
const chkShowAllEmployees = document.getElementById('chkShowAllEmployees');
const btnMarkAvailable = document.getElementById('btnMarkAvailable');
const btnManageAvailability = document.getElementById('btnManageAvailability');

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
let allActiveEmployeesCache = []; // לכל העובדים הפעילים

// ===== Helpers =====
const fmtISO = (d) => d.toISOString().slice(0,10);
function tzISO(dateLike) { const d=new Date(dateLike); const z=d.getTimezoneOffset()*60000; return new Date(d-z).toISOString().slice(0,10); }
function upcomingSundayISO() {
  const d = new Date(); const day = d.getDay(); // 0=Sunday
  const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return tzISO(sunday);
}
function addDays(iso, days) { const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+days); return tzISO(d); }
function dayNameHe(iso){ return new Date(iso+'T00:00:00').toLocaleDateString('he-IL',{weekday:'long',day:'2-digit',month:'2-digit'}); }
function timeToMinutes(hhmm){ const [h,m]=hhmm.split(':').map(Number); return h*60+m; }
function uniqueBy(arr,keyFn){ const s=new Set(); const out=[]; for(const x of arr){const k=keyFn(x); if(!s.has(k)){s.add(k); out.push(x);}} return out; }
function withinDeadline(weekStartISO){
  const ws=new Date(weekStartISO+'T00:00:00'); const deadline=new Date(ws);
  deadline.setDate(deadline.getDate()-2); deadline.setHours(14,0,0,0);
  return new Date() <= deadline;
}
function slotName(s){ return s==='lunch'?'צהריים':(s==='dinner'?'ערב':'ארוכה'); }
function statusName(s){ return {planned:'טיוטה',confirmed:'מאושר',canceled:'מבוטל',published:'פורסם'}[s]||s; }

// ===== Auth =====
loginForm?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = (emailInput.value||'').trim();
  const password = passInput.value||'';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return alert('שגיאת התחברות: ' + error.message);
  await afterAuth();
});
btnSignOut?.addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });

async function afterAuth() {
  const { data:{ user } } = await supabase.auth.getUser();
  if (!user) return;
  currentUser = user;
  whoami.classList.remove('hidden'); whoami.textContent = user.email || user.id;
  btnSignOut.classList.remove('hidden'); authSection.classList.add('hidden');

  const { data: prof, error } = await supabase.from('user_profiles').select('app_role, employee_id').eq('user_id', user.id).maybeSingle();
  if (error) return alert('שגיאת פרופיל: ' + error.message);
  currentRole = prof?.app_role === 'manager' ? 'manager' : 'employee';
  if (currentRole === 'manager') await initManager(); else await initEmployee(prof?.employee_id);
}

// ===== Employee =====
async function initEmployee(employeeId){
  employeeSection.classList.remove('hidden'); managerSection.classList.add('hidden');
  avWeekStart.value = upcomingSundayISO();
  btnSubmitAvailability.onclick = async () => {
    const week_start = avWeekStart.value;
    const day_of_week = +avDay.value;
    const slot = avSlot.value;
    const note = avNote.value || null;
    if (!withinDeadline(week_start)) return alert('עבר הדד-ליין לשבוע זה.');
    const { error } = await supabase.from('availability').insert({ employee_id: employeeId, week_start, day_of_week, slot, note });
    if (error) return alert('שגיאה בשמירת זמינות: ' + error.message);
    avNote.value=''; alert('נשמר ✅'); await refreshMyShifts();
  };
  await refreshMyShifts();
}

async function refreshMyShifts(){
  myShiftsBox.innerHTML = '<div class="text-gray-500">טוען…</div>';
  const { data, error } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, role, status, vehicle:vehicle_id(code), shift:shift_id(date, slot)')
    .order('start_time');
  if (error) return myShiftsBox.innerHTML = `<div class="text-red-600">${error.message}</div>`;
  if (!data?.length) return myShiftsBox.innerHTML = '<div class="text-gray-500">אין שיבוצים להצגה.</div>';
  myShiftsBox.innerHTML='';
  for (const r of data){
    const day=new Date(r.shift.date).toLocaleDateString('he-IL',{weekday:'long',day:'2-digit',month:'2-digit'});
    const el=document.createElement('div');
    el.className='p-3 bg-white rounded-xl shadow flex items-center justify-between';
    el.innerHTML=`<div>
        <div class="font-semibold">${day} · ${slotName(r.shift.slot)} ${r.vehicle?.code?('· רכב '+r.vehicle.code):''}</div>
        <div class="text-gray-600">שעות: ${r.start_time?.slice(0,5)}–${r.end_time?.slice(0,5)}</div>
      </div>
      <span class="inline-block px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">${statusName(r.status)}</span>`;
    myShiftsBox.appendChild(el);
  }
}

// ===== Manager =====
async function initManager(){
  managerSection.classList.remove('hidden'); employeeSection.classList.add('hidden');
  currentWeekStartISO = upcomingSundayISO(); wkWeekStart.value=currentWeekStartISO;
  mgrDate.value = currentWeekStartISO; currentDayISO = mgrDate.value;

  await loadVehicles();
  await loadAllActiveEmployees();
  await createOrLoadDraftWeek();
  await renderDayList();
  await loadEmployeesForSelector(); // ברירת מחדל: זמינים

  // events
  btnCreateDraftWeek.onclick = async () => {
    currentWeekStartISO = wkWeekStart.value;
    await createOrLoadDraftWeek();
    await renderDayList();
    setSelectedDay(currentWeekStartISO);
  };
  btnDeleteWeek.onclick = async () => { await deleteWeek(); };
  btnPublishWeek.onclick = async () => { await publishWeek(); };

  mgrDate.onchange = async () => { currentDayISO = mgrDate.value; await renderDayList(); await loadEmployeesForSelector(); };
  mgrSlot.onchange = async () => { await loadEmployeesForSelector(); };
  chkShowAllEmployees?.addEventListener('change', async ()=>{ await loadEmployeesForSelector(); });

  btnAssign.onclick = async () => { await assignSelected(); };
  btnAddAdHoc.onclick = async () => { await addAdHocEmployee(); };
  btnMarkAvailable?.addEventListener('click', async ()=>{ await markSelectedAsAvailable(); });
  btnManageAvailability?.addEventListener('click', async ()=>{ await openAvailabilityModal(currentDayISO, mgrSlot.value); });

  btnPrevDay.onclick = () => { shiftDay(-1); };
  btnNextDay.onclick = () => { shiftDay(1); };
}

async function loadVehicles(){
  const { data, error } = await supabase.from('vehicles').select('id, code').eq('active',true).order('code');
  vehiclesCache = !error && data ? data : [];
  mgrVehicle.innerHTML = '<option value="">—</option>' + vehiclesCache.map(v=>`<option value="${v.id}">${v.code}</option>`).join('');
}

async function loadAllActiveEmployees(){
  const { data, error } = await supabase.from('employees').select('id, full_name').eq('active',true).order('full_name');
  allActiveEmployeesCache = !error && data ? data : [];
}

// יצירה/טעינה של טיוטת שבוע
async function createOrLoadDraftWeek(){
  const { error } = await supabase.rpc('generate_weekly_roster', { p_week_start: currentWeekStartISO });
  if (error) console.warn('generate_weekly_roster:', error.message);
  const { data: roster, error: rErr } = await supabase.from('weekly_rosters').select('id').eq('week_start', currentWeekStartISO).maybeSingle();
  if (rErr || !roster) console.warn('weekly roster missing?', rErr?.message);
}

async function deleteWeek(){
  if (!confirm('למחוק את השבוע והמשמרות?')) return;
  const { error } = await supabase.from('weekly_rosters').delete().eq('week_start', currentWeekStartISO);
  if (error) return alert('שגיאה במחיקה: '+error.message);
  alert('השבוע נמחק.'); daysScroller.innerHTML=''; dayGrid.innerHTML='<div class="text-gray-500">אין נתונים.</div>';
}

async function publishWeek(){
  const { error } = await supabase.from('weekly_rosters').update({ status:'published' }).eq('week_start', currentWeekStartISO);
  if (error) return alert('שגיאה בפרסום: '+error.message);
  alert('השבוע פורסם ✅');
}

async function renderDayList(){
  const days = [0,1,2,3,4,6].map(i=>addDays(currentWeekStartISO,i));
  daysScroller.innerHTML='';
  for (const iso of days){
    const btn=document.createElement('button');
    btn.className='px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 whitespace-nowrap';
    btn.textContent=dayNameHe(iso);
    if (iso===currentDayISO) btn.classList.add('ring-2','ring-blue-400');
    btn.onclick=()=>setSelectedDay(iso);
    daysScroller.appendChild(btn);
  }
  await renderDayAssignments(currentDayISO);
}

function setSelectedDay(iso){ currentDayISO=iso; mgrDate.value=iso; renderDayList(); loadEmployeesForSelector(); }
function shiftDay(step){
  const base=[0,1,2,3,4,6].map(i=>addDays(currentWeekStartISO,i));
  let idx=base.indexOf(currentDayISO); if (idx===-1) idx=0;
  idx=Math.max(0,Math.min(base.length-1,idx+step));
  setSelectedDay(base[idx]);
}

// טענת רשימת עובדים לבחירה – זמינים או כל העובדים
async function loadEmployeesForSelector(){
  const date = mgrDate.value;
  const slot = mgrSlot.value;

  if (chkShowAllEmployees?.checked){
    if (!allActiveEmployeesCache.length) await loadAllActiveEmployees();
    if (!allActiveEmployeesCache.length){
      mgrEmployee.innerHTML='<option value="">אין עובדים</option>'; return;
    }
    mgrEmployee.innerHTML = allActiveEmployeesCache.map(e=>`<option value="${e.id}">${e.full_name}</option>`).join('');
    return;
  }

  const weekday = new Date(date+'T00:00:00').getDay(); // 0..6
  const { data, error } = await supabase
    .from('availability')
    .select('employee_id, employees!inner(id, full_name, active)')
    .eq('week_start', currentWeekStartISO)
    .eq('day_of_week', weekday)
    .eq('slot', slot);
  if (error) { mgrEmployee.innerHTML='<option>שגיאה</option>'; return; }

  const actives = (data||[]).map(r=>r.employees).filter(e=>e?.active);
  const uniq = uniqueBy(actives, e=>e.id);
  if (!uniq.length) mgrEmployee.innerHTML='<option value="">אין עובדים זמינים</option>';
  else mgrEmployee.innerHTML = uniq.map(e=>`<option value="${e.id}">${e.full_name}</option>`).join('');
}

// סימון עובד כ"זמין" ע"י המנהל – יוצר רשומת availability לעובד הנבחר
async function markSelectedAsAvailable(){
  const employee_id = mgrEmployee.value;
  if (!employee_id) return alert('בחר עובד כדי לסמן כזמין.');

  const date = mgrDate.value;
  const slot = mgrSlot.value;
  const weekday = new Date(date+'T00:00:00').getDay(); // 0..6
  const week_start = currentWeekStartISO;

  const { data: ex, error: e1 } = await supabase
    .from('availability')
    .select('id').eq('employee_id', employee_id)
    .eq('week_start', week_start).eq('day_of_week', weekday).eq('slot', slot).limit(1);
  if (e1) return alert('שגיאה בבדיקת זמינות: '+e1.message);
  if (ex && ex.length) { alert('העובד כבר מסומן כזמין למשבצת זו.'); return; }

  const { error } = await supabase.from('availability').insert({
    employee_id, week_start, day_of_week: weekday, slot, note: 'סומן ע״י מנהל'
  });
  if (error) return alert('שגיאה בסימון זמינות: '+error.message);
  alert('העובד סומן כזמין ✅');
  await loadEmployeesForSelector();
}

/* ===== Modal: ניהול זמינות מרוכז (לכל העובדים הפעילים) ===== */
function ensureAvailabilityModal(){
  let dlg = document.getElementById('availModalMgr');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'availModalMgr';
  dlg.style.border = 'none';
  dlg.style.borderRadius = '16px';
  dlg.style.maxWidth = '720px';
  dlg.innerHTML = `
    <form method="dialog" style="padding:0; min-width: 560px;">
      <div style="background:#27a3f8; color:#062a3a; padding:10px 14px; font-weight:900" id="availTitleMgr">ניהול זמינות</div>
      <div style="max-height:65vh; overflow:auto; padding:14px" id="availBodyMgr">טוען…</div>
      <div style="background:#f8fafc; padding:10px 14px; display:flex; justify-content:flex-end; gap:8px">
        <button value="cancel" class="rounded-xl px-3 py-2 bg-gray-200">ביטול</button>
        <button id="btnAvailSaveMgr" class="btn-primary rounded-xl px-3 py-2">שמור</button>
      </div>
    </form>
  `;
  document.body.appendChild(dlg);
  return dlg;
}

async function openAvailabilityModal(dateISO, slot){
  const dlg = ensureAvailabilityModal();
  const title = dlg.querySelector('#availTitleMgr');
  const body  = dlg.querySelector('#availBodyMgr');
  const btnSave = dlg.querySelector('#btnAvailSaveMgr');

  title.textContent = `ניהול זמינות · ${dayNameHe(dateISO)} · ${slotName(slot)}`;
  body.innerHTML = 'טוען…';

  // כל העובדים הפעילים
  if (!allActiveEmployeesCache.length) await loadAllActiveEmployees();
  const emps = allActiveEmployeesCache;

  // זמינות קיימת ליום/משבצת
  const wstart = currentWeekStartISO;
  const dow    = new Date(dateISO+'T00:00:00').getDay();
  const { data: av, error: e2 } = await supabase
    .from('availability')
    .select('employee_id, note')
    .eq('week_start', wstart).eq('day_of_week', dow).eq('slot', slot);
  if (e2) { body.innerHTML = `<div class="text-red-600">${e2.message}</div>`; dlg.showModal(); return; }

  const selected = new Set(av.map(x=>String(x.employee_id)));
  const notesMap = new Map(av.map(x=>[String(x.employee_id), x.note || '']));

  // טבלת צ׳קבוקסים + הערות
  body.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'space-y-2';
  emps.forEach(emp=>{
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 rounded-xl border px-3 py-2';
    row.innerHTML = `
      <input type="checkbox" class="av-chk" data-id="${emp.id}" ${selected.has(String(emp.id))?'checked':''}/>
      <div class="grow font-medium">${emp.full_name}</div>
      <input type="text" class="w-64 border rounded-xl px-3 py-1 bg-white av-note" data-id="${emp.id}" placeholder="הערה…" value="${(notesMap.get(String(emp.id))||'').replaceAll('"','&quot;')}"/>
    `;
    wrapper.appendChild(row);
  });
  body.appendChild(wrapper);

  btnSave.onclick = async (ev)=>{
    ev.preventDefault();
    const chks  = [...body.querySelectorAll('.av-chk')];
    const notes = new Map([...body.querySelectorAll('.av-note')].map(i=>[String(i.getAttribute('data-id')), i.value.trim()]));

    const want = new Set(chks.filter(c=>c.checked).map(c=>String(c.getAttribute('data-id'))));
    const cur  = new Set(av.map(x=>String(x.employee_id)));

    const toInsert = [...want].filter(id => !cur.has(id));
    const toDelete = [...cur].filter(id => !want.has(id));
    const toUpdate = [...want].filter(id => cur.has(id) && (notes.get(id) !== (notesMap.get(id)||'')));

    // insert
    if (toInsert.length){
      const rows = toInsert.map(id => ({ employee_id: id, week_start: wstart, day_of_week: dow, slot, note: notes.get(id) || null }));
      const { error } = await supabase.from('availability').insert(rows);
      if (error) { alert(error.message); return; }
    }
    // update notes
    for (const id of toUpdate){
      const { error } = await supabase
        .from('availability').update({ note: notes.get(id) || null })
        .eq('employee_id', id).eq('week_start', wstart).eq('day_of_week', dow).eq('slot', slot);
      if (error) { alert(error.message); return; }
    }
    // delete
    if (toDelete.length){
      const { error } = await supabase
        .from('availability').delete()
        .eq('week_start', wstart).eq('day_of_week', dow).eq('slot', slot)
        .in('employee_id', toDelete);
      if (error) { alert(error.message); return; }
    }

    dlg.close();
    alert('הזמינות נשמרה ✅');
    await loadEmployeesForSelector();
  };

  dlg.showModal();
}

// שיבוץ עובד
async function assignSelected(){
  const date = mgrDate.value;
  const slot = mgrSlot.value;
  const employee_id = mgrEmployee.value;
  const start_time = mgrStart.value;
  const end_time = mgrEnd.value;
  const vehicle_id = mgrVehicle.value || null;

  if (!date || !slot || !employee_id) return alert('בחר תאריך/משבצת/עובד');

  const { data: shiftRow, error: sErr } = await supabase.from('shifts').select('id').eq('date',date).eq('slot',slot).maybeSingle();
  if (sErr) return alert('שגיאה בחיפוש משמרת: '+sErr.message);
  if (!shiftRow) return alert('לא נמצאה משמרת – צור שבוע/משמרות');

  const { data: dup, error: dErr } = await supabase
    .from('shift_assignments').select('id')
    .eq('shift_id', shiftRow.id).eq('employee_id', employee_id).limit(1);
  if (dErr) return alert('שגיאת בדיקת כפילות: '+dErr.message);
  if (dup && dup.length) return alert('העובד כבר שובץ למשמרת זו.');

  const { error } = await supabase.from('shift_assignments').insert({
    shift_id: shiftRow.id, employee_id, start_time, end_time, vehicle_id, status:'planned'
  });
  if (error) return alert('שגיאה בשיבוץ: '+error.message);

  await renderDayAssignments(date);
  alert('שובץ ✅');
}

// עובד חופשי (שם חופשי)
async function addAdHocEmployee(){
  const name=(adHocName.value||'').trim(); if(!name) return;
  const { error } = await supabase.from('employees').insert({ full_name:name, active:true });
  if (error) return alert('שגיאה בהוספה: '+error.message);
  adHocName.value=''; await loadAllActiveEmployees(); await loadEmployeesForSelector();
  alert('עובד נוצר ✅ – ניתן לסמן כזמין (במודאל/כפתור).');
}

// תצוגת יום: שורות רק לשעות שיש בהן שיבוצים (ללא רווחים)
async function renderDayAssignments(dateISO){
  dayTitle.textContent = dayNameHe(dateISO);
  dayGrid.innerHTML = '<div class="text-gray-500">טוען…</div>';

  const { data: shiftsRows, error: sErr } = await supabase.from('shifts').select('id, slot').eq('date', dateISO);
  if (sErr) { dayGrid.innerHTML=`<div class="text-red-600">${sErr.message}</div>`; return; }
  if (!shiftsRows?.length){ dayGrid.innerHTML='<div class="text-gray-500">אין משמרות ביום זה.</div>'; return; }

  const shiftIds = shiftsRows.map(s=>s.id);
  const { data: assigns, error } = await supabase
    .from('shift_assignments')
    .select(`id, start_time, end_time, status, employee:employee_id(id, full_name), shift:shift_id(id, slot)`)
    .in('shift_id', shiftIds);
  if (error) { dayGrid.innerHTML=`<div class="text-red-600">${error.message}</div>`; return; }

  const dedup = uniqueBy(assigns||[], a => `${a.shift.id}::${a.employee?.id}`);
  if (!dedup.length){ dayGrid.innerHTML='<div class="text-gray-500">אין שיבוצים ליום זה.</div>'; return; }

  // קבץ לפי שעת התחלה (שעה עגולה)
  const groups = new Map();
  for (const a of dedup){
    if (!a.start_time) continue;
    const hourStr = a.start_time.slice(0,2)+':00';
    if (!groups.has(hourStr)) groups.set(hourStr, []);
    groups.get(hourStr).push(a);
  }
  const ordered = Array.from(groups.keys()).sort((h1,h2)=>timeToMinutes(h1)-timeToMinutes(h2));

  dayGrid.innerHTML='';
  for (const h of ordered){
    const list = groups.get(h).sort((a,b)=>timeToMinutes(a.start_time)-timeToMinutes(b.start_time));
    const row=document.createElement('div');
    row.className='flex items-center justify-between rounded-xl border p-3';
    const left=document.createElement('div'); left.className='font-bold text-gray-700'; left.textContent=h;
    const right=document.createElement('div');

    for (const a of list){
      const pill=document.createElement('div');
      pill.className='inline-flex items-center gap-2 bg-blue-50 text-blue-800 rounded-full px-3 py-1 ml-2';
      const name=a.employee?.full_name || '—';
      pill.innerHTML=`
        <span class="font-semibold">${name}</span>
        <span class="text-xs text-blue-700">${a.start_time?.slice(0,5)}–${a.end_time?.slice(0,5)}</span>
        <button class="text-xs underline text-blue-700" data-action="edit" data-id="${a.id}">ערוך</button>
        <button class="text-xs underline text-red-600" data-action="remove" data-id="${a.id}">הסר</button>`;
      right.appendChild(pill);
    }
    row.appendChild(right); row.appendChild(left); dayGrid.appendChild(row);
  }

  // האזנה לעריכה/הסרה
  dayGrid.querySelectorAll('button[data-action]').forEach(btn=>{
    btn.addEventListener('click', async (ev)=>{
      const id=ev.currentTarget.getAttribute('data-id');
      const action=ev.currentTarget.getAttribute('data-action');
      if (action==='remove'){
        if (!confirm('להסיר שיבוץ?')) return;
        const { error:delErr } = await supabase.from('shift_assignments').delete().eq('id', id);
        if (delErr) return alert('שגיאת הסרה: '+delErr.message);
        await renderDayAssignments(dateISO);
      } else if (action==='edit'){
        const newStart = prompt('שעת התחלה (HH:MM):','11:00'); if(!newStart) return;
        const newEnd = prompt('שעת סיום (HH:MM):','17:00'); if(!newEnd) return;
        const { error:uErr } = await supabase.from('shift_assignments').update({ start_time:newStart, end_time:newEnd }).eq('id', id);
        if (uErr) return alert('שגיאת עדכון: '+uErr.message);
        await renderDayAssignments(dateISO);
      }
    });
  });
}

// ===== Auto-init =====
(async ()=>{
  const { data:{ user } } = await supabase.auth.getUser();
  if (user){ whoami.classList.remove('hidden'); whoami.textContent=user.email||user.id; btnSignOut.classList.remove('hidden'); authSection.classList.add('hidden'); await afterAuth(); }
})();
