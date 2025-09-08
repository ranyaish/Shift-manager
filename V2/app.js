<!-- shift-manager.js (FULL, updated) -->
<script type="module">
/* ================== Supabase ================== */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://uzaqpwbejceyuhnmfdmq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6YXFwd2JlamNleXVobm1mZG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyODc3NzMsImV4cCI6MjA3MDg2Mzc3M30.Wcuu97xzFvJCt8x2ubHLwc19-ZsfrRLK9YZHICV3T3A';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { db: { schema: 'shifts' } })
window.supa = supabase // debug

/* ============== DOM (IDs expected in HTML) ==============

#whoami, #btnSignOut
#authSection, #employeeSection, #managerSection

Manager controls:
  #wkWeekStart, #btnGenerateWeek, #btnDeleteWeek, #btnPublishWeek
  #weekScroller (horizontal list of days)
  #dayTitle, #btnDayPrev, #btnDayNext, #timelineBox

Employee controls (optional):
  #avWeekStart, #avDay, #avSlot, #avNote, #btnSubmitAvailability

========================================================== */

const whoami = document.getElementById('whoami')
const btnSignOut = document.getElementById('btnSignOut')

const authSection = document.getElementById('authSection')
const managerSection = document.getElementById('managerSection')
const employeeSection = document.getElementById('employeeSection')

/* ================== State ================== */
let currentUser = null
let currentProfile = null
let currentRoster = null          // { id, week_start, status }
let weekDays = []                 // [{date:'YYYY-MM-DD', slots:{ lunch:{id,...}, dinner:{...}, long:{...}}}]
let selectedDayIndex = 0

/* ================== Auth ================== */
const btnSignIn = document.getElementById('btnSignIn')
if (btnSignIn) btnSignIn.addEventListener('click', async () => {
  const email = (document.getElementById('email').value||'').trim()
  const password = document.getElementById('password').value||''
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return alert('שגיאת התחברות: ' + error.message)
  await bootstrapAfterAuth()
})

btnSignOut?.addEventListener('click', async () => {
  await supabase.auth.signOut()
  location.reload()
})

async function bootstrapAfterAuth() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  currentUser = user
  whoami?.classList.remove('hidden')
  whoami && (whoami.textContent = user.email || user.id)

  // profile (with RLS-safe view)
  const { data: prof, error } = await supabase
    .from('user_profiles')
    .select('app_role, employee_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return alert('שגיאת פרופיל: ' + error.message)
  currentProfile = prof || { app_role: 'employee', employee_id: null }

  authSection?.classList.add('hidden')
  if (currentProfile.app_role === 'manager') initManager()
  else initEmployee(currentProfile.employee_id)
}

;(async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (user) bootstrapAfterAuth()
})()

/* ================== Manager ================== */
const elWkStart   = document.getElementById('wkWeekStart')
const btnGenWeek  = document.getElementById('btnGenerateWeek')
const btnDelWeek  = document.getElementById('btnDeleteWeek')
const btnPubWeek  = document.getElementById('btnPublishWeek')

const weekScroller = document.getElementById('weekScroller')
const dayTitle     = document.getElementById('dayTitle')
const btnDayPrev   = document.getElementById('btnDayPrev')
const btnDayNext   = document.getElementById('btnDayNext')
const timelineBox  = document.getElementById('timelineBox')

function isoToday() {
  const d=new Date(); const z=d.getTimezoneOffset()*60000
  return new Date(Date.now()-z).toISOString().slice(0,10)
}
function isoOfSundayAround(dateISO) {
  const d = new Date(dateISO || isoToday())
  // make Sunday (IL): treat Sunday as 0
  const day = d.getDay() === 0 ? 0 : d.getDay()
  const diff = -day // back to Sunday
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()+diff)
  const z=s.getTimezoneOffset()*60000
  return new Date(s - z).toISOString().slice(0,10)
}
function addDays(iso, n){
  const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n)
  const z=d.getTimezoneOffset()*60000
  return new Date(d - z).toISOString().slice(0,10)
}
function fmtHebDate(iso){
  const d=new Date(iso+'T00:00:00')
  return d.toLocaleDateString('he-IL', { weekday:'long', day:'2-digit', month:'2-digit' })
}
function slotName(s){ return s==='lunch'?'צהריים':(s==='dinner'?'ערב':'ארוכה') }

