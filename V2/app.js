// app.js (fixed login wiring)
// טעינת Supabase
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = window.__SUPABASE_URL__  || 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON = window.__SUPABASE_ANON_KEY__ || 'YOUR-ANON-PUBLIC-KEY';

// שים לב: אנחנו עובדים על סכימת shifts
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { db: { schema: 'shifts' } });
window.supa = supabase; // לעזרה בדיבוג

// ===== DOM refs (נאתר אחרי ש-DOM מוכן) =====
let el = {};
function cacheEls() {
  el.authSection     = document.getElementById('authSection') || document.getElementById('loginForm')?.closest('section') || document;
  el.employeeSection = document.getElementById('employeeSection');
  el.managerSection  = document.getElementById('managerSection');
  el.whoami          = document.getElementById('whoami');
  el.btnSignOut      = document.getElementById('btnSignOut');
  el.btnSignIn       = document.getElementById('btnSignIn');
  el.loginForm       = document.getElementById('loginForm'); // אם יש טופס
  el.email           = document.getElementById('email');
  el.password        = document.getElementById('password');
}

// ===== התחברות =====
async function onSignInClick() {
  const email = (el.email?.value || '').trim();
  const password = el.password?.value || '';
  if (!email || !password) {
    alert('נא למלא אימייל וסיסמה');
    return;
  }

  // אינדיקציה קצרה על הכפתור
  const btn = el.btnSignIn;
  const oldTxt = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'מתחבר…'; }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (btn) { btn.disabled = false; btn.textContent = oldTxt || 'כניסה'; }

  if (error) {
    alert('שגיאת התחברות: ' + error.message);
    return;
  }
  await afterAuth();
}

function bindAuthHandlers() {
  // Click על הכפתור
  if (el.btnSignIn) el.btnSignIn.addEventListener('click', (e) => {
    e.preventDefault();
    onSignInClick();
  });

  // Submit של הטופס (Enter)
  if (el.loginForm) el.loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    onSignInClick();
  });

  // Enter בשדות גם בלי form
  [el.email, el.password].forEach((input) => {
    if (!input) return;
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        onSignInClick();
      }
    });
  });

  // יציאה
  if (el.btnSignOut) el.btnSignOut.addEventListener('click', async () => {
    await supabase.auth.signOut();
    // ניקוי UI בסיסי
    if (el.whoami) { el.whoami.textContent = ''; el.whoami.classList.add('hidden'); }
    if (el.managerSection) el.managerSection.classList.add('hidden');
    if (el.employeeSection) el.employeeSection.classList.add('hidden');
    if (el.authSection) el.authSection.classList.remove('hidden');
  });
}

// ===== אחרי התחברות: בדיקת תפקיד והצגת המסכים =====
export async function afterAuth() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // UI בסיסי
  if (el.authSection) el.authSection.classList.add('hidden');
  if (el.whoami) { el.whoami.classList.remove('hidden'); el.whoami.textContent = user.email || user.id; }
  if (el.btnSignOut) el.btnSignOut.classList.remove('hidden');

  // שליפת פרופיל (מונע רקורסיה ע"י שאילתה ישירה — בלי RLS מתקדם פה)
  const { data: prof, error } = await supabase
    .from('user_profiles')          // שים לב: בתוך schema shifts כבר הוגדר ב-client
    .select('app_role, employee_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    alert('שגיאת פרופיל: ' + error.message);
    return;
  }

  // ניתוב מסכים
  const role = prof?.app_role || 'employee';
  if (role === 'manager') {
    if (el.managerSection) el.managerSection.classList.remove('hidden');
    if (el.employeeSection) el.employeeSection.classList.add('hidden');
    // יש לך פונקציה קיימת? נקרא לה אם היא קיימת
    if (typeof window.initManager === 'function') {
      try { await window.initManager(); } catch (e) { console.error(e); }
    }
  } else {
    if (el.employeeSection) el.employeeSection.classList.remove('hidden');
    if (el.managerSection) el.managerSection.classList.add('hidden');
    if (typeof window.initEmployee === 'function') {
      try { await window.initEmployee(prof?.employee_id || null); } catch (e) { console.error(e); }
    }
  }
}

// ===== אתחול עם עליית הדף =====
window.addEventListener('DOMContentLoaded', async () => {
  cacheEls();
  bindAuthHandlers();

  // אם יש סשן קיים – לעבור אוטומטית פנימה
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await afterAuth();
  } catch (e) {
    console.error('auth getUser failed', e);
  }
});
