// config.js

// כתובת הפרויקט שלך ב-Supabase
const SUPABASE_URL = 'https://uzaqpwbejceyuhnmfdmq.supabase.co';

// המפתח anon של הפרויקט (שמתאים לשימוש מהדפדפן)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6YXFwd2JlamNleXVobm1mZG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyODc3NzMsImV4cCI6MjA3MDg2Mzc3M30.Wcuu97xzFvJCt8x2ubHLwc19-ZsfrRLK9YZHICV3T3A';

// יצירת הלקוח והצמדתו ל-window לשימוש בכל שאר הקבצים
window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