/* ---- Build / Load week (DRAFT persists) ---- */
async function initManager() {
  managerSection?.classList.remove('hidden')
  elWkStart && (elWkStart.value = isoOfSundayAround(isoToday()))

  btnGenWeek?.addEventListener('click', async ()=>{
    await ensureRoster(elWkStart.value)
    await loadWeek(elWkStart.value)
  })
  btnDelWeek?.addEventListener('click', async ()=>{
    if (!currentRoster) return alert('אין שבוע פתוח')
    if (!confirm('למחוק את השבוע כולו (טיוטה/שיבוצים)?')) return
    await deleteRoster(currentRoster.id)
    currentRoster = null
    weekDays = []
    renderWeekColumns()
    renderTimelineUI()
  })
  btnPubWeek?.addEventListener('click', async ()=>{
    if (!currentRoster) return alert('אין שבוע פתוח')
    const { error } = await supabase.from('rosters').update({ status:'published' }).eq('id', currentRoster.id)
    if (error) return alert(error.message)
    alert('השבוע פורסם ✅')
  })

  // אם כבר קיים שבוע טיוטה/פורסם לשבוע שנבחר – טען אותו; אחרת צור טיוטה
  await ensureRoster(elWkStart.value)
  await loadWeek(elWkStart.value)

  btnDayPrev?.addEventListener('click', ()=> changeDay(-1))
  btnDayNext?.addEventListener('click', ()=> changeDay(+1))
}

async function ensureRoster(week_start_iso){
  // מנסה למצוא; אם אין — יוצר טיוטה
  const { data, error } = await supabase
    .from('rosters')
    .select('id, week_start, status')
    .eq('week_start', week_start_iso)
    .maybeSingle()
  if (error) throw error
  if (data) { currentRoster = data; return }

  const { data: created, error: e2 } = await supabase
    .from('rosters')
    .insert({ week_start: week_start_iso, status: 'draft' })
    .select('id, week_start, status')
    .single()
  if (e2) throw e2
  currentRoster = created
}

async function deleteRoster(roster_id){
  // מחיקה רכה: מוחק את השיבוצים/משמרות/זמינויות לשבוע הזה (רק בדוגמה: מוחק קשורים)
  await supabase.rpc('delete_roster_cascade', { p_roster_id: roster_id }).catch(()=>{})
}

/* ---- Load week days + shifts; maintain state ---- */
async function loadWeek(week_start_iso){
  // ימי השבוע (א-ש)
  weekDays = []
  for (let i=0;i<7;i++){
    const dateISO = addDays(week_start_iso, i)
    const { data: shiftRows, error } = await supabase
      .from('shifts')
      .select('id, date, slot, planned_start, planned_end')
      .eq('date', dateISO)
    if (error) { alert(error.message); continue }

    const day = { date: dateISO, slots: {} }
    shiftRows?.forEach(r => { day.slots[r.slot] = r })
    weekDays.push(day)
  }
  selectedDayIndex = 0
  renderWeekColumns()
  renderTimelineUI()
}

