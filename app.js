// SeatPlace 2.0 : le navigateur ne détient jamais de mots de passe ni de clés privées.
// Les réservations et les présences sont protégées par l'authentification Supabase + RLS.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SEATS = [
  { id: 'A', x: 169, y: 157, w: 102, h: 92 },
  { id: 'B', x: 290, y: 157, w: 102, h: 92 },
  { id: 'C', x: 179, y: 442, w: 102, h: 92 },
  { id: 'D', x: 300, y: 442, w: 102, h: 92 },
  { id: 'E', x: 486, y: 145, w: 102, h: 104 },
  { id: 'F', x: 606, y: 145, w: 102, h: 104 },
  { id: 'EF_PLUS', label: 'E/F +', x: 496, y: 297, w: 200, h: 66 },
  // Position corrigée d'après le croquis fourni : H en haut, K en bas.
  { id: 'H', x: 830, y: 235, w: 180, h: 76 },
  { id: 'K', x: 830, y: 324, w: 180, h: 76 },
  // L et G sont deux bureaux allongés, côte à côte, en bas au centre-droit.
  { id: 'L', x: 610, y: 435, w: 88, h: 144 },
  { id: 'G', x: 714, y: 435, w: 88, h: 144 }
];
const queryReminder = new URLSearchParams(location.search).get('rappel');
const hasValidReminder = /^\d{4}-\d{2}-\d{2}$/.test(queryReminder || '');
const CAPACITY = SEATS.length;
const cfg = window.PLANPLACE_CONFIG ?? {};
const cfgOk = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test((cfg.supabaseUrl || '').trim()) &&
  typeof cfg.supabaseKey === 'string' && cfg.supabaseKey.length > 20 && !cfg.supabaseKey.includes('VOTRE_');
