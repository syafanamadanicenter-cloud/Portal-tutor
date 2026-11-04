import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
         createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
         query, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------- util ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const p2 = n => ('0' + n).slice(-2);
const fmtD = d => p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
const fmtDT = d => fmtD(d) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
const isoD = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const HARI = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const HARI_ORDER = [1,2,3,4,5,6,0];
const BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const PROG = [
  { k:'REGULAR', n:'Regular',       m:/REGULAR/ },
  { k:'PAGI',    n:'Privat Pagi',   m:/PRIVAT\s*PAGI/ },
  { k:'SORE',    n:'Privat Sore',   m:/PRIVAT\s*SORE/ },
  { k:'MALAM',   n:'Privat Malam',  m:/PRIVAT\s*MALAM/ },
  { k:'ONLINE',  n:'Privat Online', m:/PRIVAT\s*ONLINE/ },
  { k:'DIPLOMA', n:'Diploma 1 Perhotelan', m:/DIPLOMA/ }
];
const progName = k => (PROG.find(p => p.k === k) || { n: k }).n;
const progOpts = sel => PROG.map(p => `<option value="${p.k}" ${p.k === sel ? 'selected' : ''}>${p.n}</option>`).join('');
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 3200);
}
function authMsg(e) {
  const c = (e && e.code) || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'Email atau password salah.';
  if (/too-many-requests/.test(c)) return 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.';
  if (/network/.test(c)) return 'Tidak ada koneksi internet.';
  if (/email-already-in-use/.test(c)) return 'Email sudah terdaftar.';
  if (/weak-password/.test(c)) return 'Password minimal 6 karakter.';
  return 'Terjadi kesalahan: ' + (e.message || c);
}

/* ---------- state ---------- */
let me = null;            // profil tutors/{uid}
let cfg = null;           // pengaturan
let page = 'profil';
const DEFAULT_CFG = { tReg: 20000, tPriv: 25000, tDip: 0, periodStart: '2026-07-07', periodMonths: 3 };
const rateOf = (prog, c) => prog === 'REGULAR' ? +c.tReg : prog === 'DIPLOMA' ? +c.tDip : +c.tPriv;

/* ---------- data ---------- */
async function loadCfg() {
  const s = await getDoc(doc(db, 'settings', 'config'));
  cfg = Object.assign({}, DEFAULT_CFG, s.exists() ? s.data() : {});
}
const mapDocs = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
async function getAttendance(uid) {
  const s = await getDocs(query(collection(db, 'attendance'), where('tutorUid', '==', uid)));
  return mapDocs(s).sort((a, b) => a.ts - b.ts);
}
async function getSchedules(uid) {
  const s = await getDocs(query(collection(db, 'schedules'), where('tutorUid', '==', uid)));
  return mapDocs(s);
}
async function getSubs(uid) {
  const a = await getDocs(query(collection(db, 'substitutions'), where('originalUid', '==', uid)));
  const b = await getDocs(query(collection(db, 'substitutions'), where('substituteUid', '==', uid)));
  const m = {}; mapDocs(a).concat(mapDocs(b)).forEach(x => m[x.id] = x);
  return Object.values(m).sort((x, y) => (y.date || '').localeCompare(x.date || ''));
}
async function getPayouts(uid) {
  const s = await getDocs(query(collection(db, 'payouts'), where('tutorUid', '==', uid)));
  const m = {}; mapDocs(s).forEach(x => m[x.period] = x); return m;
}

/* ---------- periode gaji ---------- */
function addMonths(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
}
function getPeriods() {
  const st = new Date(cfg.periodStart + 'T00:00:00'), n = Math.max(1, +cfg.periodMonths || 3), now = new Date(), out = [];
  for (let i = 0; i < 200; i++) {
    const s = addMonths(st, i * n), e = addMonths(st, (i + 1) * n);
    if (s > now) break;
    out.push({ i, s, e, last: new Date(e.getTime() - 86400000), running: now < e });
  }
  return out;
}
function countByProg(list, s, e) {
  const c = {}; let total = 0, pay = 0;
  list.forEach(a => {
    if (a.ts >= s.getTime() && a.ts < e.getTime()) { c[a.prog] = (c[a.prog] || 0) + 1; total++; pay += rateOf(a.prog, cfg); }
  });
  return { c, total, pay };
}