/* ================== Week columns (horizontal) ================== */
function renderWeekColumns(){
  if (!weekScroller) return
  weekScroller.innerHTML = ''
  weekScroller.classList.add('flex')
  weekScroller.style.gap = '12px'
  weekScroller.style.overflowX = 'auto'
  weekScroller.style.scrollSnapType = 'x mandatory'

  weekDays.forEach((day, idx)=>{
    const col = document.createElement('div')
    col.className = 'day-col'
    col.style.minWidth = '320px'
    col.style.scrollSnapAlign = 'start'
    col.innerHTML = `
      <div class="font-semibold mb-2">${fmtHebDate(day.date)}</div>
      ${['lunch','dinner','long'].map(slot => `
        <div class="rounded-xl border p-3 mb-3">
          <div class="flex items-center gap-2 mb-2">
            <div class="font-medium">${slotName(slot)}</div>
            <button class="ml-auto text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" data-open-avail="${slot}">⚙ זמינות</button>
          </div>
          <div class="space-y-2" id="as-${day.date}-${slot}"></div>
          <div class="mt-2 flex items-center gap-2">
            <select class="grow border rounded px-2 py-1 text-sm" id="sel-${day.date}-${slot}" disabled></select>
            <button class="px-3 py-1 rounded text-sm text-white" style="background:#34b3f1" id="btn-${day.date}-${slot}" disabled>שבץ</button>
          </div>
        </div>
      `).join('')}
    `
    weekScroller.appendChild(col)

    // wire up lists / selects
    ['lunch','dinner','long'].forEach(async (slot)=>{
      const listEl = col.querySelector(`#as-${day.date}-${slot}`)
      const selEl  = col.querySelector(`#sel-${day.date}-${slot}`)
      const btnEl  = col.querySelector(`#btn-${day.date}-${slot}`)
      const cfgBtn = col.querySelector(`[data-open-avail="${slot}"]`)

      // existing shift?
      const shift = day.slots[slot]
      if (!shift) {
        listEl.innerHTML = `<div class="text-xs text-gray-500">אין משמרת – צור שבוע</div>`
        return
      }

      await refreshAssignmentsUI(listEl, shift.id, day.date)

      // only AVAILABLE employees
      const avail = await fetchAvailableWithNotes(day.date, slot)
      selEl.innerHTML = ''
      if (!avail.length){
        selEl.innerHTML = `<option>אין עובדים זמינים</option>`
        selEl.disabled = true
        btnEl.disabled = true
      } else {
        avail.forEach(a=>{
          const o = document.createElement('option')
          o.value = a.id
          o.textContent = a.full_name + (a.note ? ` — ${a.note}` : '')
          selEl.appendChild(o)
        })
        selEl.disabled = false
        btnEl.disabled = false
      }

      btnEl.addEventListener('click', async ()=>{
        const employee_id = selEl.value
        if (!employee_id) return
        // guard: ensure still available
        const stillAvail = avail.find(x=>String(x.id)===String(employee_id))
        if (!stillAvail) return alert('שיבוץ מותר רק לעובדים שסימנו זמינות למשבצת זו.')

        const start = shift.planned_start || '11:00'
        const end   = shift.planned_end   || '17:00'
        const { error } = await supabase.from('shift_assignments').insert({
          shift_id: shift.id, employee_id, role: 'other', status: 'planned',
          start_time: start, end_time: end
        })
        if (error) {
          if (error.code === '23505') return alert('העובד כבר משובץ במשמרת הזו.')
          return alert(error.message)
        }
        await refreshAssignmentsUI(listEl, shift.id, day.date)
        if (weekDays[selectedDayIndex]?.date === day.date) renderTimelineUI()
      })

      cfgBtn.addEventListener('click', async ()=>{
        await openAvailManager(day.date, slot, currentRoster?.week_start)
        // reload after closing config
        const newAvail = await fetchAvailableWithNotes(day.date, slot)
        selEl.innerHTML = ''
        if (!newAvail.length){ selEl.innerHTML='<option>אין עובדים זמינים</option>'; selEl.disabled=true; btnEl.disabled=true }
        else {
          newAvail.forEach(a=>{
            const o=document.createElement('option')
            o.value=a.id; o.textContent=a.full_name+(a.note?` — ${a.note}`:'')
            selEl.appendChild(o)
          })
          selEl.disabled=false; btnEl.disabled=false
        }
      })
    })
  })

  // select day title
  selectedDayIndex = Math.min(selectedDayIndex, weekDays.length-1)
  updateDayHeader()
}