let sb = null, me = null, team = [], weekRows = [], monthRows = [], day = todayOrMonday(), view = 'home', busy = false;
if(hasValidReminder) day=parseLocal(queryReminder);
let calendarMonth = new Date(day.getFullYear(), day.getMonth(), 1, 12), monthRequest = 0;
let currentRequest = 0, toastTimer, realtimeChannel = null;
const dayFormatter = new Intl.DateTimeFormat('fr-FR', {weekday:'long',day:'numeric',month:'long'});
const monthFormatter = new Intl.DateTimeFormat('fr-FR', {day:'numeric',month:'long'});
const dayNames = ['Lun','Mar','Mer','Jeu','Ven'];
const fullDayFormatter = new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const fullMonthFormatter = new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'});
function parseLocal(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12);}
function fmtDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function addDays(d,n){const r=new Date(d.getFullYear(),d.getMonth(),d.getDate(),12);r.setDate(r.getDate()+n);return r;}
function monday(d){const x=addDays(d,0);return addDays(x,-(x.getDay()+6)%7);}
function todayOrMonday(){const x=new Date();return x.getDay()===0||x.getDay()===6?monday(x):x;}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g, x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));}
function initials(s){return (s||'PP').split(/[\s.@_-]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();}
function showScreen(name){for(const name2 of ['loading','loginScreen','pendingScreen','appScreen']){$('#'+name2).hidden=name2!==name;}}
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
let planeFlightTimer = null, lastFlightAt = 0;
function launchPlane(){
  const el=$('#flightOverlay');
  if(!el)return;
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const now=Date.now();
  if(now-lastFlightAt<1600)return;
  lastFlightAt=now;
  el.classList.remove('flying');
  void el.offsetWidth;
  el.classList.add('flying');
  clearTimeout(planeFlightTimer);
  planeFlightTimer=setTimeout(()=>el.classList.remove('flying'),2900);
}
// Carillon de confirmation : synthèse locale Web Audio, aucun fichier audio externe.
// Le contexte est déverrouillé pendant le clic pour fonctionner aussi sur mobile.
const BOOKING_SOUND_PREF = 'seatplace.booking.sound.v1';
let bookingSoundEnabled = true;
try { bookingSoundEnabled = localStorage.getItem(BOOKING_SOUND_PREF) !== 'off'; } catch (_) {}
let bookingAudioContext = null;
function updateSoundButton(){
  const button = $('#bookingSoundToggle');
  if (!button) return;
  button.textContent = bookingSoundEnabled ? '🔊 Son activé' : '🔇 Son coupé';
  button.setAttribute('aria-pressed', String(bookingSoundEnabled));
  button.setAttribute('aria-label', bookingSoundEnabled ? 'Couper le son des réservations' : 'Activer le son des réservations');
  button.title = bookingSoundEnabled ? 'Couper le carillon de confirmation' : 'Activer le carillon de confirmation';
}
function prepareBookingSound(){
  if (!bookingSoundEnabled) return;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    if (!bookingAudioContext) bookingAudioContext = new Context();
    if (bookingAudioContext.state === 'suspended') bookingAudioContext.resume().catch(() => {});
    // Un très bref signal silencieux rend le contexte prêt après le geste utilisateur.
    const silent = bookingAudioContext.createOscillator();
    const zero = bookingAudioContext.createGain();
    zero.gain.value = 0;
    silent.connect(zero);
    zero.connect(bookingAudioContext.destination);
    silent.start();
    silent.stop(bookingAudioContext.currentTime + 0.012);
  } catch (error) { console.debug('Son non disponible :', error); }
}
function playBookingChime(){
  if (!bookingSoundEnabled || !bookingAudioContext || bookingAudioContext.state !== 'running') return;
  try {
    const ctx = bookingAudioContext;
    const start = ctx.currentTime + 0.012;
    const notes = [659.25, 783.99, 1046.5]; // mi, sol, do : mini carillon d'embarquement
    for (const [i, frequency] of notes.entries()) {
      const when = start + i * 0.125;
      const osc = ctx.createOscillator();
      const envelope = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, when);
      envelope.gain.setValueAtTime(0.0001, when);
      envelope.gain.exponentialRampToValueAtTime(0.065, when + 0.018);
      envelope.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);
      osc.connect(envelope);
      envelope.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + 0.36);
    }
  } catch (error) { console.debug('Carillon non disponible :', error); }
}
// Notifications Web Push, opt-in individuel, sans clé privée côté navigateur.
const PUSH_KEY = window.SEATPLACE_PUSH_PUBLIC_KEY || '';
let pushBusy = false;
function b64ToBytes(str) {
 const padded = (str + '='.repeat((4 - str.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
 const raw = atob(padded);
 return Uint8Array.from(raw, char => char.charCodeAt(0));
}
function pushSupported() {return !!(window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && PUSH_KEY);}
async function getPushRegistration() {
 // Register the same worker as the existing PWA to avoid conflicting scopes.
 await navigator.serviceWorker.register('./sw.js');
 return navigator.serviceWorker.ready;
}
async function refreshPushUi() {
 const btn=$('#pushToggle'), text=$('#pushHelp');
 if (!btn || !text || !me) return;
 if (!pushSupported()) {
   btn.disabled=true;
   text.textContent = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches
       ? 'Sur iPhone : installez SeatPlace sur l’écran d’accueil puis ouvrez-le depuis son icône.'
       : 'Les notifications ne sont pas disponibles sur ce navigateur ou cette installation.';
   return;
 }
 btn.disabled=pushBusy;
 if (Notification.permission === 'denied') {
   btn.disabled=true;
   text.textContent='Notifications bloquées : autorisez-les dans les réglages du téléphone.';
   return;
 }
 try {
   const reg=await getPushRegistration();
   const sub=await reg.pushManager.getSubscription();
   btn.textContent=sub ? 'Désactiver les rappels' : 'Activer les notifications';
   text.textContent=sub ? 'Rappels activés sur cet appareil. Vous pouvez vous désinscrire à tout moment.' : 'Les rappels sont désactivés sur cet appareil.';
 } catch (err) {console.warn('État notifications',err);text.textContent='Impossible de vérifier les notifications.';}
}
async function togglePush() {
 if(!me || !sb || pushBusy || !pushSupported())return;
 const btn=$('#pushToggle'), text=$('#pushHelp');
 pushBusy=true;btn.disabled=true;text.textContent='Configuration des notifications…';
 // Appeler requestPermission directement depuis l'événement tactile/clic (indispensable sur iOS).
 const permissionPromise = Notification.permission==='default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
 try{
   const regPromise=getPushRegistration();
   const reg=await regPromise;
   let sub=await reg.pushManager.getSubscription();
   if(sub) {
     const {error}=await sb.from('push_subscriptions').delete().eq('endpoint',sub.endpoint).eq('user_id',me.id);
     if(error) throw error;
     await sub.unsubscribe();
     toast('Notifications désactivées sur cet appareil.');
   } else {
     if ((await permissionPromise)!=='granted') {toast('Notifications non autorisées.');return;}
     sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(PUSH_KEY)});
     const keys=sub.toJSON().keys;
     if(!keys?.p256dh || !keys?.auth) throw new Error('Clés du navigateur indisponibles');
     const {error}=await sb.from('push_subscriptions').upsert({endpoint:sub.endpoint,user_id:me.id,p256dh:keys.p256dh,auth:keys.auth},{onConflict:'endpoint'});
     if(error)throw error;
     toast('Rappels mobiles activés ! 🔔');
   }
 }catch(err){console.error('Inscription push',err);toast('Activation impossible. Vérifiez la configuration Supabase.');}
 finally{pushBusy=false;await refreshPushUi();}
}
function showError(msg){const el=$('#appError');el.hidden=!msg;el.textContent=msg||'';}
function statFor(id){return weekRows.find(x=>x.user_id===id && x.work_date===fmtDate(day))||null;}
function seatOwner(id){return weekRows.find(x=>x.work_date===fmtDate(day)&&x.mode==='office'&&x.seat_id===id) || null;}
function personById(id){return team.find(p=>p.id===id);}
function myStat(){return me?statFor(me.id):null;}
function caption(st){return !st?'Non renseigné':st.mode==='office'?`Bureau ${st.seat_id==='EF_PLUS'?'Annexe E/F':st.seat_id}`:st.mode==='remote'?'Télétravail':'Absent(e)';}
function modeText(st){return !st?'Non prévu':st.mode==='office'?'Au bureau':st.mode==='remote'?'En TT':'Absent(e)';}
function metrics(){const rows=team.map(p=>statFor(p.id));return {office:rows.filter(x=>x?.mode==='office').length,remote:rows.filter(x=>x?.mode==='remote').length,absent:rows.filter(x=>x?.mode==='absent').length};}
function monthStartEnd(){const start=monday(calendarMonth);return {start:fmtDate(start),end:fmtDate(addDays(start,41))};}
function monthRowsFor(d){const key=fmtDate(d);return monthRows.filter(r=>r.work_date===key);}
function weekStartEnd(){const start=monday(day);return {start:fmtDate(start),end:fmtDate(addDays(start,4))};}
function initUi(){
 updateSoundButton();
 $('#pushToggle').addEventListener('click',togglePush);
 $('#bookingSoundToggle').addEventListener('click', () => {
   bookingSoundEnabled = !bookingSoundEnabled;
   try { localStorage.setItem(BOOKING_SOUND_PREF, bookingSoundEnabled ? 'on' : 'off'); } catch (_) {}
   updateSoundButton();
 });
 $('#togglePassword').addEventListener('click',()=>{const f=$('#password'),show=f.type==='password';f.type=show?'text':'password';$('#togglePassword').textContent=show?'Masquer':'Afficher';});
 $('#loginForm').addEventListener('submit',signIn);
 $('#logoutDesktop').addEventListener('click',logOut);
 $('#logoutMobile').addEventListener('click',logOut);
 $('#pendingLogout').addEventListener('click',logOut);
 $$('[data-view], [data-go]').forEach(b=>b.addEventListener('click',()=>goto(b.dataset.view||b.dataset.go)));
 $('#prevWeek').addEventListener('click',()=>shiftWeek(-7));
 $('#nextWeek').addEventListener('click',()=>shiftWeek(7));
 $('#today').addEventListener('click',()=>{day=todayOrMonday();loadWeek();});
 $('#heroRemote').addEventListener('click',()=>updateStatus('remote'));
 $('#statusRemote').addEventListener('click',()=>updateStatus('remote'));
 $('#statusAbsent').addEventListener('click',()=>updateStatus('absent'));
 $('#releaseSeat').addEventListener('click',()=>updateStatus(null));
 $('#prevMonth').addEventListener('click',()=>shiftMonth(-1));
 $('#nextMonth').addEventListener('click',()=>shiftMonth(1));
 $('#monthToday').addEventListener('click',async()=>{day=todayOrMonday();calendarMonth=new Date(day.getFullYear(),day.getMonth(),1,12);await Promise.all([loadWeek(false),loadMonth()]);});
 $('#calendarToMap').addEventListener('click',()=>goto('map'));
 $('#calendarRemote').addEventListener('click',()=>updateStatus('remote'));
 $('#calendarAbsent').addEventListener('click',()=>updateStatus('absent'));
 $('#monthGrid').addEventListener('click',async(e)=>{const el=e.target.closest('[data-month-day]');if(!el)return;day=parseLocal(el.dataset.monthDay);if(day.getMonth()!==calendarMonth.getMonth()||day.getFullYear()!==calendarMonth.getFullYear()){calendarMonth=new Date(day.getFullYear(),day.getMonth(),1,12);await Promise.all([loadWeek(false),loadMonth()]);}else{renderCalendar();await loadWeek(false);}});
 $('#seatQuickList').addEventListener('click',e=>{const b=e.target.closest('[data-quick-seat]');if(b&&!b.disabled)selectSeat(b.dataset.quickSeat);});
 $('#teamSearch').addEventListener('input',renderTeam);
 $('#teamFilter').addEventListener('change',renderTeam);
 $('#weekButtons').addEventListener('click',e=>{const b=e.target.closest('[data-day]');if(b){day=parseLocal(b.dataset.day);renderAll();}});
 $('#officePlan').addEventListener('click',e=>{const target=e.target.closest('[data-seat]');if(target)selectSeat(target.dataset.seat);});
 $('#officePlan').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const target=e.target.closest('[data-seat]');if(target){e.preventDefault();selectSeat(target.dataset.seat);}}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden && me){loadWeek(false);if(view==='calendar')loadMonth(false);}});
}
async function boot(){initUi();
 if('serviceWorker' in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
 if(!cfgOk){showScreen('loginScreen');$('#setupNotice').hidden=false;$('#loginForm').hidden=true;return;}
 try{
   const sdk=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
   sb=sdk.createClient(cfg.supabaseUrl.replace(/\/$/,''),cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
   const {data:{user},error}=await sb.auth.getUser();
   if(error || !user){showScreen('loginScreen');return;}
   await enterApp(user);
 } catch(err){showScreen('loginScreen');$('#loginError').textContent='Connexion au service impossible. Vérifiez votre connexion Internet et config.js.';console.error('SeatPlace initialization failed:',err);}
}
async function signIn(e){e.preventDefault();if(!sb)return;const email=$('#email').value.trim(),password=$('#password').value;
 $('#loginError').textContent='';$('#loginButton').disabled=true;$('#loginButton').textContent='Connexion…';
 try{const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;if(!data.user)throw new Error('Aucun utilisateur reçu.');$('#password').value='';await enterApp(data.user);}
 catch(err){$('#loginError').textContent='Identifiant ou mot de passe incorrect, ou connexion indisponible.';console.warn('Login error:',err.message);}
 finally{$('#loginButton').disabled=false;$('#loginButton').innerHTML='Se connecter <span aria-hidden="true">→</span>';}}
async function enterApp(user){
 me=user;showError('');
 const {data,error}=await sb.from('profiles').select('id,display_name').order('display_name',{ascending:true});
 if(error)throw error;
 if(!data?.some(x=>x.id===user.id)){showScreen('pendingScreen');return;}
 team=data;
 $('#userName').textContent=personById(me.id)?.display_name||me.email;
 $('#userInitials').textContent=initials(personById(me.id)?.display_name||me.email);
 showScreen('appScreen');goto(hasValidReminder?'calendar':'home');await loadWeek();
 refreshPushUi().catch(err=>console.warn('Notifications :',err));
 if(realtimeChannel)await sb.removeChannel(realtimeChannel);
 realtimeChannel=sb.channel('planplace-days').on('postgres_changes',{event:'*',schema:'public',table:'work_days'},(payload)=>{if((payload.eventType==='INSERT'||payload.eventType==='UPDATE')&&payload.new?.mode==='office')launchPlane();loadWeek(false);if(view==='calendar')loadMonth(false);}).subscribe();
}
async function logOut(){if(sb){if(realtimeChannel){await sb.removeChannel(realtimeChannel);realtimeChannel=null;}await sb.auth.signOut();}me=null;team=[];weekRows=[];monthRows=[];showScreen('loginScreen');toast('Vous êtes déconnecté.');}
function goto(name){view=name;for(const el of $$('.view'))el.classList.toggle('active',el.id===name+'View');$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));$('#weekHeading').hidden=name==='calendar';$('#weekButtons').hidden=name==='calendar';const title={home:['MON ESPACE DE TRAVAIL','Bonjour 👋','Organisons votre semaine au bureau.'],map:['RÉSERVATION DES BUREAUX','Choisir un siège','Retrouvez la disposition réelle des places de votre équipe.'],calendar:['VUE MOIS','Calendrier des présences','Visualisez tout le mois et choisissez une date pour réserver.'],team:['PRÉSENCES','Mon équipe','Qui vient au bureau et qui est en télétravail ?']}[name];if(title){$('#pageEyebrow').textContent=title[0];$('#pageTitle').textContent=title[1];$('#pageSubtitle').textContent=title[2];}renderAll();if(name==='calendar')loadMonth(false);}
async function shiftWeek(n){day=addDays(day,n);await loadWeek();}
async function shiftMonth(n){calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+n,1,12);await loadMonth();}
async function loadMonth(){if(!me)return;const callId=++monthRequest,{start,end}=monthStartEnd();const {data,error}=await sb.from('work_days').select('user_id,work_date,mode,seat_id').gte('work_date',start).lte('work_date',end);
 if(callId!==monthRequest)return;
 if(error){showError('Impossible de charger le calendrier mensuel. Vérifiez votre connexion.');console.error(error);return;}
 monthRows=data||[];showError('');renderCalendar();}