/* ---------- navigasi ---------- */
const MENU_TUTOR = [['profil', 'Profil & Jadwal'], ['kehadiran', 'Kehadiran & Penggantian'], ['gaji', 'Gaji']];
const MENU_ADMIN = [['a_tutor', 'Kelola Tutor'], ['a_jadwal', 'Kelola Jadwal'], ['a_ganti', 'Penggantian'], ['a_absen', 'Data Absensi'], ['a_gaji', 'Gaji & Pengaturan']];
const TITLES = Object.fromEntries(MENU_TUTOR.concat(MENU_ADMIN));

function buildMenu() {
  let h = '';
  const item = ([k, t]) => `<button class="menuitem ${k === page ? 'active' : ''}" data-go="${k}">${t}</button>`;
  h += MENU_TUTOR.map(item).join('');
  if (me.role === 'admin') h += '<div class="sect">Admin</div>' + MENU_ADMIN.map(item).join('');
  $('#menuItems').innerHTML = h;
}
function openDrawer(o) { $('#drawer').classList.toggle('open', o); $('#scrim').hidden = !o; }
$('#menuBtn').onclick = () => openDrawer(true);
$('#scrim').onclick = () => openDrawer(false);
$('#menuItems').onclick = e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); };
$('#logout').onclick = () => signOut(auth);

async function go(p) {
  page = p; openDrawer(false); buildMenu();
  $('#pageTitle').textContent = TITLES[p];
  $('#content').innerHTML = '<div class="empty">Memuat...</div>';
  $('#content').onclick = null; $('#content').onchange = null;
  try { await PAGES[p](); } catch (e) { console.error(e); $('#content').innerHTML = '<div class="warn">Gagal memuat: ' + esc(e.message) + '</div>'; }
  window.scrollTo(0, 0);
}
const view = h => $('#content').innerHTML = h;

/* ---------- login ---------- */
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await signInWithEmailAndPassword(auth, $('#email').value.trim(), $('#password').value); }
  catch (err) { $('#loginErr').textContent = authMsg(err); }
};
$('#forgot').onclick = async e => {
  e.preventDefault();
  const em = $('#email').value.trim();
  if (!em) { $('#loginErr').textContent = 'Isi email dulu, lalu tekan Lupa password.'; return; }
  try { await sendPasswordResetEmail(auth, em); $('#loginErr').textContent = ''; toast('Link reset password dikirim ke email.'); }
  catch (err) { $('#loginErr').textContent = authMsg(err); }
};
onAuthStateChanged(auth, async user => {
  $('#loading').hidden = true;
  if (!user) { me = null; $('#appView').hidden = true; $('#loginView').hidden = false; return; }
  try {
    const s = await getDoc(doc(db, 'tutors', user.uid));
    if (!s.exists()) {
      await signOut(auth);
      $('#loginErr').textContent = 'Akun belum terdaftar sebagai tutor. Hubungi admin.';
      return;
    }
    me = { uid: user.uid, ...s.data() };
    await loadCfg();
    $('#whoName').textContent = me.nama; $('#whoRole').textContent = me.role === 'admin' ? 'Admin' : 'Tutor';
    $('#loginView').hidden = true; $('#appView').hidden = false;
    go('profil');
  } catch (err) { $('#loginErr').textContent = 'Gagal memuat akun: ' + err.message; $('#loginView').hidden = false; }
});

/* ---------- halaman tutor ---------- */
const PAGES = {};

PAGES.profil = async () => {
  const sch = await getSchedules(me.uid);
  const today = new Date().getDay();
  const kelas = (me.kelas || []);
  let h = `<div class="card"><h2>Profil</h2>
    <div><b>${esc(me.nama)}</b></div><div class="muted">${esc(me.email)}</div>
    <h2 style="margin-top:14px">Kelas yang dipegang</h2>
    ${kelas.length ? kelas.map(k => `<span class="chip">${esc(k)}</span>`).join('') : '<div class="empty">Belum ada kelas. Hubungi admin.</div>'}
  </div>`;
  h += '<div class="card"><h2>Jadwal mengajar</h2>';
  if (!sch.length) h += '<div class="empty">Belum ada jadwal.</div>';
  else {
    h += '<div class="tw"><table><tr><th>Hari</th><th>Jam</th><th>Program</th><th>Kelas</th></tr>';
    HARI_ORDER.forEach(hr => sch.filter(x => +x.hari === hr).sort((a, b) => a.mulai.localeCompare(b.mulai)).forEach(x => {
      h += `<tr class="${hr === today ? 'today' : ''}"><td>${HARI[hr]}${hr === today ? ' (hari ini)' : ''}</td><td>${esc(x.mulai)} - ${esc(x.selesai)}</td><td>${esc(progName(x.prog))}</td><td>${esc(x.kelas)}</td></tr>`;
    }));
    h += '</table></div>';
  }
  view(h + '</div>');
};

