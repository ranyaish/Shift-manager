// app.js (מעודכן)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://uzaqpwbejceyuhnmfdmq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6YXFwd2JlamNleXVobm1mZG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyODc3NzMsImV4cCI6MjA3MDg2Mzc3M30.Wcuu97xzFvJCt8x2ubHLwc19-ZsfrRLK9YZHICV3T3A';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db:{ schema:'shifts' } });

// --- refs בסיסיים (כמו אצלך) ---
const authSection   = document.getElementById('authSection');
const employeePanel = document.getElementById('employeePanel');
const managerPanel  = document.getElementById('managerPanel');
const whoami        = document.getElementById('whoami');
const btnSignOut    = document.getElementById('btnSignOut');

const weekStartInp  = document.getElementById('weekStart');
const btnOpenWeek   = document.getElementById('btnOpenWeek');
const btnReloadWeek = document.getElementById('btnReloadWeek');
const weekScroller  = document.getElementById('weekScroller');

const timelineCard  = document.getElementById('timelineCard');
const tlDayName     = document.getElementById('tlDayName');
const timelineBars  = document.getElementById('timelineBars');

let _orderedWeekDays = [];
let _selectedDayISO = null;
let _currentDayIndex = 0;
let weekStatusBadge = null, btnDeleteWeek = null;

// ------------ Auth ------------
document.getElementById('btnSignIn')?.addEventListener('click', async () => {
  const email = (document.getElementById('email').value||'').trim();
  const password = document.getElementById('password').value||'';
  const b = document.getElementById('btnSignIn'); b.disabled=true; b.textContent='מתחבר…';
  try{
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return alert(error.message);
    await afterAuth();
  } finally { b.disabled=false; b.textContent='כניסה'; }
});
btnSignOut?.addEventListener('click', async ()=>{ await supabase.auth.signOut(); location.reload(); });

async function afterAuth(){
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;

  whoami.classList.remove('hidden');
  whoami.textContent = user.email || user.id;
  btnSignOut.classList.remove('hidden');
  authSection.classList.add('hidden');

  const { data: prof, error } = await supabase
    .from('user_profiles').select('app_role, employee_id').eq('user_id', user.id).maybeSingle();
  if(error) return alert(error.message);

  if (prof?.app_role === 'manager'){
    managerPanel.classList.remove('hidden');
    weekStartInp.value = isoOfUpcomingSunday();
    bindManager();
  } else {
    employeePanel.classList.remove('hidden');
  }
}

// ------------ Manager ------------
function bindManager(){
  injectWeekControls();

  btnOpenWeek.addEventListener('click', async ()=>{
    const ws = weekStartInp.value;
    if(!ws) return alert('בחר תחילת שבוע');
    await upsertWeeklyRoster(ws, 'draft');
    const { error } = await supabase.rpc('generate_weekly_roster', { p_week_start: ws });
    if(error) return alert(error.message);
    await loadWeek(ws);
  });

  btnReloadWeek.addEventListener('click', ()=> weekStartInp.value && loadWeek(weekStartInp.value));
  btnDeleteWeek.addEventListener('click', async ()=>{
    const ws = weekStartInp.value; if(!ws) return;
    if(!confirm('למחוק את שבוע העבודה?')) return;
    await deleteWeekData(ws);
    weekScroller.innerHTML=''; timelineBars.innerHTML=''; toggleWeekStatus(null);
  });
}

function injectWeekControls(){
  if (weekStatusBadge) return;
  const card = weekStartInp.closest('.card');
  const grid = card.querySelector('.grid');
  const wrap = document.createElement('div');
  wrap.className='flex items-end gap-2 col-span-12 md:col-span-4';
  weekStatusBadge = document.createElement('span'); weekStatusBadge.className='pill'; weekStatusBadge.textContent='—';
  btnDeleteWeek = document.createElement('button'); btnDeleteWeek.className='btn btn-danger btn-sm'; btnDeleteWeek.textContent='מחק שבוע';
  wrap.appendChild(weekStatusBadge); wrap.appendChild(btnDeleteWeek); grid.appendChild(wrap);
}

