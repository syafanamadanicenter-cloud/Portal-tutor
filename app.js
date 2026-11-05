import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
         createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
         query, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

window.__appStarted = true;
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
const DEFAULT_CFG = { tReg: 20000, tPriv: 25000, tDip: 0, periodStart: '2026-07-07', periodMonths: 3, sheetUrl: '' };
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

/* ---------- bulan jadwal ---------- */
const curMonth = () => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1); };
const prevMonth = m => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 2, 1); return d.getFullYear() + '-' + p2(d.getMonth() + 1); };
const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return BULAN[mo - 1] + ' ' + y; };
const inMonth = (x, m) => !x.bulan || x.bulan === m;

/* ---------- sinkron Google Sheet ---------- */
function toCsvUrl(u) {
  if (!u) return '';
  if (/output=csv/.test(u)) return u;
  const m = u.match(/\/d\/e\/([A-Za-z0-9_-]+)/);
  if (!m) return '';
  const g = u.match(/[?&#]gid=(\d+)/);
  return 'https://docs.google.com/spreadsheets/d/e/' + m[1] + '/pub?output=csv' + (g ? '&gid=' + g[1] : '');
}

/* ---------- gaji berjalan (sejak pembayaran terakhir) ---------- */
const dayAfter = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d + 1); };
const payStart = pt => pt ? dayAfter(pt) : new Date(cfg.periodStart + 'T00:00:00');
async function lastPaid(uid) { const x = await getDoc(doc(db, 'payouts', 'last_' + uid)); return x.exists() ? x.data().paidThrough : null; }
const isoToD = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

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
    if (me.role === 'admin' && cfg.sheetUrl) {
      allTutors().then(ts => syncSheet(ts)).then(r => { if (r.fresh) toast(r.fresh + ' absensi baru disinkron dari Sheet.'); }).catch(() => {});
    }
  } catch (err) { $('#loginErr').textContent = 'Gagal memuat akun: ' + err.message; $('#loginView').hidden = false; }
});

/* ---------- halaman tutor ---------- */
const PAGES = {};

PAGES.profil = async () => {
  const bln = PAGES.profil.bln || curMonth();
  const sch = (await getSchedules(me.uid)).filter(x => inMonth(x, bln));
  const today = new Date().getDay(), isNow = bln === curMonth();
  const kelas = (me.kelas || []);
  let h = `<div class="card"><h2>Profil</h2>
    <div><b>${esc(me.nama)}</b></div><div class="muted">${esc(me.email)}</div>
    <h2 style="margin-top:14px">Kelas yang dipegang</h2>
    ${kelas.length ? kelas.map(k => `<span class="chip">${esc(k)}</span>`).join('') : '<div class="empty">Belum ada kelas. Hubungi admin.</div>'}
  </div>`;
  h += `<div class="card"><h2>Jadwal mengajar</h2><label>Bulan</label><input type="month" id="bln" value="${esc(bln)}" style="max-width:200px">`;
  if (!sch.length) h += `<div class="empty">Belum ada jadwal untuk ${esc(monthLabel(bln))}.</div>`;
  else {
    h += '<div class="tw" style="margin-top:8px"><table><tr><th>Hari</th><th>Jam</th><th>Program</th><th>Kelas</th></tr>';
    HARI_ORDER.forEach(hr => sch.filter(x => +x.hari === hr).sort((a, b) => a.mulai.localeCompare(b.mulai)).forEach(x => {
      const t = isNow && hr === today;
      h += `<tr class="${t ? 'today' : ''}"><td>${HARI[hr]}${t ? ' (hari ini)' : ''}</td><td>${esc(x.mulai)} - ${esc(x.selesai)}</td><td>${esc(progName(x.prog))}</td><td>${esc(x.kelas)}</td></tr>`;
    }));
    h += '</table></div>';
  }
  view(h + '</div>');
  $('#bln').onchange = e => { if (e.target.value) { PAGES.profil.bln = e.target.value; go('profil'); } };
};