PAGES.kehadiran = async () => {
  const [att, subs] = await Promise.all([getAttendance(me.uid), getSubs(me.uid)]);
  const digantikan = subs.filter(s => s.originalUid === me.uid);
  const menggantikan = subs.filter(s => s.substituteUid === me.uid);
  const byP = {}, byM = {};
  att.forEach(a => {
    byP[a.prog] = (byP[a.prog] || 0) + 1;
    const d = new Date(a.ts), k = d.getFullYear() * 100 + d.getMonth(); byM[k] = (byM[k] || 0) + 1;
  });
  let h = `<div class="stats">
    <div class="stat"><b>${att.length}</b>Total masuk</div>
    <div class="stat"><b>${digantikan.length}</b>Digantikan tutor lain</div>
    <div class="stat"><b>${menggantikan.length}</b>Menggantikan tutor lain</div></div>`;
  h += '<div class="card"><h2>Masuk per program</h2>';
  h += Object.keys(byP).length ? '<div class="tw"><table>' + PROG.filter(p => byP[p.k]).map(p => `<tr><td>${p.n}</td><td class="r">${byP[p.k]}x</td></tr>`).join('') + '</table></div>' : '<div class="empty">Belum ada absensi.</div>';
  h += '</div><div class="card"><h2>Masuk per bulan</h2>';
  h += Object.keys(byM).length ? '<div class="tw"><table>' + Object.keys(byM).map(Number).sort((a, b) => b - a).map(k => `<tr><td>${BULAN[k % 100]} ${Math.floor(k / 100)}</td><td class="r">${byM[k]}x</td></tr>`).join('') + '</table></div>' : '<div class="empty">-</div>';
  h += '</div><div class="card"><h2>Riwayat penggantian</h2>';
  if (!subs.length) h += '<div class="empty">Belum ada penggantian.</div>';
  else {
    h += '<div class="tw"><table><tr><th>Tanggal</th><th>Keterangan</th><th>Kelas</th></tr>';
    subs.forEach(s => {
      const mine = s.originalUid === me.uid;
      h += `<tr><td>${esc(s.date)}</td><td>${mine ? 'Digantikan oleh <b>' + esc(s.substituteNama) + '</b>' : 'Menggantikan <b>' + esc(s.originalNama) + '</b>'}${s.note ? '<div class="muted">' + esc(s.note) + '</div>' : ''}</td><td>${esc(progName(s.prog))}${s.kelas ? ' / ' + esc(s.kelas) : ''}</td></tr>`;
    });
    h += '</table></div>';
  }
  h += '</div><div class="card"><h2>Riwayat masuk (30 terakhir)</h2>';
  if (!att.length) h += '<div class="empty">Belum ada absensi.</div>';
  else h += '<div class="tw"><table><tr><th>Waktu</th><th>Program</th></tr>' + att.slice(-30).reverse().map(a => `<tr><td>${fmtDT(new Date(a.ts))}</td><td>${esc(progName(a.prog))}</td></tr>`).join('') + '</table></div>';
  view(h + '</div>');
};