async function upsertWeeklyRoster(ws, status='draft'){
  await supabase.from('weekly_rosters').upsert({ week_start: ws, status }, { onConflict:'week_start' });
}
async function getWeeklyRoster(ws){
  const { data } = await supabase.from('weekly_rosters').select('week_start,status').eq('week_start', ws).maybeSingle();
  return data || null;
}
function toggleWeekStatus(r){
  if(!weekStatusBadge){return;}
  if(!r){ weekStatusBadge.textContent='אין שבוע פעיל'; weekStatusBadge.style.background='#f3f4f6'; weekStatusBadge.style.color='#374151'; return; }
  weekStatusBadge.textContent = r.status==='draft' ? 'טיוטה' : r.status;
  weekStatusBadge.style.background = r.status==='draft' ? '#e0f2fe' : '#dcfce7';
  weekStatusBadge.style.color = r.status==='draft' ? '#075985' : '#166534';
}
async function deleteWeekData(ws){
  const { data: shifts } = await supabase.from('shifts').select('id').gte('date', ws).lte('date', addDaysISO(ws,6));
  const ids = (shifts||[]).map(s=>s.id);
  if(ids.length) await supabase.from('shift_assignments').delete().in('shift_id', ids);
  await supabase.from('shifts').delete().gte('date', ws).lte('date', addDaysISO(ws,6));
  await supabase.from('weekly_rosters').delete().eq('week_start', ws);
}

async function loadWeek(ws){
  weekScroller.innerHTML='';
  toggleWeekStatus(await getWeeklyRoster(ws));

  const { data: shifts, error } = await supabase
    .from('shifts').select('id,date,slot,planned_start,planned_end')
    .gte('date', ws).lte('date', addDaysISO(ws,6))
    .order('date').order('slot');
  if(error){ weekScroller.innerHTML=`<div class="text-red-600 p-3">${error.message}</div>`; return; }

  const byDay = new Map();
  shifts?.forEach(s=>{
    if(!byDay.has(s.date)) byDay.set(s.date, { date:s.date, slots:{lunch:null,dinner:null,long:null} });
    byDay.get(s.date).slots[s.slot] = s;
  });

  _orderedWeekDays = []; for(let i=0;i<7;i++){ if(i===5) continue; _orderedWeekDays.push(addDaysISO(ws,i)); }

  for(const d of _orderedWeekDays){
    const day = byDay.get(d) || { date:d, slots:{lunch:null,dinner:null,long:null} };
    const col = await renderDayColumn(day, ws);
    col.querySelector('.day-head').addEventListener('click', async ()=>{
      _selectedDayISO = day.date; _currentDayIndex = _orderedWeekDays.indexOf(_selectedDayISO);
      await renderTimeline(_selectedDayISO);
    });
    weekScroller.appendChild(col);
  }

  _selectedDayISO = _orderedWeekDays[0]; _currentDayIndex = 0;
  await renderTimeline(_selectedDayISO);
}

async function renderDayColumn(dayData, ws){
  const col = document.createElement('div');
  col.className='day-col';
  const dayName = new Date(dayData.date).toLocaleDateString('he-IL',{weekday:'long'});
  const dateTxt = new Date(dayData.date).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit'});
  col.innerHTML = `
    <div class="day-head"><div class="font-extrabold">${dayName}</div><div class="badge">${dateTxt}</div></div>
    <div class="shift-box" data-slot="lunch"></div>
    <div class="shift-box" data-slot="dinner"></div>
    <div class="shift-box" data-slot="long"></div>
  `;
  for(const slot of ['lunch','dinner','long']){
    await renderShiftBox(col.querySelector(`[data-slot="${slot}"]`), dayData, slot, ws);
  }
  return col;
}