PAGES.kehadiran = async () => {
  const attr = await getMyAttendance();
  const att = attr.list;
  const byP = {}, byM = {};
  att.forEach(a => {
    byP[a.prog] = (byP[a.prog] || 0) + 1;
    const d = new Date(a.ts), k = d.getFullYear() * 100 + d.getMonth(); byM[k] = (byM[k] || 0) + 1;
  });
  let h = liveNote(attr.live) + `<div class="stats">
    <div class="stat"><b>${att.length}</b>Total masuk</div></div>`;
  h += '<div class="card"><h2>Masuk per program</h2>';
  h += Object.keys(byP).length ? '<div class="tw"><table>' + PROG.filter(p => byP[p.k]).map(p => `<tr><td>${p.n}</td><td class="r">${byP[p.k]}x</td></tr>`).join('') + '</table></div>' : '<div class="empty">Belum ada absensi.</div>';
  h += '</div><div class="card"><h2>Masuk per bulan</h2>';
  h += Object.keys(byM).length ? '<div class="tw"><table>' + Object.keys(byM).map(Number).sort((a, b) => b - a).map(k => `<tr><td>${BULAN[k % 100]} ${Math.floor(k / 100)}</td><td class="r">${byM[k]}x</td></tr>`).join('') + '</table></div>' : '<div class="empty">-</div>';
  h += '</div><div class="card"><h2>Riwayat masuk (30 terakhir)</h2>';
  if (!att.length) h += '<div class="empty">Belum ada absensi.</div>';
  else h += '<div class="tw"><table><tr><th>Waktu</th><th>Program</th></tr>' + att.slice(-30).reverse().map(a => `<tr><td>${fmtDT(new Date(a.ts))}</td><td>${esc(progName(a.prog))}</td></tr>`).join('') + '</table></div>';
  view(h + '</div>');
};