PAGES.gaji = async () => {
  const [att, pay] = await Promise.all([getAttendance(me.uid), getPayouts(me.uid)]);
  const ps = getPeriods().reverse();
  let h = `<div class="card"><div class="muted">Gaji dihitung dari jumlah absen x tarif (Regular ${rp(cfg.tReg)}/meeting, Privat ${rp(cfg.tPriv)}/sesi) dan dibayarkan setiap ${esc(cfg.periodMonths)} bulan sekali.</div></div>`;
  ps.forEach(p => {
    const r = countByProg(att, p.s, p.e), paid = pay[p.i] && pay[p.i].paid;
    const badge = p.running ? '<span class="badge b-run">Berjalan</span>' : paid ? '<span class="badge b-ok">Sudah dibayar</span>' : '<span class="badge b-wait">Menunggu pembayaran</span>';
    h += `<div class="card"><h2>Periode ${p.i + 1}: ${fmtD(p.s)} - ${fmtD(p.last)} ${badge}</h2>
      <div class="muted">${p.running ? 'Estimasi cair' : 'Jadwal cair'}: ${fmtD(p.e)}</div>
      <div class="tw"><table><tr><th>Program</th><th class="r">Jumlah</th><th class="r">Tarif</th><th class="r">Subtotal</th></tr>`;
    const rows = PROG.filter(x => r.c[x.k]);
    h += rows.length ? rows.map(x => `<tr><td>${x.n}</td><td class="r">${r.c[x.k]}</td><td class="r">${rp(rateOf(x.k, cfg))}</td><td class="r">${rp(r.c[x.k] * rateOf(x.k, cfg))}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Belum ada absensi pada periode ini.</td></tr>';
    h += `<tr class="tot"><td>TOTAL</td><td class="r">${r.total}</td><td></td><td class="r">${rp(r.pay)}</td></tr></table></div></div>`;
  });
  view(h);
};

/* ---------- halaman admin ---------- */
const allTutors = async () => mapDocs(await getDocs(collection(db, 'tutors'))).sort((a, b) => a.nama.localeCompare(b.nama));
const tutorOpts = (ts, sel) => ts.map(t => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.nama)}</option>`).join('');

PAGES.a_tutor = async () => {
  const ts = await allTutors();
  let h = `<div class="card"><h2>Tambah tutor</h2>
    <div class="row2"><div><label>Nama (sama dengan di absensi, mis. Mr. Zaen)</label><input id="nNama"></div>
    <div><label>Email</label><input id="nEmail" type="email"></div>
    <div><label>Password awal (min. 6)</label><input id="nPass"></div></div>
    <label>Kelas yang dipegang (pisahkan koma)</label><input id="nKelas" placeholder="Regular, Privat Pagi, Privat Malam">
    <button class="btn" id="addTutor">Tambah tutor</button></div>
    <div class="card"><h2>Daftar tutor (${ts.length})</h2><div class="tw"><table><tr><th>Nama</th><th>Email</th><th>Kelas</th><th></th></tr>`;
  ts.forEach(t => h += `<tr><td>${esc(t.nama)}${t.role === 'admin' ? ' <span class="badge b-run">admin</span>' : ''}</td><td>${esc(t.email)}</td><td>${esc((t.kelas || []).join(', '))}</td>
    <td><button class="btn sm sec" data-edit="${esc(t.id)}">Ubah</button> <button class="btn sm sec" data-reset="${esc(t.email)}">Reset PW</button> ${t.id === me.uid ? '' : `<button class="btn sm danger" data-del="${esc(t.id)}">Hapus</button>`}</td></tr>`);
  view(h + '</table></div><div class="muted">Hapus hanya menghilangkan profil &amp; akses tutor. Akun login-nya bisa dihapus manual di Firebase Console &gt; Authentication.</div></div>');
  $('#addTutor').onclick = async () => {
    const nama = $('#nNama').value.trim(), email = $('#nEmail').value.trim(), pass = $('#nPass').value;
    const kelas = $('#nKelas').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!nama || !email || pass.length < 6) return toast('Nama, email, dan password (min. 6) wajib diisi.');
    const sec = initializeApp(firebaseConfig, 'sec' + Date.now());
    try {
      const a = getAuth(sec);
      const cred = await createUserWithEmailAndPassword(a, email, pass);
      await setDoc(doc(db, 'tutors', cred.user.uid), { nama, email, role: 'tutor', kelas });
      await signOut(a); toast('Tutor ditambahkan.'); go('a_tutor');
    } catch (e) { toast(authMsg(e)); } finally { await deleteApp(sec); }
  };
  $('#content').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.edit) {
      const t = ts.find(x => x.id === b.dataset.edit);
      const nama = prompt('Nama tutor:', t.nama); if (nama === null) return;
      const kelas = prompt('Kelas (pisahkan koma):', (t.kelas || []).join(', ')); if (kelas === null) return;
      await setDoc(doc(db, 'tutors', t.id), { nama: nama.trim() || t.nama, kelas: kelas.split(',').map(s => s.trim()).filter(Boolean) }, { merge: true });
      toast('Tersimpan.'); go('a_tutor');
    } else if (b.dataset.reset) {
      try { await sendPasswordResetEmail(auth, b.dataset.reset); toast('Link reset dikirim ke ' + b.dataset.reset); } catch (er) { toast(authMsg(er)); }
    } else if (b.dataset.del) {
      const t = ts.find(x => x.id === b.dataset.del);
      if (confirm('Hapus profil ' + t.nama + '? Jadwal dan absensi lama tidak ikut terhapus.')) { await deleteDoc(doc(db, 'tutors', t.id)); go('a_tutor'); }
    }
  };
};

