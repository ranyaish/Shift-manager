<!-- app.js – FULL UPDATED -->
<script type="module">
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* === Supabase config (עדכן לערכים שלך אם לא מוזרק דרך window.__...) === */
const SUPABASE_URL = 'https://uzaqpwbejceyuhnmfdmq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6YXFwd2JlamNleXVobm1mZG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyODc3NzMsImV4cCI6MjA3MDg2Mzc3M30.Wcuu97xzFvJCt8x2ubHLwc19-ZsfrRLK9YZHICV3T3A';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { db:{ schema:'shifts' } })
window.supa = supabase // debug

/* ===== DOM ===== */
const whoami          = document.getElementById('whoami')
const btnSignOut      = document.getElementById('btnSignOut')
const authSection     = document.getElementById('authSection')
const managerSection  = document.getElementById('managerSection')
const employeeSection = document.getElementById('employeeSection')

/* Manager controls */
const elWkStart  = document.getElementById('wkWeekStart')
const btnGenWeek = document.getElementById('btnGenerateWeek')
const btnDelWeek = document.getElementById('btnDeleteWeek')

const weekScroller = document.getElementById('weekScroller') // גלילה אופקית
const dayTitle     = document.getElementById('dayTitle')
const btnDayPrev   = document.getElementById('btnDayPrev')
const btnDayNext   = document.getElementById('btnDayNext')
const timelineBox  = document.getElementById('timelineBox')

/* Employee controls (אם קיימים) */
const btnSignIn     = document.getElementById('btnSignIn')
const avWeekStart   = document.getElementById('avWeekStart')
const avDay         = document.getElementById('avDay')
const avSlot        = document.getElementById('avSlot')
const avNote        = document.getElementById('avNote')
const btnAvSave     = document.getElementById('btnSubmitAvailability')

/* ===== State ===== */
let currentUser = null
let currentProfile = null
let currentRoster = null // { id, week_start, status }
let weekDays = []        // [{date, slots:{ lunch:{...}, dinner:{...}, long:{...} }}]
let selectedDayIndex = 0

/* ===== Utils ===== */
function isoToday(){ const d=new Date(); const z=d.getTimezoneOffset()*60000; return new Date(Date.now()-z).toISOString().slice(0,10) }
function isoSundayOf(iso){
  const d = new Date((iso||isoToday())+'T00:00:00')
  const dow = d.getDay() // 0=Sunday
  const s = new Date(d); s.setDate(d.getDate() - dow)
  const z=s.getTimezoneOffset()*60000; return new Date(s - z).toISOString().slice(0,10)
}
function addDays(iso, n){ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n); const z=d.getTimezoneOffset()*60000; return new Date(d-z).toISOString().slice(0,10) }
function fmtHebDate(iso){ const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('he-IL',{weekday:'long', day:'2-digit', month:'2-digit'}) }
function slotName(s){ return s==='lunch'?'צהריים':(s==='dinner'?'ערב':'ארוכה') }

/* ===== Auth ===== */
btnSignIn?.addEventListener('click', async ()=>{
  const email=(document.getElementById('email').value||'').trim()
  const password=document.getElementById('password').value||''
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return alert('שגיאת התחברות: ' + error.message)
  await afterAuth()
})
btnSignOut?.addEventListener('click', async ()=>{ await supabase.auth.signOut(); location.reload() })

