// employee.js (ללא import ובלי createClient כאן)
// נדרש: בקובץ config.js טען:
// const SUPABASE_URL = '...'; const SUPABASE_ANON_KEY = '...';
// window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(function () {
  'use strict';

  // ודא שהלקוח קיים מהקובץ config.js
  if (!window.supabase) {
    alert('Supabase לא אותחל. ודא שהקובץ config.js נטען לפני employee.js');
    return;
  }
  const supabase = window.supabase;

  // ----- אלמנטים -----
  const loginBox = document.getElementById('loginBox');
  const employeeBox = document.getElementById('employeeBox');
  const btnLogin = document.getElementById('btnLogin');
  const btnSignOut = document.getElementById('btnSignOut');
  const whoami = document.getElementById('whoami');

  const inpUsername = document.getElementById('username');
  const inpPassword = document.getElementById('password');

  const empFullName = document.getElementById('empFullName');
  const empPhone = document.getElementById('empPhone');
  const empAddress = document.getElementById('empAddress');
  const btnSaveProfile = document.getElementById('btnSaveProfile');

  const avDate = document.getElementById('avDate');
  const avSlot = document.getElementById('avSlot');
  const avNote = document.getElementById('avNote');
  const btnSaveAvailability = document.getElementById('btnSaveAvailability');
  const myAvail = document.getElementById('myAvail');

  // ----- "Session" בלוקאל-סטורג' -----
  function setCreds(u, p, emp) {
    localStorage.setItem('empCreds', JSON.stringify({ u, p, emp }));
  }
  function getCreds() {
    try {
      return JSON.parse(localStorage.getItem('empCreds') || 'null');
    } catch {
      return null;
    }
  }
  function clearCreds() {
    localStorage.removeItem('empCreds');
  }

  // ----- עזרי תאריכים -----
  function isoToday() {
    const z = new Date().getTimezoneOffset() * 60000;
    return new Date(Date.now() - z).toISOString().slice(0, 10);
  }
  function slotName(s) {
    return s === 'lunch' ? 'צהריים' : (s === 'dinner' ? 'ערב' : 'ארוכה');
  }

  // ----- כניסה -----
  btnLogin.addEventListener('click', async () => {
    const username = (inpUsername.value || '').trim();
    const password = inpPassword.value || '';
    if (!username || !password) {
      alert('נא למלא שם משתמש וסיסמה');
      return;
    }

    const { data, error } = await supabase.rpc('employee_login', {
      p_username: username,
      p_password: password
    });

    if (error) {
      alert('שגיאת כניסה: ' + error.message);
      return;
    }
    if (!data || data.length === 0) {
      alert('שם משתמש או סיסמה שגויים');
      return;
    }

    const row = data[0];
    whoami.textContent = row.full_name;
    whoami.classList.remove('hidden');
    btnSignOut.classList.remove('hidden');

    setCreds(username, password, { id: row.employee_id, full_name: row.full_name });

    empFullName.value = row.full_name || '';
    empPhone.value = row.phone || '';
    empAddress.value = row.address || '';

    loginBox.classList.add('hidden');
    employeeBox.classList.remove('hidden');

    avDate.value = isoToday();
    await refreshMyWeek();
  });

  // ----- יציאה -----
  btnSignOut.addEventListener('click', () => {
    clearCreds();
    location.reload();
  });

  // נסה להיכנס אוטומטית אם יש סשן שמור
  (async function autoLogin() {
    const c = getCreds();
    if (!c) return;
    inpUsername.value = c.u;
    inpPassword.value = c.p;
    btnLogin.click();
  })();

  // ----- עדכון פרופיל -----
  btnSaveProfile.addEventListener('click', async () => {
    const c = getCreds();
    if (!c) {
      alert('יש להתחבר שוב');
      return;
    }
    const { error } = await supabase.rpc('employee_update_profile', {
      p_username: c.u,
      p_password: c.p,
      p_phone: empPhone.value || null,
      p_address: empAddress.value || null
    });
    if (error) {
      alert('שגיאה בשמירת פרופיל: ' + error.message);
      return;
    }
    alert('נשמר ✅');
  });

  // ----- שמירת זמינות -----
  btnSaveAvailability.addEventListener('click', async () => {
    const c = getCreds();
    if (!c) {
      alert('יש להתחבר שוב');
      return;
    }
    const dateISO = avDate.value;
    const slot = avSlot.value;
    const note = avNote.value || null;
    if (!dateISO || !slot) {
      alert('חסר תאריך או משבצת');
      return;
    }

    const { error } = await supabase.rpc('employee_upsert_availability', {
      p_username: c.u,
      p_password: c.p,
      p_date: dateISO,
      p_slot: slot,
      p_note: note
    });

    if (error) {
      alert('שגיאה בשמירת זמינות: ' + error.message);
      return;
    }

    avNote.value = '';
    await refreshMyWeek();
    alert('הזמינות נשמרה ✅');
  });

  // ----- טעינת זמינויות לשבוע -----
  async function refreshMyWeek() {
    const c = getCreds();
    if (!c) return;
    const anchor = avDate.value || isoToday();

    const { data, error } = await supabase.rpc('employee_week_availability', {
      p_username: c.u,
      p_password: c.p,
      p_anchor: anchor
    });

    if (error) {
      myAvail.innerHTML = `<div class="text-red-600">${error.message}</div>`;
      return;
    }
    if (!data || data.length === 0) {
      myAvail.innerHTML = `<div class="text-gray-500">אין זמינויות בשבוע זה.</div>`;
      return;
    }

    const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    myAvail.innerHTML = '';
    data.forEach(r => {
      const row = document.createElement('div');
      row.className = 'p-3 rounded-xl bg-gray-50 flex items-center justify-between';
      row.innerHTML = `
        <div>
          <div class="font-semibold">${days[r.day_of_week]} · ${slotName(r.slot)}</div>
          ${r.note ? `<div class="text-xs text-gray-600">${r.note}</div>` : ''}
        </div>
        <span class="tag">${new Date(r.week_start).toLocaleDateString('he-IL')}</span>
      `;
      myAvail.appendChild(row);
    });
  }
})();