async function loadWeek(notify=true){if(!me)return;const callId=++currentRequest;const {start,end}=weekStartEnd();const {data,error}=await sb.from('work_days').select('user_id,work_date,mode,seat_id').gte('work_date',start).lte('work_date',end);
 if(callId!==currentRequest)return;
 if(error){showError('Impossible de récupérer le planning. Vérifiez que le script SQL est exécuté et que votre compte est autorisé.');console.error(error);return;}
 weekRows=data||[];showError('');renderAll(); }
function renderAll(){if(!me||!team.length)return;renderWeek();renderHome();renderMap();renderTeam();renderCalendar();}
function renderWeek(){const start=monday(day);const end=addDays(start,4);$('#weekLabel').textContent=`Semaine du ${monthFormatter.format(start)} au ${monthFormatter.format(end)}`;$('#weekButtons').innerHTML=dayNames.map((label,i)=>{const d=addDays(start,i);const selected=fmtDate(d)===fmtDate(day),count=weekRows.filter(r=>r.work_date===fmtDate(d)&&r.mode==='office').length;return `<button class="day ${selected?'active':''}" data-day="${fmtDate(d)}" aria-pressed="${selected}"><small>${label}</small><strong>${d.getDate()}</strong><i title="${count} présences"></i></button>`;}).join('');}
function renderCalendar(){
 if(!me||!team.length)return;
 $('#monthHeading').textContent=fullMonthFormatter.format(calendarMonth).replace(/^./,c=>c.toUpperCase());
 const start=monday(calendarMonth),last=addDays(start,41),todayKey=fmtDate(new Date());
 const lookup=new Map();for(const r of monthRows){if(!lookup.has(r.work_date))lookup.set(r.work_date,[]);lookup.get(r.work_date).push(r);}
 const days=[];
 for(let i=0;i<42;i++){
   const d=addDays(start,i),key=fmtDate(d),rows=lookup.get(key)||[];
   const office=rows.filter(r=>r.mode==='office').length,remote=rows.filter(r=>r.mode==='remote').length;
   const mine=rows.find(r=>r.user_id===me.id);const outside=d.getMonth()!==calendarMonth.getMonth();
   const tag=mine?.mode==='office'?('Bureau '+(mine.seat_id==='EF_PLUS'?'E/F +':mine.seat_id)):mine?.mode==='remote'?'Mon TT':mine?.mode==='absent'?'Mon absence':'';
   const label=`${fullDayFormatter.format(d)} : ${office} au bureau, ${remote} en télétravail${tag?', '+tag:''}`;
   days.push(`<button type="button" class="month-day ${outside?'other-month':''} ${(i%7>=5)?'weekend':''} ${key===fmtDate(day)?'selected':''} ${key===todayKey?'is-today':''}" data-month-day="${key}" aria-pressed="${key===fmtDate(day)}" aria-label="${escapeHtml(label)}"><span class="month-date">${d.getDate()}</span><span class="month-numbers"><span class="month-count office">${office}<span class="month-count-label"> bureau</span></span><span class="month-count remote">${remote}<span class="month-count-label"> TT</span></span></span>${tag?`<span class="month-my-tag">${escapeHtml(tag)}</span>`:'<span class="month-empty-tag">&nbsp;</span>'}</button>`);
 }
 $('#monthGrid').innerHTML=days.join('');
 const selected=lookup.get(fmtDate(day))||[],office=selected.filter(r=>r.mode==='office'),remote=selected.filter(r=>r.mode==='remote'),absent=selected.filter(r=>r.mode==='absent');
 $('#monthSelectedDate').textContent=fullDayFormatter.format(day).replace(/^./,c=>c.toUpperCase());
 $('#monthDayStats').innerHTML=`<div><strong>${office.length}<small>/${CAPACITY}</small></strong><span>Au bureau</span></div><div><strong>${remote.length}</strong><span>En TT</span></div><div><strong>${CAPACITY-office.length}</strong><span>Places libres</span></div>`;
 const mine=selected.find(r=>r.user_id===me.id);$('#monthMyStatus').textContent=caption(mine);
 $('#monthOfficeCount').textContent=`${office.length}`;
 $('#monthPeople').innerHTML=office.length?office.map(r=>{const p=personById(r.user_id);return `<div><span class="mini-avatar">${escapeHtml(initials(p?.display_name||'?'))}</span><span>${escapeHtml(p?.display_name||'Collaborateur')}</span><b>${escapeHtml(r.seat_id==='EF_PLUS'?'E/F +':r.seat_id)}</b></div>`;}).join(''):'<p class="empty">Aucune réservation ce jour-là.</p>';
}
function renderHome(){const c=metrics();$('#metrics').innerHTML=`<div class="metric"><div><small>Au bureau</small><strong>${c.office}</strong></div><i>♧</i></div><div class="metric"><div><small>Places libres</small><strong>${CAPACITY-c.office}</strong></div><i>⌑</i></div><div class="metric"><div><small>En télétravail</small><strong>${c.remote}</strong></div><i>⌂</i></div>`;
 $('#todayDateText').textContent=monthFormatter.format(day);const st=myStat();$('#myStatusBox').innerHTML=`<span class="status-icon">${st?.mode==='office'?'⌑':st?.mode==='remote'?'⌂':st?.mode==='absent'?'☷':'○'}</span><span><strong>${escapeHtml(caption(st))}</strong><small>${st?.mode==='office'?'Votre réservation est confirmée':st?.mode==='remote'?'Vous travaillez à distance':st?.mode==='absent'?'Journée d’absence enregistrée':'Indiquez votre présence ou réservez une place'}</small></span>`;
 const listing=team.filter(p=>statFor(p.id)?.mode==='office').slice(0,4);$('#teamPreview').innerHTML=listing.length?listing.map(p=>personHtml(p)).join(''):`<div class="empty">Personne n'a encore réservé de place.</div>`;}