PAGES.a_jadwal = async () => {
  const ts = await allTutors();
  const sch = mapDocs(await getDocs(collection(db, 'schedules')));
  const nm = id => (ts.find(t => t.id === id) || { nama: '(terhapus)' }).nama;
  let h = `<div class="card"><h2>Tambah jadwal</h2><div class="row2">
    <div><label>Tutor</label><select id="jT">${tutorOpts(ts)}</select></div>
    <div><label>Hari</label><select id="jH">${HARI_ORDER.map(i => `<option value="${i}">${HARI[i]}</option>`).join('')}</select></div>
    <div><label>Mulai</label><input id="jM" type="time" value="14:00"></div>
    <div><label>Selesai</label><input id="jS" type="time" value="15:00"></div>
    <div><label>Program</label><select id="jP">${progOpts()}</select></div>
    <div><label>Nama kelas / keterangan</label><input id="jK" placeholder="mis. Kelas Bahasa Inggris"></div></div>
    <button class="btn" id="addJ">Tambah jadwal</button></div>
    <div class="card"><h2>Semua jadwal (${sch.length})</h2><div class="tw"><table><tr><th>Tutor</th><th>Hari</th><th>Jam</th><th>Program</th><th>Kelas</th><th></th></tr>`;
  sch.sort((a, b) => nm(a.tutorUid).localeCompare(nm(b.tutorUid)) || HARI_ORDER.indexOf(+a.hari) - HARI_ORDER.indexOf(+b.hari) || a.mulai.localeCompare(b.mulai))
    .forEach(x => h += `<tr><td>${esc(nm(x.tutorUid))}</td><td>${HARI[x.hari]}</td><td>${esc(x.mulai)}-${esc(x.selesai)}</td><td>${esc(progName(x.prog))}</td><td>${esc(x.kelas)}</td><td><button class="btn sm danger" data-del="${esc(x.id)}">Hapus</button></td></tr>`);
  view(h + '</table></div></div>');
  $('#addJ').onclick = async () => {
    if (!$('#jT').value) return toast('Tambah tutor dulu.');
    await addDoc(collection(db, 'schedules'), { tutorUid: $('#jT').value, hari: +$('#jH').value, mulai: $('#jM').value, selesai: $('#jS').value, prog: $('#jP').value, kelas: $('#jK').value.trim() });
    toast('Jadwal ditambahkan.'); go('a_jadwal');
  };
  $('#content').onclick = async e => { const b = e.target.closest('[data-del]'); if (b && confirm('Hapus jadwal ini?')) { await deleteDoc(doc(db, 'schedules', b.dataset.del)); go('a_jadwal'); } };
};