PAGES.gaji = async () => {
  const [base, pt] = await Promise.all([getAttendance(me.uid), lastPaid(me.uid)]);
  const st = payStart(pt);
  view(`<div class="card"><h2>Gaji berjalan</h2>
    <div class="muted" id="gRange"></div>
    <div class="bigtotal" id="gTotal">Rp0</div>
    <div class="muted">Waktu sekarang: <b id="clock"></b></div>
    <div id="gBody" style="margin-top:10px"></div>
    <div class="muted" style="margin-top:12px">${pt ? 'Terakhir dibayar sampai tanggal <b>' + fmtD(isoToD(pt)) + '</b>. Gaji di atas dihitung dari absen setelah tanggal itu.' : 'Belum ada catatan pembayaran. Gaji dihitung dari awal pencatatan (' + fmtD(st) + ').'}
    Waktu pencairan menyesuaikan yayasan; angka bertambah otomatis setiap Anda absen.</div></div>`);
  const draw = async () => {
    if (page !== 'gaji' || !$('#gBody')) return;
    const a = await getMyAttendance(base), now = new Date();
    const r = countByProg(a.list, st, new Date(now.getTime() + 1));
    $('#gRange').textContent = fmtD(st) + ' - ' + fmtD(now) + ' (hari ini)';
    $('#gTotal').textContent = rp(r.pay);
    const rows = PROG.filter(x => r.c[x.k]);
    $('#gBody').innerHTML = '<table class="gt"><tr><th>Program</th><th class="r">Jumlah</th><th class="r">Subtotal</th></tr>' +
      (rows.length ? rows.map(x => `<tr><td>${x.n}<div class="muted">${rp(rateOf(x.k, cfg))} / sesi</div></td><td class="r">${r.c[x.k]}x</td><td class="r">${rp(r.c[x.k] * rateOf(x.k, cfg))}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">Belum ada absensi setelah pembayaran terakhir.</td></tr>') +
      `<tr class="tot"><td>TOTAL</td><td class="r">${r.total}x</td><td class="r">${rp(r.pay)}</td></tr></table>`;
  };
  await draw();
  const tick = () => { if (page !== 'gaji' || !$('#clock')) return false; const n = new Date(); $('#clock').textContent = fmtD(n) + ' ' + p2(n.getHours()) + ':' + p2(n.getMinutes()) + ':' + p2(n.getSeconds()); return true; };
  tick();
  const t1 = setInterval(() => { if (!tick()) { clearInterval(t1); clearInterval(t2); } }, 1000);
  const t2 = setInterval(() => { draw().catch(() => {}); }, 60000);
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
  const bln = PAGES.a_jadwal.bln || curMonth();
  const ts = await allTutors();
  const all = mapDocs(await getDocs(collection(db, 'schedules')));
  const sch = all.filter(x => inMonth(x, bln));
  const prevCount = all.filter(x => x.bulan === prevMonth(bln)).length;
  const nm = id => (ts.find(t => t.id === id) || { nama: '(terhapus)' }).nama;
  let h = `<div class="card"><h2>Bulan jadwal</h2><div class="row2"><div><label>Pilih bulan</label><input type="month" id="jB" value="${esc(bln)}"></div></div>
    <button class="btn sec" id="copyPrev">Salin jadwal dari ${esc(monthLabel(prevMonth(bln)))} (${prevCount})</button></div>
    <div class="card"><h2>Tambah jadwal ${esc(monthLabel(bln))}</h2><div class="row2">
    <div><label>Tutor</label><select id="jT">${tutorOpts(ts)}</select></div>
    <div><label>Hari</label><select id="jH">${HARI_ORDER.map(i => `<option value="${i}">${HARI[i]}</option>`).join('')}</select></div>
    <div><label>Mulai</label><input id="jM" type="time" value="14:00"></div>
    <div><label>Selesai</label><input id="jS" type="time" value="15:00"></div>
    <div><label>Program</label><select id="jP">${progOpts()}</select></div>
    <div><label>Nama kelas / keterangan</label><input id="jK" placeholder="mis. Kelas Bahasa Inggris"></div></div>
    <button class="btn" id="addJ">Tambah jadwal</button></div>
    <div class="card"><h2>Jadwal ${esc(monthLabel(bln))} (${sch.length})</h2><div class="tw"><table><tr><th>Tutor</th><th>Hari</th><th>Jam</th><th>Program</th><th>Kelas</th><th></th></tr>`;
  sch.sort((a, b) => nm(a.tutorUid).localeCompare(nm(b.tutorUid)) || HARI_ORDER.indexOf(+a.hari) - HARI_ORDER.indexOf(+b.hari) || a.mulai.localeCompare(b.mulai))
    .forEach(x => h += `<tr><td>${esc(nm(x.tutorUid))}</td><td>${HARI[x.hari]}</td><td>${esc(x.mulai)}-${esc(x.selesai)}</td><td>${esc(progName(x.prog))}</td><td>${esc(x.kelas)}${x.bulan ? '' : ' <span class="muted">(semua bulan)</span>'}</td><td><button class="btn sm danger" data-del="${esc(x.id)}">Hapus</button></td></tr>`);
  view(h + '</table></div></div>');
  $('#jB').onchange = e => { if (e.target.value) { PAGES.a_jadwal.bln = e.target.value; go('a_jadwal'); } };
  $('#addJ').onclick = async () => {
    if (!$('#jT').value) return toast('Tambah tutor dulu.');
    await addDoc(collection(db, 'schedules'), { bulan: bln, tutorUid: $('#jT').value, hari: +$('#jH').value, mulai: $('#jM').value, selesai: $('#jS').value, prog: $('#jP').value, kelas: $('#jK').value.trim() });
    toast('Jadwal ditambahkan.'); go('a_jadwal');
  };
  $('#copyPrev').onclick = async () => {
    const src = all.filter(x => x.bulan === prevMonth(bln));
    if (!src.length) return toast('Tidak ada jadwal di bulan sebelumnya.');
    if (!confirm('Salin ' + src.length + ' jadwal dari ' + monthLabel(prevMonth(bln)) + ' ke ' + monthLabel(bln) + '?')) return;
    const b = writeBatch(db);
    src.forEach(x => { const { id, ...d } = x; b.set(doc(collection(db, 'schedules')), Object.assign({}, d, { bulan: bln })); });
    await b.commit(); toast('Jadwal disalin.'); go('a_jadwal');
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

async function importText(text, ts) {
  const { out, bad } = parseAbsensi(text);
  const byName = {}; ts.forEach(t => byName[norm(t.nama)] = t);
  const ok = [], unk = {}; let nonIn = 0;
  out.forEach(r => {
    if (r.ket !== 'IN') { nonIn++; return; }
    const t = byName[norm(r.nama)];
    if (!t) { unk[r.nama] = (unk[r.nama] || 0) + 1; return; }
    ok.push({ id: r.ts + '_' + t.id + '_' + r.prog, data: { tutorUid: t.id, nama: t.nama, prog: r.prog, ts: r.ts } });
  });
  const have = new Set((await getDocs(collection(db, 'attendance'))).docs.map(d => d.id));
  const seen = new Set(), fresh = ok.filter(x => { if (have.has(x.id) || seen.has(x.id)) return false; seen.add(x.id); return true; });
  for (let i = 0; i < fresh.length; i += 400) {
    const b = writeBatch(db); fresh.slice(i, i + 400).forEach(x => b.set(doc(db, 'attendance', x.id), x.data)); await b.commit();
  }
  let r = `<div class="warn"><b>${fresh.length} absensi baru</b> masuk (${ok.length - fresh.length} sudah ada sebelumnya, dari ${out.length} baris terbaca).`;
  if (Object.keys(unk).length) r += '<br><b>Nama tutor tidak cocok, dilewati:</b> ' + Object.keys(unk).map(n => esc(n) + ' (' + unk[n] + ')').join(', ') + '. Tambahkan tutor dengan nama persis sama di Kelola Tutor, lalu sinkron lagi.';
  if (nonIn) r += `<br>${nonIn} baris bukan "IN" tidak dihitung.`;
  if (bad.length) r += '<br>' + bad.length + ' baris tidak dikenali.';
  return { html: r + '</div>', fresh: fresh.length };
}
async function syncSheet(ts) {
  const url = toCsvUrl(cfg.sheetUrl);
  if (!url) return { html: '<div class="warn">Isi link Google Sheet dulu, lalu simpan.</div>', fresh: 0 };
  let text;
  try {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    text = await r.text();
  } catch (e) {
    return { html: '<div class="warn">Gagal mengambil data dari Sheet (' + esc(e.message) + '). Pastikan Sheet sudah di-<i>Publikasikan ke web</i> (File &gt; Bagikan &gt; Publikasikan ke web). Sementara itu Anda bisa impor lewat tempel di bawah.</div>', fresh: 0 };
  }
  if (/^\s*<(!doctype|html)/i.test(text)) return { html: '<div class="warn">Link bukan data CSV. Tempel link "Publikasikan ke web" dari Google Sheet.</div>', fresh: 0 };
  return importText(text, ts);
}

/* ---------- data langsung dari Sheet (untuk tutor) ---------- */
let sheetCache = { t: 0, rows: null };
async function fetchSheetRows() {
  const url = toCsvUrl(cfg.sheetUrl);
  if (!url) return null;
  if (sheetCache.rows && Date.now() - sheetCache.t < 60000) return sheetCache.rows;
  try {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const text = await r.text();
    if (/^\s*<(!doctype|html)/i.test(text)) return null;
    sheetCache = { t: Date.now(), rows: parseAbsensi(text).out };
    return sheetCache.rows;
  } catch (e) { return null; }
}
async function getMyAttendance(base) {
  const list = base ? base.slice() : await getAttendance(me.uid);
  const rows = await fetchSheetRows();
  if (!rows) return { list, live: false };
  const have = new Set(list.map(a => a.id)), mine = norm(me.nama);
  rows.forEach(r => {
    if (r.ket !== 'IN' || norm(r.nama) !== mine) return;
    const id = r.ts + '_' + me.uid + '_' + r.prog;
    if (!have.has(id)) { have.add(id); list.push({ id, tutorUid: me.uid, nama: me.nama, prog: r.prog, ts: r.ts }); }
  });
  list.sort((a, b) => a.ts - b.ts);
  return { list, live: true };
}
const liveNote = l => `<div class="muted" style="margin-bottom:8px">${l ? 'Terhubung langsung ke absensi Google Form (diperbarui setiap halaman dibuka; absen terbaru bisa tampil beberapa menit kemudian).' : 'Menampilkan data yang tersimpan di portal.'}</div>`;

PAGES.a_absen = async () => {
  const ts = await allTutors();
  const att = mapDocs(await getDocs(collection(db, 'attendance')));
  const cnt = {}; att.forEach(a => cnt[a.tutorUid] = (cnt[a.tutorUid] || 0) + 1);
  let h = `<div class="card"><h2>Sinkron dari Google Sheet</h2>
    <div class="muted">Absensi tutor tetap lewat Google Form &rarr; Google Sheet. Tekan <b>Sinkron sekarang</b> agar data terbaru masuk ke portal. Data yang sudah ada tidak akan dobel. Sheet bisa terlambat beberapa menit tampil di link publikasi.</div>
    <label>Link Google Sheet (hasil "Publikasikan ke web")</label><input id="sheetUrl" value="${esc(cfg.sheetUrl || '')}" placeholder="https://docs.google.com/spreadsheets/.../pubhtml">
    <button class="btn sec" id="saveUrl">Simpan link</button> <button class="btn" id="doSync">Sinkron sekarang</button>
    <div id="impRes"></div></div>
    <div class="card"><h2>Impor manual (tempel)</h2>
    <div class="muted">Cadangan jika sinkron gagal: salin baris dari Sheet (Timestamp, Nama tutor, Program, Keterangan) lalu tempel.</div>
    <textarea id="imp" rows="5" placeholder="07/07/2026 12:16:32&#9;Mr. Ardani&#9;KELAS PRIVAT PAGI&#9;IN"></textarea>
    <button class="btn" id="doImp">Impor</button></div>
    <div class="card"><h2>Jumlah absensi tersimpan (${att.length})</h2><div class="tw"><table>` +
    ts.map(t => `<tr><td>${esc(t.nama)}</td><td class="r">${cnt[t.id] || 0}</td></tr>`).join('') + '</table></div></div>';
  view(h);
  $('#saveUrl').onclick = async () => {
    const u = $('#sheetUrl').value.trim();
    if (u && !toCsvUrl(u)) return toast('Link tidak dikenali. Gunakan link "Publikasikan ke web".');
    await setDoc(doc(db, 'settings', 'config'), { sheetUrl: u }, { merge: true }); cfg.sheetUrl = u; toast('Link tersimpan.');
  };
  $('#doSync').onclick = async () => {
    const u = $('#sheetUrl').value.trim();
    if (u !== (cfg.sheetUrl || '')) { if (u && !toCsvUrl(u)) return toast('Link tidak dikenali.'); await setDoc(doc(db, 'settings', 'config'), { sheetUrl: u }, { merge: true }); cfg.sheetUrl = u; }
    $('#impRes').innerHTML = '<div class="warn">Mengambil data dari Sheet...</div>';
    const r = await syncSheet(ts); $('#impRes').innerHTML = r.html;
    if (r.fresh) setTimeout(() => { if (page === 'a_absen') go('a_absen'); }, 2500);
  };
  $('#doImp').onclick = async () => { $('#impRes').innerHTML = (await importText($('#imp').value, ts)).html; };
};

PAGES.a_gaji = async () => {
  const ts = (await allTutors()).filter(t => t.role !== 'admin');
  if (cfg.sheetUrl) { try { await syncSheet(ts); } catch (e) {} }
  const att = mapDocs(await getDocs(collection(db, 'attendance')));
  const last = {}; mapDocs(await getDocs(collection(db, 'payouts'))).forEach(x => { if (x.id.indexOf('last_') === 0) last[x.tutorUid] = x.paidThrough; });
  const now = new Date(), end = new Date(now.getTime() + 1);
  let h = `<div class="card"><h2>Pengaturan tarif</h2><div class="row2">
    <div><label>Tarif Regular / meeting</label><input id="sR" type="number" value="${esc(cfg.tReg)}"></div>
    <div><label>Tarif Privat / sesi</label><input id="sP" type="number" value="${esc(cfg.tPriv)}"></div>
    <div><label>Tarif Diploma</label><input id="sD" type="number" value="${esc(cfg.tDip)}"></div>
    <div><label>Hitung gaji mulai tanggal (jika belum pernah dibayar)</label><input id="sS" type="date" value="${esc(cfg.periodStart)}"></div></div>
    <button class="btn" id="saveCfg">Simpan pengaturan</button></div>
    <div class="card"><h2>Gaji berjalan semua tutor</h2>
    <div class="muted">Dihitung dari absen setelah pembayaran terakhir tiap tutor sampai hari ini. Setelah gaji dikeluarkan, tekan <b>Tandai dibayar</b>; hitungan tutor itu mulai dari nol.</div>
    <label>Dibayar sampai tanggal</label><input type="date" id="payDate" value="${isoD(now)}" style="max-width:200px">
    <div class="tw" style="margin-top:10px"><table class="gt"><tr><th>Tutor</th><th class="r">Absen</th><th class="r">Gaji</th><th></th></tr>`;
  let grand = 0;
  ts.forEach(t => {
    const st = payStart(last[t.id] || null);
    const r = countByProg(att.filter(a => a.tutorUid === t.id), st, end); grand += r.pay;
    h += `<tr><td>${esc(t.nama)}<div class="muted">sejak ${fmtD(st)}${last[t.id] ? '' : ' (belum pernah dibayar)'}</div></td><td class="r">${r.total}</td><td class="r"><b>${rp(r.pay)}</b></td>
      <td><button class="btn sm" data-pay="${esc(t.id)}" data-amt="${r.pay}">Tandai dibayar</button></td></tr>`;
  });
  h += `<tr class="tot"><td>TOTAL</td><td></td><td class="r">${rp(grand)}</td><td></td></tr></table></div></div>`;
  view(h);
  $('#saveCfg').onclick = async () => {
    const n = { tReg: +$('#sR').value, tPriv: +$('#sP').value, tDip: +$('#sD').value, periodStart: $('#sS').value };
    await setDoc(doc(db, 'settings', 'config'), n, { merge: true }); Object.assign(cfg, n); toast('Pengaturan tersimpan.'); go('a_gaji');
  };
  $('#content').onclick = async e => {
    const b = e.target.closest('[data-pay]'); if (!b) return;
    const d = $('#payDate').value, t = ts.find(x => x.id === b.dataset.pay);
    if (!d) return toast('Pilih tanggal "dibayar sampai" dulu.');
    if (!confirm('Tandai ' + t.nama + ' sudah dibayar ' + rp(+b.dataset.amt) + ' (absen sampai ' + fmtD(isoToD(d)) + ')?')) return;
    await setDoc(doc(db, 'payouts', 'last_' + t.id), { tutorUid: t.id, paidThrough: d, paidAt: Date.now() });
    toast('Tersimpan.'); go('a_gaji');
  };
};