async function afterAuth(){
  const { data:{ user } } = await supabase.auth.getUser()
  if (!user) return
  currentUser = user
  whoami?.classList.remove('hidden'); if (whoami) whoami.textContent = user.email || user.id
  authSection?.classList.add('hidden'); btnSignOut?.classList.remove('hidden')

  const { data: prof, error } = await supabase
    .from('user_profiles')
    .select('app_role, employee_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return alert('שגיאת פרופיל: ' + error.message)
  currentProfile = prof || { app_role:'employee', employee_id:null }

  if (currentProfile.app_role === 'manager') initManager()
  else initEmployee(currentProfile.employee_id)
}
;(async ()=>{ const { data:{ user } } = await supabase.auth.getUser(); if (user) afterAuth() })()

/* ===== Manager ===== */
async function initManager(){
  managerSection?.classList.remove('hidden')
  if (elWkStart) elWkStart.value = isoSundayOf(isoToday())

  btnGenWeek?.addEventListener('click', async ()=>{
    await ensureRoster(elWkStart.value)
    await loadWeek(elWkStart.value)
  })
  btnDelWeek?.addEventListener('click', async ()=>{
    if (!currentRoster) return alert('אין שבוע פתוח')
    if (!confirm('למחוק את השבוע (כולל משמרות ושיבוצים)?')) return
    await deleteRosterCascade(currentRoster.id)
    currentRoster=null; weekDays=[]
    renderWeekColumns(); renderTimelineUI()
  })
  btnDayPrev?.addEventListener('click', ()=> changeDay(-1))
  btnDayNext?.addEventListener('click', ()=> changeDay(+1))

  await ensureRoster(elWkStart.value)
  await loadWeek(elWkStart.value)
}

async function ensureRoster(week_start){
  const { data, error } = await supabase.from('rosters').select('id, week_start, status').eq('week_start', week_start).maybeSingle()
  if (error) return alert(error.message)
  if (data) { currentRoster = data; return }
  const { data: ins, error: e2 } = await supabase.from('rosters').insert({ week_start, status:'draft' }).select('id, week_start, status').single()
  if (e2) return alert(e2.message)
  currentRoster = ins
}

async function deleteRosterCascade(roster_id){
  // אם אין פונקציה — מוחקים משמרות ושיבוצים לפי התאריכים של השבוע
  // (פשוט/בטוח יותר: קריאה ל-RPC אם בנית, אחרת בצע מחיקה ידנית)
  const ws = currentRoster?.week_start
  if (!ws) return
  const from = ws, to = addDays(ws, 6)
  const { data: shifts } = await supabase.from('shifts').select('id').gte('date', from).lte('date', to)
  const ids = (shifts||[]).map(s=>s.id)
  if (ids.length) await supabase.from('shift_assignments').delete().in('shift_id', ids)
  await supabase.from('shifts').delete().gte('date', from).lte('date', to)
  await supabase.from('rosters').delete().eq('id', roster_id)
}

async function loadWeek(week_start){
  // טוען משמרות לכל יום בשבוע (א-ש), שומר מבנה לוגי ל־weekDays
  weekDays = []
  for (let i=0;i<7;i++){
    const dateISO = addDays(week_start, i)
    const { data: rows, error } = await supabase
      .from('shifts')
      .select('id, date, slot, planned_start, planned_end')
      .eq('date', dateISO)
    if (error) { alert(error.message); continue }
    const day = { date: dateISO, slots: { lunch:null, dinner:null, long:null } }
    rows?.forEach(r => { day.slots[r.slot] = r })
    weekDays.push(day)
  }
  selectedDayIndex = 0
  renderWeekColumns()
  renderTimelineUI()
}

/* ===== Horizontal week scroller ===== */
function renderWeekColumns(){
  if (!weekScroller) return
  weekScroller.innerHTML=''
  weekScroller.classList.add('flex')
  weekScroller.style.gap='12px'
  weekScroller.style.overflowX='auto'
  weekScroller.style.scrollSnapType='x mandatory'

  weekDays.forEach(day=>{
    const col = document.createElement('div')
    col.className='day-col'
    col.style.minWidth='320px'
    col.style.scrollSnapAlign='start'
    col.innerHTML = `
      <div class="day-head font-semibold mb-2 cursor-pointer">${fmtHebDate(day.date)}</div>
      ${['lunch','dinner','long'].map(slot=>`
        <div class="shift-box rounded-xl border p-3 mb-3">
          <div class="flex items-center gap-2 mb-2">
            <div class="font-medium">${slotName(slot)}</div>
            <button class="btn btn-ghost text-xs ml-auto" data-open-avail="${slot}">⚙ זמינות</button>
          </div>
          <div class="assigned-list space-y-2" id="as-${day.date}-${slot}"></div>
          <div class="mt-2 flex items-center gap-2">
            <select class="input grow" id="sel-${day.date}-${slot}" disabled></select>
            <button class="btn btn-primary btn-sm" id="btn-${day.date}-${slot}" disabled>שבץ</button>
          </div>
        </div>
      `).join('')}
    `
    weekScroller.appendChild(col)

    // clicking the day title changes the timeline selection
    col.querySelector('.day-head')?.addEventListener('click', ()=>{
      selectedDayIndex = weekDays.findIndex(d=>d.date===day.date)
      renderTimelineUI()
    })

    // wire each slot
    ;['lunch','dinner','long'].forEach(async (slot)=>{
      const listEl = col.querySelector(`#as-${day.date}-${slot}`)
      const selEl  = col.querySelector(`#sel-${day.date}-${slot}`)
      const btnEl  = col.querySelector(`#btn-${day.date}-${slot}`)
      const availBtn = col.querySelector(`[data-open-avail="${slot}"]`)
      const shift = day.slots[slot]

      if (!shift) {
        listEl.innerHTML = `<div class="text-xs text-gray-500">אין משמרת – צור שבוע</div>`
        return
      }

      await refreshAssignmentsUI(listEl, shift.id, day.date)

      // רק עובדים שזמינים
      await refillAvailableSelect(selEl, btnEl, day.date, slot)

      btnEl.addEventListener('click', async ()=>{
        const employee_id = selEl.value
        if (!employee_id) return
        // וידוא כפול (אם בינתיים השתנה מצב זמינות)
        const avail = await fetchAvailableWithNotes(day.date, slot)
        if (!avail.find(a=>String(a.id)===String(employee_id)))
          return alert('ניתן לשבץ רק עובדים שסימנו זמינות למשבצת זו.')
        const start = shift.planned_start || '11:00'
        const end   = shift.planned_end   || '17:00'
        const { error } = await supabase.from('shift_assignments').insert({
          shift_id: shift.id, employee_id, role:'other', status:'planned', start_time:start, end_time:end
        })
        if (error) {
          if (error.code==='23505') return alert('העובד כבר משובץ במשמרת זו.')
          return alert(error.message)
        }
        await refreshAssignmentsUI(listEl, shift.id, day.date)
        if (weekDays[selectedDayIndex]?.date === day.date) renderTimelineUI()
      })

      // ⚙ זמינות — פותח מודל מלא נוח
      availBtn.addEventListener('click', async ()=>{
        await openAvailabilityModal(day.date, slot)
        // אחרי שמירה — לרענן רשימת זמינים
        await refillAvailableSelect(selEl, btnEl, day.date, slot)
      })
    })
  })

  // עדכון כותרת ה"יום הנבחר"
  updateDayHeader()
}

/* ===== Timeline (תצוגת יום: קיבוץ לפי שעה) ===== */
async function renderTimelineUI(){
  const day = weekDays[selectedDayIndex]
  if (!day || !timelineBox) return
  if (dayTitle) dayTitle.textContent = fmtHebDate(day.date)

  const shiftIds = Object.values(day.slots||{}).filter(Boolean).map(s=>s.id)
  if (!shiftIds.length) { timelineBox.innerHTML = '<div class="text-sm text-gray-500">אין משמרת ביום זה.</div>'; return }

  const { data: assigns, error } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, employee:employee_id(id, full_name), shift:shift_id(slot)')
    .in('shift_id', shiftIds)
    .order('start_time', { ascending:true })
  if (error) { timelineBox.innerHTML = `<div class="text-red-600">${error.message}</div>`; return }

  // ביטול כפילויות (עובד+שעת התחלה)
  const seen = new Set(), uniq=[]
  for (const r of assigns){
    const key = `${r.employee?.id||'x'}|${(r.start_time||'').slice(0,5)}`
    if (seen.has(key)) continue; seen.add(key); uniq.push(r)
  }

  // קיבוץ לפי שעה
  const byTime = new Map()
  uniq.forEach(a=>{
    const t = (a.start_time||'').slice(0,5) || '—'
    if (!byTime.has(t)) byTime.set(t, [])
    byTime.get(t).push(a)
  })
  const times = [...byTime.keys()].sort((a,b)=>a.localeCompare(b))

  timelineBox.innerHTML = ''
  times.forEach(t=>{
    const row = document.createElement('div'); row.className='mb-2'
    row.innerHTML = `
      <div class="text-xs text-gray-500 mb-1">${t}</div>
      <div class="flex flex-wrap gap-2">
        ${byTime.get(t).sort((a,b)=> (a.employee?.full_name||'').localeCompare(b.employee?.full_name||''))
          .map(r=>`<span class="px-3 py-1 rounded-full text-sm" style="background:#BFE8FF">
            ${r.employee?.full_name||'—'} <span class="text-[11px] text-gray-600">(${(r.start_time||'').slice(0,5)}–${(r.end_time||'').slice(0,5)})</span>
          </span>`).join('')}
      </div>
    `
    timelineBox.appendChild(row)
  })

  updateDayHeader()
}

function updateDayHeader(){
  const iso = weekDays[selectedDayIndex]?.date
  if (dayTitle && iso) dayTitle.textContent = fmtHebDate(iso)
  if (btnDayPrev) btnDayPrev.disabled = selectedDayIndex<=0
  if (btnDayNext) btnDayNext.disabled = selectedDayIndex>=weekDays.length-1
}
function changeDay(delta){
  const nx = selectedDayIndex + delta
  if (nx<0 || nx>=weekDays.length) return
  selectedDayIndex = nx
  renderTimelineUI()
}

/* ===== Assignments list (with edit/remove ALWAYS) ===== */
async function refreshAssignmentsUI(container, shift_id, dateISO){
  const { data, error } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, employee:employee_id(id, full_name)')
    .eq('shift_id', shift_id)
    .order('start_time', { ascending:true })
  if (error) { container.innerHTML = `<div class="text-red-600">${error.message}</div>`; return }

  // dedupe by (employee,start_time)
  const keys=new Set(), rows=[]
  data.forEach(r=>{ const k=`${r.employee?.id}|${r.start_time}`; if(!keys.has(k)){ keys.add(k); rows.push(r) } })

  container.innerHTML = ''
  if (!rows.length) { container.innerHTML = `<div class="text-xs text-gray-500">אין שיבוצים למשבצת זו.</div>`; return }

  rows.forEach(r=>{
    const el = document.createElement('div'); el.className = 'assigned-row flex items-center justify-between bg-white rounded-xl shadow px-3 py-2'
    el.innerHTML = `
      <div>
        <div class="font-medium">${r.employee?.full_name||'—'}</div>
        <div class="text-xs text-gray-600">${(r.start_time||'').slice(0,5)}–${(r.end_time||'').slice(0,5)}</div>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-gray btn-sm" data-edit="${r.id}">ערוך</button>
        <button class="btn btn-danger btn-sm" data-del="${r.id}">הסר</button>
      </div>
    `
    container.appendChild(el)
  })

  // actions
  container.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-edit')
      const row = rows.find(x=>String(x.id)===String(id))
      const s = prompt('שעת התחלה (HH:MM)', (row?.start_time||'11:00').slice(0,5)); if(!s) return
      const e = prompt('שעת סיום (HH:MM)', (row?.end_time||'17:00').slice(0,5)); if(!e) return
      const { error } = await supabase.from('shift_assignments').update({ start_time:s, end_time:e }).eq('id', id)
      if (error) return alert(error.message)
      await refreshAssignmentsUI(container, shift_id, dateISO)
      if (weekDays[selectedDayIndex]?.date === dateISO) renderTimelineUI()
    })
  })
  container.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-del')
      if (!confirm('להסיר את השיבוץ?')) return
      const { error } = await supabase.from('shift_assignments').delete().eq('id', id)
      if (error) return alert(error.message)
      await refreshAssignmentsUI(container, shift_id, dateISO)
      if (weekDays[selectedDayIndex]?.date === dateISO) renderTimelineUI()
    })
  })
}