/* ---- render “timeline” as compact grouped-by-time list ---- */
async function renderTimelineUI(){
  if (!timelineBox || !weekDays.length) return
  const day = weekDays[selectedDayIndex]
  dayTitle && (dayTitle.textContent = fmtHebDate(day.date))

  // collect assignments of all slots of the day
  const shiftIds = Object.values(day.slots||{}).map(s=>s.id)
  if (!shiftIds.length) {
    timelineBox.innerHTML = `<div class="text-sm text-gray-500">אין משמרת ביום זה.</div>`
    return
  }

  const { data: rows, error } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, employee:employee_id(full_name), shift:shift_id(slot)')
    .in('shift_id', shiftIds)
    .order('start_time', { ascending: true })
  if (error) { timelineBox.innerHTML = `<div class="text-red-600">${error.message}</div>`; return }

  // dedupe accidental duplicates (same emp + same shift + same start)
  const seen = new Set()
  const clean = []
  for (const r of rows){
    const key = `${r.shift?.slot}|${r.employee?.full_name}|${r.start_time}`
    if (seen.has(key)) continue
    seen.add(key); clean.push(r)
  }

  // group by start_time (HH:MM)
  const groups = {}
  clean.forEach(r=>{
    const t = r.start_time?.slice(0,5) || '—'
    if (!groups[t]) groups[t] = []
    groups[t].push(r)
  })
  const times = Object.keys(groups).sort()

  timelineBox.innerHTML = ''
  times.forEach(t=>{
    const row = document.createElement('div')
    row.className = 'mb-2'
    row.innerHTML = `
      <div class="text-xs text-gray-500 mb-1">${t}</div>
      <div class="flex flex-wrap gap-2">
        ${groups[t].map(r => `
          <span class="px-3 py-1 rounded-full text-sm" style="background:#BFE8FF">
            ${r.employee?.full_name || '—'}
            <span class="text-[11px] text-gray-600">(${r.start_time?.slice(0,5)}–${r.end_time?.slice(0,5)})</span>
          </span>
        `).join('')}
      </div>
    `
    timelineBox.appendChild(row)
  })
}

/* ---- update header + nav buttons ---- */
function updateDayHeader() {
  const iso = weekDays[selectedDayIndex]?.date
  if (dayTitle && iso) dayTitle.textContent = fmtHebDate(iso)
  btnDayPrev && (btnDayPrev.disabled = selectedDayIndex<=0)
  btnDayNext && (btnDayNext.disabled = selectedDayIndex>=weekDays.length-1)
}
function changeDay(delta){
  const nx = selectedDayIndex + delta
  if (nx < 0 || nx >= weekDays.length) return
  selectedDayIndex = nx
  updateDayHeader()
  renderTimelineUI()
}

/* ================== Assignments – list with edit/remove ================== */
async function refreshAssignmentsUI(container, shift_id, dateISO){
  const { data, error } = await supabase
    .from('shift_assignments')
    .select('id, start_time, end_time, employee:employee_id(full_name)')
    .eq('shift_id', shift_id)
    .order('start_time', { ascending:true })
  if (error) { container.innerHTML = `<div class="text-red-600">${error.message}</div>`; return }

  // sort & dedupe by (employee,start_time)
  const uniq = []
  const keys = new Set()
  data.forEach(r=>{
    const k = `${r.employee?.full_name}|${r.start_time}`
    if (keys.has(k)) return
    keys.add(k); uniq.push(r)
  })

  container.innerHTML = ''
  if (!uniq.length) {
    container.innerHTML = `<div class="text-xs text-gray-500">אין שיבוצים במשמרת זו.</div>`
    return
  }
  uniq.forEach(r=>{
    const card = document.createElement('div')
    card.className = 'flex items-center justify-between bg-white rounded-xl shadow px-3 py-2'
    card.innerHTML = `
      <div>
        <div class="font-medium">${r.employee?.full_name || '—'}</div>
        <div class="text-xs text-gray-600">${(r.start_time||'').slice(0,5)}–${(r.end_time||'').slice(0,5)}</div>
      </div>
      <div class="flex items-center gap-2">
        <button class="px-2 py-1 rounded text-sm bg-gray-200 hover:bg-gray-300" data-edit="${r.id}">ערוך</button>
        <button class="px-2 py-1 rounded text-sm text-white" style="background:#ef4444" data-del="${r.id}">הסר</button>
      </div>
    `
    container.appendChild(card)
  })

  // actions
  container.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-del')
      if (!confirm('להסיר שיבוץ?')) return
      const { error } = await supabase.from('shift_assignments').delete().eq('id', id)
      if (error) return alert(error.message)
      await refreshAssignmentsUI(container, shift_id, dateISO)
      if (weekDays[selectedDayIndex]?.date === dateISO) renderTimelineUI()
    })
  })
  container.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-edit')
      const cur = uniq.find(x=>String(x.id)===String(id))
      const start = prompt('שעת התחלה (HH:MM)', (cur?.start_time||'').slice(0,5) || '11:00')
      if (!start) return
      const end = prompt('שעת סיום (HH:MM)', (cur?.end_time||'').slice(0,5) || '17:00')
      if (!end) return
      const { error } = await supabase.from('shift_assignments').update({ start_time:start, end_time:end }).eq('id', id)
      if (error) return alert(error.message)
      await refreshAssignmentsUI(container, shift_id, dateISO)
      if (weekDays[selectedDayIndex]?.date === dateISO) renderTimelineUI()
    })
  })
}