async function renderShiftBox(container, dayData, slot, ws){
  container.innerHTML = `
    <div class="shift-title">
      <span>${slotName(slot)}</span>
      <button class="btn btn-ghost btn-sm ml-auto" title="ניהול זמינות">⚙ זמינות</button>
    </div>
    <div class="assigned-list"></div>

    <div class="mt-2 flex items-center gap-2">
      <select class="input grow assign-select" disabled></select>
      <button class="btn btn-primary btn-sm assign-btn" disabled>שבץ</button>
    </div>

    <div class="mt-2 flex items-center gap-2">
      <input class="input qa-name" placeholder="הוסף עובד חדש בשם חופשי…" />
      <button class="btn btn-primary btn-sm qa-btn">הוסף</button>
    </div>
  `;

  const listEl = container.querySelector('.assigned-list');
  const selEl  = container.querySelector('.assign-select');
  const btnEl  = container.querySelector('.assign-btn');
  const availBtn = container.querySelector('.shift-title .btn');
  const qaName = container.querySelector('.qa-name');
  const qaBtn  = container.querySelector('.qa-btn');

  const shiftRow = dayData.slots[slot];
  if(!shiftRow){
    listEl.innerHTML = `<div class="badge">אין משמרת – צור שבוע</div>`;
    selEl.disabled = true; btnEl.disabled=true; qaBtn.disabled=true; return;
  }

  await refreshAssignmentsUI(listEl, shiftRow.id, dayData.date);

  // עובדים זמינים + הערות
  const avail = await fetchAvailableWithNotes(dayData.date, slot);
  selEl.innerHTML='';
  if(!avail.length){ selEl.innerHTML='<option>אין עובדים זמינים</option>'; selEl.disabled=true; btnEl.disabled=true; }
  else{
    avail.forEach(e=>{
      const o=document.createElement('option');
      o.value=e.id; o.textContent = e.full_name + (e.note ? ` — ${e.note}`:'');
      selEl.appendChild(o);
    });
    selEl.disabled=false; btnEl.disabled=false;
  }

  btnEl.addEventListener('click', async ()=>{
    const employee_id = selEl.value; if(!employee_id) return;
    const start = shiftRow.planned_start || '11:00';
    const end   = shiftRow.planned_end   || '17:00';
    const { error } = await supabase.from('shift_assignments').insert({
      shift_id: shiftRow.id, employee_id, status:'planned', role:'other', start_time:start, end_time:end
    });
    if(error) return alert(error.message);
    await refreshAssignmentsUI(listEl, shiftRow.id, dayData.date);
    if (_selectedDayISO === dayData.date) renderTimeline(dayData.date);
  });

  // הוסף בלבד → לאחר ההוספה פופ-אפ שיבוץ זריז
  qaBtn.addEventListener('click', async ()=>{
    const name = (qaName.value||'').trim(); if(!name) return alert('כתוב שם');
    const { data: ins, error } = await supabase.from('employees').insert({ full_name:name }).select('id').maybeSingle();
    if(error) return alert(error.message);
    qaName.value='';
    await openQuickAssignModal(shiftRow.id, ins.id, shiftRow.planned_start||'11:00', shiftRow.planned_end||'17:00', async ()=>{
      await refreshAssignmentsUI(listEl, shiftRow.id, dayData.date);
      if (_selectedDayISO === dayData.date) renderTimeline(dayData.date);
    });
  });

  availBtn.addEventListener('click', async ()=>{
    await openAvailManager(dayData.date, slot, ws);
  });
}

async function refreshAssignmentsUI(listEl, shift_id, dayISO){
  listEl.innerHTML='';
  const { data: rows, error } = await supabase
    .from('shift_assignments')
    .select('id,start_time,end_time,employee:employee_id(id,full_name,phone)')
    .eq('shift_id', shift_id).order('start_time');
  if(error){ listEl.innerHTML=`<div class="text-red-600">${error.message}</div>`; return; }
  if(!rows?.length){ listEl.innerHTML=`<div class="badge">אין שיבוצים</div>`; return; }

  rows.forEach(r=>{
    const row = document.createElement('div'); row.className='assigned-row';
    row.innerHTML = `
      <div class="flex items-center justify-between w-full">
        <div>
          <button class="emp-link" data-id="${r.employee?.id||''}">${r.employee?.full_name||'—'}</button>
          <div class="text-xs text-gray-600">${(r.start_time||'').slice(0,5)}–${(r.end_time||'').slice(0,5)}</div>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-gray btn-sm edit" data-id="${r.id}">ערוך</button>
          <button class="btn btn-danger btn-sm del" data-id="${r.id}">הסר</button>
        </div>
      </div>
    `;
    listEl.appendChild(row);
  });

  // אירועים
  listEl.querySelectorAll('.emp-link').forEach(b=>b.addEventListener('click', e=>{
    const id = e.currentTarget.getAttribute('data-id'); if(id) openEmployeeCard(id);
  }));
  listEl.querySelectorAll('.edit').forEach(b=>b.addEventListener('click', async e=>{
    const id = e.currentTarget.getAttribute('data-id');
    const r  = rows.find(x=>String(x.id)===String(id));
    const s = prompt('שעת התחלה (HH:MM)', (r?.start_time||'11:00').slice(0,5)); if(!s) return;
    const f = prompt('שעת סיום (HH:MM)', (r?.end_time||'17:00').slice(0,5)); if(!f) return;
    const { error:u } = await supabase.from('shift_assignments').update({ start_time:s, end_time:f }).eq('id', id);
    if(u) return alert(u.message);
    await refreshAssignmentsUI(listEl, shift_id, dayISO);
    if (_selectedDayISO === dayISO) renderTimeline(dayISO);
  }));
  listEl.querySelectorAll('.del').forEach(b=>b.addEventListener('click', async e=>{
    const id = e.currentTarget.getAttribute('data-id');
    if(!confirm('להסיר מהמשמרת?')) return;
    const { error:d } = await supabase.from('shift_assignments').delete().eq('id', id);
    if(d) return alert(d.message);
    await refreshAssignmentsUI(listEl, shift_id, dayISO);
    if (_selectedDayISO === dayISO) renderTimeline(dayISO);
  }));
}