/* ===== Availability ===== */
/** ממלא את ה-SELECT רק ממי שסומן זמין, כולל הערות */
async function refillAvailableSelect(selEl, btnEl, dateISO, slot){
  const avail = await fetchAvailableWithNotes(dateISO, slot)
  selEl.innerHTML = ''
  if (!avail.length){
    selEl.innerHTML = '<option>אין עובדים זמינים</option>'
    selEl.disabled = true; btnEl.disabled = true
    return
  }
  avail.forEach(a=>{
    const o = document.createElement('option')
    o.value = a.id
    o.textContent = a.full_name + (a.note ? ` — ${a.note}` : '')
    selEl.appendChild(o)
  })
  selEl.disabled = false; btnEl.disabled = false
}

/** מחזיר רשימת עובדים שזמינים ליום+סלוט (כולל note) */
async function fetchAvailableWithNotes(dateISO, slot){
  const wstart = isoSundayOf(dateISO)
  const dow = new Date(dateISO+'T00:00:00').getDay() // 0..6
  const { data, error } = await supabase
    .from('availability')
    .select('employee_id, note, employee:employee_id(full_name)')
    .eq('week_start', wstart).eq('day_of_week', dow).eq('slot', slot)
  if (error) { console.error(error); return [] }
  const map = new Map()
  data?.forEach(r=>{
    if (!map.has(r.employee_id)) map.set(r.employee_id, {
      id: r.employee_id, full_name: r.employee?.full_name || '—', note: r.note || ''
    })
  })
  return Array.from(map.values()).sort((a,b)=> a.full_name.localeCompare(b.full_name,'he'))
}