PAGES.a_ganti = async () => {
  const ts = await allTutors();
  const subs = mapDocs(await getDocs(collection(db, 'substitutions'))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  let h = `<div class="card"><h2>Catat penggantian</h2><div class="row2">
    <div><label>Tanggal</label><input id="gD" type="date" value="${isoD(new Date())}"></div>
    <div><label>Tutor yang digantikan</label><select id="gO">${tutorOpts(ts)}</select></div>
    <div><label>Tutor pengganti</label><select id="gS">${tutorOpts(ts, ts[1] && ts[1].id)}</select></div>
    <div><label>Program</label><select id="gP">${progOpts()}</select></div>
    <div><label>Kelas</label><input id="gK"></div><div><label>Catatan</label><input id="gN"></div></div>
    <button class="btn" id="addG">Simpan</button></div>
    <div class="card"><h2>Riwayat (${subs.length})</h2><div class="tw"><table><tr><th>Tanggal</th><th>Digantikan</th><th>Pengganti</th><th>Program</th><th></th></tr>`;
  subs.forEach(s => h += `<tr><td>${esc(s.date)}</td><td>${esc(s.originalNama)}</td><td>${esc(s.substituteNama)}</td><td>${esc(progName(s.prog))}${s.kelas ? ' / ' + esc(s.kelas) : ''}</td><td><button class="btn sm danger" data-del="${esc(s.id)}">Hapus</button></td></tr>`);
  view(h + '</table></div></div>');
  $('#addG').onclick = async () => {
    const o = ts.find(t => t.id === $('#gO').value), s = ts.find(t => t.id === $('#gS').value);
    if (!o || !s || o.id === s.id) return toast('Pilih dua tutor yang berbeda.');
    await addDoc(collection(db, 'substitutions'), { date: $('#gD').value, originalUid: o.id, originalNama: o.nama, substituteUid: s.id, substituteNama: s.nama, prog: $('#gP').value, kelas: $('#gK').value.trim(), note: $('#gN').value.trim() });
    toast('Tersimpan.'); go('a_ganti');
  };
  $('#content').onclick = async e => { const b = e.target.closest('[data-del]'); if (b && confirm('Hapus catatan ini?')) { await deleteDoc(doc(db, 'substitutions', b.dataset.del)); go('a_ganti'); } };
};

function parseAbsensi(text) {
  const out = [], bad = [];
  text.split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    const m = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) { if (!/timestamp/i.test(line) && /\d/.test(line)) bad.push(line); return; }
    const rest = line.slice(line.indexOf(m[0]) + m[0].length);
    const parts = rest.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
    const prog = (parts[1] || '').toUpperCase(), ket = (parts[2] || 'IN').toUpperCase();
    const pk = (PROG.find(p => p.m.test(prog)) || {}).k;
    if (parts.length < 2 || !pk) { bad.push(line); return; }
    out.push({ ts: new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime(), nama: parts[0], prog: pk, ket });
  });
  return { out, bad };
}

PAGES.a_absen = async () => {
  const ts = await allTutors();
  const att = mapDocs(await getDocs(collection(db, 'attendance')));
  const cnt = {}; att.forEach(a => cnt[a.tutorUid] = (cnt[a.tutorUid] || 0) + 1);
  let h = `<div class="card"><h2>Impor absensi dari Google Sheet</h2>
    <div class="muted">Salin baris dari Sheet (Timestamp, Nama tutor, Program, Keterangan) lalu tempel. Impor ulang aman: data yang sama tidak akan dobel.</div>
    <textarea id="imp" rows="6" placeholder="07/07/2026 12:16:32&#9;Mr. Ardani&#9;KELAS PRIVAT PAGI&#9;IN"></textarea>
    <button class="btn" id="doImp">Impor</button><div id="impRes"></div></div>
    <div class="card"><h2>Jumlah absensi tersimpan (${att.length})</h2><div class="tw"><table>` +
    ts.map(t => `<tr><td>${esc(t.nama)}</td><td class="r">${cnt[t.id] || 0}</td></tr>`).join('') + '</table></div></div>';
  view(h);
  $('#doImp').onclick = async () => {
    const { out, bad } = parseAbsensi($('#imp').value);
    const byName = {}; ts.forEach(t => byName[norm(t.nama)] = t);
    const ok = [], unk = {};
    out.forEach(r => {
      if (r.ket !== 'IN') return;
      const t = byName[norm(r.nama)];
      if (!t) { unk[r.nama] = (unk[r.nama] || 0) + 1; return; }
      ok.push({ id: r.ts + '_' + t.id + '_' + r.prog, data: { tutorUid: t.id, nama: t.nama, prog: r.prog, ts: r.ts } });
    });
    for (let i = 0; i < ok.length; i += 400) {
      const b = writeBatch(db); ok.slice(i, i + 400).forEach(x => b.set(doc(db, 'attendance', x.id), x.data)); await b.commit();
    }
    let r = `<div class="warn">${ok.length} absensi diimpor (yang sudah ada tertimpa dengan data sama).`;
    if (Object.keys(unk).length) r += '<br><b>Nama tutor tidak cocok, dilewati:</b> ' + Object.keys(unk).map(n => esc(n) + ' (' + unk[n] + ')').join(', ') + '. Tambahkan tutor dengan nama persis sama, lalu impor ulang.';
    if (bad.length) r += '<br>' + bad.length + ' baris tidak dikenali.';
    $('#impRes').innerHTML = r + '</div>';
  };
};