function personHtml(p){const st=statFor(p.id);return `<div class="team-item"><span class="avatar">${escapeHtml(initials(p.display_name))}</span><span class="person-info"><span class="person-name">${escapeHtml(p.display_name)}${p.id===me.id?' · Vous':''}</span><span class="person-detail">${escapeHtml(caption(st))}</span></span><span class="tag ${st?.mode||''}">${escapeHtml(modeText(st))}</span></div>`;}
function renderTeam(){if(!me)return;$('#teamDate').textContent=dayFormatter.format(day);$('#teamCount').textContent=`${team.length} personnes`;const q=$('#teamSearch').value.toLocaleLowerCase('fr').trim(),flt=$('#teamFilter').value;const filtered=team.filter(p=>p.display_name.toLocaleLowerCase('fr').includes(q) && (flt==='all'||(statFor(p.id)?.mode||'none')===flt));$('#teamList').innerHTML=filtered.length?filtered.map(personHtml).join(''):`<div class="empty">Aucun collaborateur correspondant.</div>`;}
function renderMap(){if(!me)return;const c=metrics(),mine=myStat();$('#mapSeatsCounter').textContent=`${CAPACITY-c.office} places libres / ${CAPACITY}`;$('#bookingDate').textContent=dayFormatter.format(day);$('#bookingTitle').textContent=mine?.mode==='office'?`Votre bureau : ${mine.seat_id==='EF_PLUS'?'Annexe E/F':mine.seat_id}`:'Choisissez une place';$('#bookingDescription').textContent=mine?.mode==='office'?'Votre place est confirmée pour cette journée. Pour la changer, sélectionnez un bureau libre sur le plan.':'Sélectionnez une place disponible pour enregistrer votre présence au bureau.';$('#releaseSeat').hidden=mine?.mode!=='office';
 $('#seatQuickList').innerHTML=SEATS.map(seat=>{const owner=seatOwner(seat.id),self=owner?.user_id===me.id;return `<button type="button" data-quick-seat="${seat.id}" class="quick-seat ${owner?(self?'mine':'taken'):'free'}" ${owner&&!self?'disabled':''} title="${escapeHtml(owner?'Occupé par '+(personById(owner.user_id)?.display_name||'un collègue'):'Disponible')}"><b>${escapeHtml(seat.label||seat.id)}</b><span>${owner?(self?'Ma place':'Occupé'):'Libre'}</span></button>`;}).join('');
 const ns='http://www.w3.org/2000/svg',root=$('#planSeats');root.replaceChildren();
 for(const seat of SEATS){const owner=seatOwner(seat.id),self=owner?.user_id===me.id,name=owner?personById(owner.user_id)?.display_name||'Occupé':'Disponible';
 const g=document.createElementNS(ns,'g');g.classList.add('spot');if(owner)g.classList.add(self?'mine':'occupied');g.setAttribute('data-seat',seat.id);g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label',`${seat.id==='EF_PLUS'?'Annexe E/F':'Bureau '+seat.id} : ${name}`);
 const rect=document.createElementNS(ns,'rect');for(const [k,v] of Object.entries({x:seat.x,y:seat.y,width:seat.w,height:seat.h,rx:10}))rect.setAttribute(k,v);rect.classList.add('spot-border');g.appendChild(rect);
 const label=document.createElementNS(ns,'text');label.setAttribute('x',seat.x+seat.w/2);label.setAttribute('y',seat.y+(seat.h>75?seat.h*.46:seat.h*.47));label.setAttribute('text-anchor','middle');label.setAttribute('font-family','system-ui,sans-serif');label.setAttribute('font-size',seat.id==='EF_PLUS'?'21':'30');label.setAttribute('font-weight','800');label.classList.add('spot-mainlabel');label.textContent=seat.label||seat.id;g.appendChild(label);
 const txt=document.createElementNS(ns,'text');txt.setAttribute('x',seat.x+seat.w/2);txt.setAttribute('y',seat.y+seat.h-13);txt.setAttribute('text-anchor','middle');txt.setAttribute('font-family','system-ui,sans-serif');txt.setAttribute('font-size','10');txt.classList.add('spot-sublabel');txt.textContent=owner?(self?'Ma place':(name.length>14?name.slice(0,12)+'…':name)):'Libre';g.appendChild(txt);
 const title=document.createElementNS(ns,'title');title.textContent=seat.id==='EF_PLUS'?'Poste annexe accolé à E/F':`Poste ${seat.id}`;g.appendChild(title);root.appendChild(g);
 }}