/* ================== Availability ================== */
/** returns only employees who marked availability for day+slot; includes note */
async function fetchAvailableWithNotes(dateISO, slot){
  const { data, error } = await supabase
    .from('availability')
    .select('employee_id, note, employee:employee_id(full_name)')
    .eq('week_start', isoOfSundayAround(dateISO))
    .eq('day_of_week', new Date(dateISO+'T00:00:00').getDay())  // 0..6 (Sunday..Saturday)
    .eq('slot', slot)
  if (error) { console.error(error); return [] }
  // employees may appear twice -> dedupe by id
  const map = new Map()
  data?.forEach(r=>{
    if (!map.has(r.employee_id)) map.set(r.employee_id, {
      id: r.employee_id, full_name: r.employee?.full_name || '—', note: r.note || ''
    })
  })
  return Array.from(map.values()).sort((a,b)=>a.full_name.localeCompare(b.full_name,'he'))
}

/** simple modal/prompt flow to manage availability for a day+slot (manager view) */
async function openAvailManager(dateISO, slot){
  // Pull list of all active employees
  const { data: emps, error } = await supabase.from('employees').select('id, full_name, active').eq('active', true).order('full_name')
  if (error) return alert(error.message)

  // Pull who is available now
  const avail = await fetchAvailableWithNotes(dateISO, slot)
  const availSet = new Set(avail.map(a=>String(a.id)))

  // crude prompt UI for now
  const names = emps.map(e => `${availSet.has(String(e.id)) ? '✓ ' : '  '}${e.full_name}`).join('\n')
  alert(`סימון זמינות ל: ${fmtHebDate(dateISO)} · ${slotName(slot)}\n\nסימונים נוכחיים:\n${names}\n\n(ממשק עריכה עשיר יותר נבנה בהמשך)`)

  // (Optional) Add quick add/remove by typing exact name:
  const who = prompt('הקלד שם להוספה/הסרה מזמינות, או השאר ריק לסגור:')
  if (!who) return
  const emp = emps.find(e=>e.full_name.trim() === who.trim())
  if (!emp) return alert('לא נמצא עובד בשם הזה.')

  const wstart = isoOfSundayAround(dateISO)
  const dow = new Date(dateISO+'T00:00:00').getDay()

  if (availSet.has(String(emp.id))) {
    // remove availability
    const { error: e2 } = await supabase
      .from('availability')
      .delete()
      .eq('employee_id', emp.id)
      .eq('week_start', wstart)
      .eq('day_of_week', dow)
      .eq('slot', slot)
    if (e2) return alert(e2.message)
  } else {
    const note = prompt('הערה (אופציונלי) עבור הזמינות:') || null
    const { error: e3 } = await supabase
      .from('availability')
      .insert({ employee_id: emp.id, week_start: wstart, day_of_week: dow, slot, note })
    if (e3) return alert(e3.message)
  }
  alert('עודכן.')
}

/* ================== Employee panel (optional) ================== */
function initEmployee(employeeId){
  employeeSection?.classList.remove('hidden')
  const avWeekStart = document.getElementById('avWeekStart')
  const btnSave = document.getElementById('btnSubmitAvailability')
  avWeekStart && (avWeekStart.value = isoOfSundayAround(isoToday()))
  btnSave?.addEventListener('click', async ()=>{
    const week_start = document.getElementById('avWeekStart').value
    const day_of_week = +document.getElementById('avDay').value
    const slot = document.getElementById('avSlot').value
    const note = document.getElementById('avNote').value || null
    const { error } = await supabase.from('availability').insert({ employee_id: employeeId, week_start, day_of_week, slot, note })
    if (error) return alert(error.message)
    alert('הזמינות נשמרה ✅')
  })
}

</script>