PAGES.a_gaji = async () => {
  const ts = (await allTutors());
  const att = mapDocs(await getDocs(collection(db, 'attendance')));
  const pays = mapDocs(await getDocs(collection(db, 'payouts')));
  const ps = getPeriods();
  const sel = Math.min(+(PAGES.a_gaji.sel ?? ps.length - 1), ps.length - 1);
  const p = ps[sel];
  let h = `<div class="card"><h2>Pengaturan tarif & periode</h2><div class="row2">
    <div><label>Tarif Regular / meeting</label><input id="sR" type="number" value="${esc(cfg.tReg)}"></div>
    <div><label>Tarif Privat / sesi</label><input id="sP" type="number" value="${esc(cfg.tPriv)}"></div>
    <div><label>Tarif Diploma</label><input id="sD" type="number" value="${esc(cfg.tDip)}"></div>
    <div><label>Periode mulai</label><input id="sS" type="date" value="${esc(cfg.periodStart)}"></div>
    <div><label>Lama periode (bulan)</label><input id="sN" type="number" min="1" value="${esc(cfg.periodMonths)}"></div></div>
    <button class="btn" id="saveCfg">Simpan pengaturan</button></div>`;
  if (!p) return view(h);
  h += `<div class="card"><h2>Gaji semua tutor</h2><label>Periode</label><select id="selP">${ps.map((x, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>Periode ${x.i + 1}: ${fmtD(x.s)} - ${fmtD(x.last)}${x.running ? ' (berjalan)' : ''}</option>`).join('')}</select>
    <div class="tw" style="margin-top:10px"><table><tr><th>Tutor</th>${PROG.map(x => `<th class="r">${x.n}</th>`).join('')}<th class="r">Total gaji</th><th>Dibayar</th></tr>`;
  let grand = 0;
  ts.forEach(t => {
    const r = countByProg(att.filter(a => a.tutorUid === t.id), p.s, p.e); grand += r.pay;
    const paid = pays.some(x => x.tutorUid === t.id && +x.period === p.i && x.paid);
    h += `<tr><td>${esc(t.nama)}</td>${PROG.map(x => `<td class="r">${r.c[x.k] || 0}</td>`).join('')}<td class="r"><b>${rp(r.pay)}</b></td><td><input type="checkbox" data-pay="${esc(t.id)}" ${paid ? 'checked' : ''} style="width:auto"></td></tr>`;
  });
  h += `<tr class="tot"><td>TOTAL</td><td colspan="${PROG.length}"></td><td class="r">${rp(grand)}</td><td></td></tr></table></div></div>`;
  view(h);
  $('#saveCfg').onclick = async () => {
    const n = { tReg: +$('#sR').value, tPriv: +$('#sP').value, tDip: +$('#sD').value, periodStart: $('#sS').value, periodMonths: Math.max(1, +$('#sN').value || 3) };
    await setDoc(doc(db, 'settings', 'config'), n); cfg = Object.assign({}, DEFAULT_CFG, n); toast('Pengaturan tersimpan.'); go('a_gaji');
  };
  $('#selP').onchange = e => { PAGES.a_gaji.sel = +e.target.value; go('a_gaji'); };
  $('#content').onchange = async e => {
    const c = e.target.closest('[data-pay]'); if (!c) return;
    await setDoc(doc(db, 'payouts', p.i + '_' + c.dataset.pay), { tutorUid: c.dataset.pay, period: p.i, paid: c.checked, paidAt: Date.now() });
    toast(c.checked ? 'Ditandai sudah dibayar.' : 'Tanda dibayar dibatalkan.');
  };
};
