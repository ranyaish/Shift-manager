// employee.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ===== הגדרות (עדכן לערכים שלך) =====
const SUPABASE_URL = 'https://uzaqpwbejceyuhnmfdmq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6YXFwd2JlamNleXVobm1mZG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyODc3NzMsImV4cCI6MjA3MDg2Mzc3M30.Wcuu97xzFvJCt8x2ubHLwc19-ZsfrRLK9YZHICV3T3A';

// Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// אלמנטים
const loginBox = document.getElementById('loginBox')
const employeeBox = document.getElementById('employeeBox')
const btnLogin = document.getElementById('btnLogin')
const btnSignOut = document.getElementById('btnSignOut')
const whoami = document.getElementById('whoami')

const inpUsername = document.getElementById('username')
const inpPassword = document.getElementById('password')

const empFullName = document.getElementById('empFullName')
const empPhone = document.getElementById('empPhone')
const empAddress = document.getElementById('empAddress')
const btnSaveProfile = document.getElementById('btnSaveProfile')

const avDate = document.getElementById('avDate')
const avSlot = document.getElementById('avSlot')
const avNote = document.getElementById('avNote')
const btnSaveAvailability = document.getElementById('btnSaveAvailability')
const myAvail = document.getElementById('myAvail')

// "Session" קלה בלוקאל סטורג'
function setCreds(u, p, emp) {
  localStorage.setItem('empCreds', JSON.stringify({ u, p, emp }))
}
function getCreds() {
  try { return JSON.parse(localStorage.getItem('empCreds') || 'null') } catch { return null }
}
function clearCreds() {
  localStorage.removeItem('empCreds')
}

// עזרי תאריכים
function isoToday() {
  const d = new Date()
  const z = d.getTimezoneOffset() * 60000
  return new Date(Date.now() - z).toISOString().slice(0, 10)
}
function weekLabelFromDate(d) {
  return new Date(d).toLocaleDateString('he-IL', { weekday:'long', day:'2-digit', month:'2-digit' })
}

// ===== כניסה/יציאה =====
btnLogin.addEventListener('click', async () => {
  const username = (inpUsername.value || '').trim()
  const password = inpPassword.value || ''
  if (!username || !password) return alert('נא למלא שם משתמש וסיסמה')

  const { data, error } = await supabase.rpc('employee_login', { p_username: username, p_password: password })
  if (error) return alert('שגיאת כניסה: ' + error.message)
  if (!data || data.length === 0) return alert('שם משתמש או סיסמה שגויים')

  const row = data[0]
  whoami.textContent = row.full_name
  whoami.classList.remove('hidden')
  btnSignOut.classList.remove('hidden')

  // שמירת "סשן" מקומי
  setCreds(username, password, { id: row.employee_id, full_name: row.full_name })

  // מילוי פרופיל
  empFullName.value = row.full_name || ''
  empPhone.value = row.phone || ''
  empAddress.value = row.address || ''

  // UI
  loginBox.classList.add('hidden')
  employeeBox.classList.remove('hidden')

  // זמינות: ברירת מחדל תאריך להיום + ריענון שבוע
  avDate.value = isoToday()
  await refreshMyWeek()
})

btnSignOut.addEventListener('click', () => {
  clearCreds()
  location.reload()
})

// נסה להיכנס אוטומטית אם יש סשן שמור
;(async function autoLogin() {
  const c = getCreds()
  if (!c) return
  inpUsername.value = c.u
  inpPassword.value = c.p
  btnLogin.click()
})()

// ===== פרופיל =====
btnSaveProfile.addEventListener('click', async () => {
  const c = getCreds(); if (!c) return alert('יש להתחבר שוב')
  const { data, error } = await supabase.rpc('employee_update_profile', {
    p_username: c.u,
    p_password: c.p,
    p_phone: empPhone.value || null,
    p_address: empAddress.value || null
  })
  if (error) return alert('שגיאה בשמירת פרופיל: ' + error.message)
  alert('נשמר ✅')
})

// ===== זמינות =====
btnSaveAvailability.addEventListener('click', async () => {
  const c = getCreds(); if (!c) return alert('יש להתחבר שוב')
  const dateISO = avDate.value
  const slot = avSlot.value
  const note = avNote.value || null
  if (!dateISO || !slot) return alert('חסר תאריך או משבצת')

  const { data, error } = await supabase.rpc('employee_upsert_availability', {
    p_username: c.u,
    p_password: c.p,
    p_date: dateISO,
    p_slot: slot,
    p_note: note
  })
  if (error) return alert('שגיאה בשמירת זמינות: ' + error.message)

  avNote.value = ''
  await refreshMyWeek()
  alert('הזמינות נשמרה ✅')
})

async function refreshMyWeek() {
  const c = getCreds(); if (!c) return
  const anchor = avDate.value || isoToday()
  const { data, error } = await supabase.rpc('employee_week_availability', {
    p_username: c.u,
    p_password: c.p,
    p_anchor: anchor
  })
  if (error) { myAvail.innerHTML = `<div class="text-red-600">${error.message}</div>`; return }
  if (!data || data.length === 0) { myAvail.innerHTML = `<div class="text-gray-500">אין זמינויות בשבוע זה.</div>`; return }

  const days = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת']
  myAvail.innerHTML = ''
  data.forEach(r => {
    const row = document.createElement('div')
    row.className = 'p-3 rounded-xl bg-gray-50 flex items-center justify-between'
    row.innerHTML = `
      <div>
        <div class="font-semibold">${days[r.day_of_week]} · ${slotName(r.slot)}</div>
        ${r.note ? `<div class="text-xs text-gray-600">${r.note}</div>` : ''}
      </div>
      <span class="tag">${new Date(r.week_start).toLocaleDateString('he-IL')}</span>
    `
    myAvail.appendChild(row)
  })
}

function slotName(s){ return s==='lunch'?'צהריים':(s==='dinner'?'ערב':'ארוכה') }