// --------- פופ-אפ שיבוץ מהיר אחרי “הוסף” ---------
async function openQuickAssignModal(shiftId, employeeId, defStart, defEnd, onDone){
  let dlg = document.getElementById('assignQuickDlg');
  if(!dlg){
    dlg = document.createElement('dialog');
    dlg.id='assignQuickDlg';
    dlg.className='card';
    dlg.innerHTML = `
      <form method="dialog" class="space-y-3">
        <div class="font-extrabold">שיבוץ מהיר</div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="text-sm">התחלה</label><input id="aq_start" class="input" type="time"></div>
          <div><label class="text-sm">סיום</label><input id="aq_end" class="input" type="time"></div>
        </div>
        <div class="flex items-center gap-2 justify-end">
          <button value="cancel" class="btn btn-gray btn-sm">ביטול</button>
          <button id="aq_save" class="btn btn-primary btn-sm">שבץ</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
  }
  dlg.querySelector('#aq_start').value = (defStart||'11:00').slice(0,5);
  dlg.querySelector('#aq_end').value   = (defEnd||'17:00').slice(0,5);

  dlg.querySelector('#aq_save').onclick = async (ev)=>{
    ev.preventDefault();
    const s = dlg.querySelector('#aq_start').value || '11:00';
    const e = dlg.querySelector('#aq_end').value || '17:00';
    const { error } = await supabase.from('shift_assignments').insert({
      shift_id: shiftId, employee_id: employeeId, status:'planned', role:'other', start_time:s, end_time:e
    });
    if(error){ alert(error.message); return; }
    dlg.close();
    onDone && onDone();
  };
  dlg.showModal();
}

// ------------ Availability manager (ללא שינויי לוגיקה עיקריים) ------------
async function fetchAvailableWithNotes(isoDate, slot){
  const dow = new Date(isoDate+'T00:00:00').getDay();
  const ws  = weekStartFromISO(isoDate);
  const { data: av } = await supabase.from('availability')
    .select('employee_id,note').eq('week_start',ws).eq('day_of_week',dow).eq('slot',slot);
  const notes = new Map(av?.map(a=>[a.employee_id,a.note])||[]);
  const ids = [...new Set((av||[]).map(x=>x.employee_id))];
  if(!ids.length) return [];
  const { data: emps } = await supabase.from('employees').select('id,full_name,active').in('id', ids).eq('active',true);
  return (emps||[]).map(e=>({ ...e, note: notes.get(e.id)||'' }));
}
async function openAvailManager(isoDate, slot, ws){
  // (השאר כפי שהיה אצלך – מנהל סימון הזמינות בצ׳קבוקסים ושמירה)
  alert('מנהל זמינות פתוח – (קיצרתי ליצור)'); // אם יש לך דיאלוג מוכן – שמור אותו; זו רק שמירת מקום
}

// ------------ Timeline יומי (לפי שעה) ------------
function ensureTimelineNav(){
  if(document.getElementById('tlPrev')) return;
  const head = tlDayName.parentElement;
  const left = document.createElement('div'); left.className='flex items-center gap-2';
  const prev = document.createElement('button'); prev.id='tlPrev'; prev.className='btn btn-gray btn-sm'; prev.textContent='‹ יום קודם';
  const next = document.createElement('button'); next.id='tlNext'; next.className='btn btn-gray btn-sm'; next.textContent='יום הבא ›';
  prev.onclick = ()=>{ if(_currentDayIndex>0){ _currentDayIndex--; _selectedDayISO=_orderedWeekDays[_currentDayIndex]; renderTimeline(_selectedDayISO); } };
  next.onclick = ()=>{ if(_currentDayIndex<_orderedWeekDays.length-1){ _currentDayIndex++; _selectedDayISO=_orderedWeekDays[_currentDayIndex]; renderTimeline(_selectedDayISO); } };
  left.appendChild(prev); left.appendChild(next); head.appendChild(left);
}
async function renderTimeline(isoDate){
  ensureTimelineNav();
  tlDayName.textContent = 'שיבוצים ליום ' + new Date(isoDate).toLocaleDateString('he-IL',{weekday:'long', day:'2-digit', month:'2-digit'});
  timelineCard.classList.remove('hidden');
  timelineBars.innerHTML='';

  const { data: shifts } = await supabase.from('shifts').select('id').eq('date', isoDate);
  if(!shifts?.length){ timelineBars.innerHTML='<div class="badge">אין משמרות ליום זה</div>'; return; }

  const ids = shifts.map(s=>s.id);
  const { data: assigns } = await supabase
    .from('shift_assignments')
    .select('id,start_time,employee:employee_id(full_name,id)').in('shift_id', ids);

  if(!assigns?.length){ timelineBars.innerHTML='<div class="badge">אין שיבוצים ליום זה</div>'; return; }

  // ביטול כפילויות לפי (עובד + שעת התחלה)
  const seen = new Set(), uniq=[];
  for(const a of assigns){
    const key = `${a.employee?.id||'x'}|${(a.start_time||'').slice(0,5)}`;
    if(seen.has(key)) continue; seen.add(key); uniq.push(a);
  }

  const byTime = new Map();
  uniq.forEach(a=>{
    const t = (a.start_time||'').slice(0,5) || '—';
    if(!byTime.has(t)) byTime.set(t, []);
    byTime.get(t).push(a.employee?.full_name || '—');
  });
  const times = [...byTime.keys()].sort((a,b)=>a.localeCompare(b));

  times.forEach(t=>{
    const row = document.createElement('div'); row.className='emp-row';
    const left = document.createElement('div'); left.className='emp-name'; left.textContent=`שעה ${t}`;
    const right = document.createElement('div'); right.className='emp-chips';
    byTime.get(t).sort((a,b)=>a.localeCompare(b)).forEach(n=>{
      const chip=document.createElement('span'); chip.className='chip'; chip.textContent=n; right.appendChild(chip);
    });
    row.appendChild(left); row.appendChild(right); timelineBars.appendChild(row);
  });

  _currentDayIndex = _orderedWeekDays.indexOf(isoDate);
  document.getElementById('tlPrev').disabled = _currentDayIndex<=0;
  document.getElementById('tlNext').disabled = _currentDayIndex>=(_orderedWeekDays.length-1);
}

// ------------ Utils ------------
function slotName(s){ return s==='lunch'?'צהריים':(s==='dinner'?'ערב':'ארוכה'); }
function isoOfUpcomingSunday(){ const d=new Date(), day=d.getDay(); const sun=new Date(d.getFullYear(),d.getMonth(),d.getDate()-day); const z=sun.getTimezoneOffset()*60000; return new Date(sun-z).toISOString().slice(0,10); }
function addDaysISO(iso,days){ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+days); const z=d.getTimezoneOffset()*60000; return new Date(d-z).toISOString().slice(0,10); }
function weekStartFromISO(iso){ const d=new Date(iso+'T00:00:00'); const sun=new Date(d); sun.setDate(d.getDate()-d.getDay()); const z=sun.getTimezoneOffset()*60000; return new Date(sun-z).toISOString().slice(0,10); }

// Auto init
(async ()=>{ const { data:{ user } } = await supabase.auth.getUser(); if(user) afterAuth(); })();