/* === Modal: ניהול זמינות (צ׳קבוקסים + הערות) === */
function ensureAvailabilityModal(){
  let dlg = document.getElementById('availModalMgr')
  if (dlg) return dlg
  dlg = document.createElement('dialog')
  dlg.id = 'availModalMgr'
  dlg.style.border = 'none'
  dlg.style.borderRadius = '16px'
  dlg.style.maxWidth = '680px'
  dlg.innerHTML = `
    <form method="dialog" style="padding:0; min-width: 560px;">
      <div style="background:#0ea5e9; color:#083344; padding:10px 14px; font-weight:900" id="availTitleMgr">ניהול זמינות</div>
      <div style="max-height:65vh; overflow:auto; padding:14px" id="availBodyMgr">
        טוען…
      </div>
      <div style="background:#f8fafc; padding:10px 14px; display:flex; justify-content:flex-end; gap:8px">
        <button value="cancel" class="btn btn-gray">ביטול</button>
        <button id="btnAvailSaveMgr" class="btn btn-primary">שמור</button>
      </div>
    </form>
  `
  document.body.appendChild(dlg)
  return dlg
}

async function openAvailabilityModal(dateISO, slot){
  const dlg = ensureAvailabilityModal()
  const title = dlg.querySelector('#availTitleMgr')
  const body  = dlg.querySelector('#availBodyMgr')
  const btnSave = dlg.querySelector('#btnAvailSaveMgr')

  title.textContent = `ניהול זמינות · ${fmtHebDate(dateISO)} · ${slotName(slot)}`
  body.innerHTML = 'טוען…'

  // כל העובדים הפעילים
  const { data: emps, error: e1 } = await supabase.from('employees').select('id, full_name, active').eq('active', true).order('full_name')
  if (e1) { body.innerHTML = `<div class="text-red-600">${e1.message}</div>`; dlg.showModal(); return }

  // הזמינות הקיימת
  const wstart = isoSundayOf(dateISO)
  const dow    = new Date(dateISO+'T00:00:00').getDay()
  const { data: av, error: e2 } = await supabase
    .from('availability')
    .select('employee_id, note')
    .eq('week_start', wstart).eq('day_of_week', dow).eq('slot', slot)
  if (e2) { body.innerHTML = `<div class="text-red-600">${e2.message}</div>`; dlg.showModal(); return }

  const selected = new Set(av.map(x=>String(x.employee_id)))
  const notesMap = new Map(av.map(x=>[String(x.employee_id), x.note || '']))

  // טבלת צ׳קבוקסים + הערות
  body.innerHTML = ''
  const wrapper = document.createElement('div')
  wrapper.className = 'space-y-2'
  emps.forEach(emp=>{
    const row = document.createElement('div')
    row.className = 'flex items-center gap-3 rounded-xl border px-3 py-2'
    row.innerHTML = `
      <input type="checkbox" class="av-chk" data-id="${emp.id}" ${selected.has(String(emp.id))?'checked':''}/>
      <div class="grow font-medium">${emp.full_name}</div>
      <input type="text" class="input av-note" data-id="${emp.id}" placeholder="הערה…" style="max-width:260px" value="${(notesMap.get(String(emp.id))||'').replaceAll('"','&quot;')}"/>
    `
    wrapper.appendChild(row)
  })
  body.appendChild(wrapper)

  // שמירה
  btnSave.onclick = async (ev)=>{
    ev.preventDefault()
    const chks  = [...body.querySelectorAll('.av-chk')]
    const notes = new Map([...body.querySelectorAll('.av-note')].map(i=>[String(i.getAttribute('data-id')), i.value.trim()]))

    const want = new Set(chks.filter(c=>c.checked).map(c=>String(c.getAttribute('data-id'))))
    const cur  = new Set(av.map(x=>String(x.employee_id)))

    const toInsert = [...want].filter(id => !cur.has(id))
    const toDelete = [...cur].filter(id => !want.has(id))
    const toUpdate = [...want].filter(id => cur.has(id) && (notes.get(id) !== (notesMap.get(id)||'')))

    // insert
    if (toInsert.length){
      const rows = toInsert.map(id => ({ employee_id: id, week_start: wstart, day_of_week: dow, slot, note: notes.get(id) || null }))
      const { error } = await supabase.from('availability').insert(rows)
      if (error) { alert(error.message); return }
    }
    // update notes
    for (const id of toUpdate){
      const { error } = await supabase
        .from('availability').update({ note: notes.get(id) || null })
        .eq('employee_id', id).eq('week_start', wstart).eq('day_of_week', dow).eq('slot', slot)
      if (error) { alert(error.message); return }
    }
    // delete
    if (toDelete.length){
      const { error } = await supabase
        .from('availability').delete()
        .eq('week_start', wstart).eq('day_of_week', dow).eq('slot', slot)
        .in('employee_id', toDelete)
      if (error) { alert(error.message); return }
    }

    dlg.close()
    alert('הזמינות נשמרה ✅')
  }

  dlg.showModal()
}

/* ===== Employee (optional) ===== */
function initEmployee(employeeId){
  employeeSection?.classList.remove('hidden')
  if (avWeekStart) avWeekStart.value = isoSundayOf(isoToday())
  btnAvSave?.addEventListener('click', async ()=>{
    const week_start = avWeekStart.value
    const day_of_week = +avDay.value
    const slot = avSlot.value
    const note = avNote.value || null
    const { error } = await supabase.from('availability').insert({ employee_id: employeeId, week_start, day_of_week, slot, note })
    if (error) return alert(error.message)
    alert('הזמינות נשלחה ✅')
  })
}
</script>