async function selectSeat(id){if(!me||busy)return;const owner=seatOwner(id),label=id==='EF_PLUS'?'Annexe E/F':id;if(owner && owner.user_id!==me.id){toast(`Ce bureau est déjà réservé par ${personById(owner.user_id)?.display_name||'un collègue'}.`);return;}
 if(owner?.user_id===me.id){toast('Vous avez déjà réservé ce bureau.');return;}
 await updateStatus('office',id);}
async function updateStatus(mode,seatId=null){if(!me||busy)return; if(mode==='office')prepareBookingSound();busy=true;try{
 let result;
 if(!mode){result=await sb.from('work_days').delete().eq('user_id',me.id).eq('work_date',fmtDate(day));}
 else {result=await sb.from('work_days').upsert({user_id:me.id,work_date:fmtDate(day),mode,seat_id:mode==='office'?seatId:null},{onConflict:'user_id,work_date'});}
 if(result.error)throw result.error;if(mode==='office'){launchPlane();playBookingChime();}await loadWeek(false);if(view==='calendar')await loadMonth();toast(mode==='office'?'Siège réservé ! Bon vol ✈':mode==='remote'?'Télétravail enregistré.':mode==='absent'?'Absence enregistrée.':'Réservation libérée.');
 }catch(err){console.error(err);if(err.code==='23505'){toast('Ce bureau vient d’être réservé. Choisissez une autre place.');await loadWeek(false);if(view==='calendar')await loadMonth();}else toast('Enregistrement impossible. Vérifiez votre connexion et vos droits.');}finally{busy=false;}}
boot();
