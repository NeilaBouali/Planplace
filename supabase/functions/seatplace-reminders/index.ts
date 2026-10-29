// Supabase Edge Function : seatplace-reminders
// Déployez avec `supabase functions deploy seatplace-reminders --no-verify-jwt`.
// L'endpoint n'accepte que la requête cron portant le secret serveur x-cron-secret.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

const env = (name: string) => Deno.env.get(name) || '';
function adminClient() {
  const fallback = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default;
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || fallback;
  if (!key || !env('SUPABASE_URL')) throw new Error('Clé Supabase serveur absente');
  return createClient(env('SUPABASE_URL'), key, {auth:{autoRefreshToken:false,persistSession:false}});
}
function equalSecret(a: string, b: string): boolean {
  if(!a || !b || a.length !== b.length)return false;
  let difference=0;
  for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
function parisNow() {
  const parts = new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date());
  return Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
}
function nextLocalDate(iso: string) {
  const d=new Date(iso+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()+1);
  return {date:d.toISOString().slice(0,10), weekday:d.getUTCDay()};
}
function json(data: unknown, status = 200) {return Response.json(data,{status});}
Deno.serve(async (req) => {
  if(req.method !== 'POST')return json({error:'POST attendu'},405);
  if(!equalSecret(req.headers.get('x-cron-secret') || '',env('SEATPLACE_CRON_SECRET')))return json({error:'Interdit'},403);
  const clock=parisNow();
  const today=`${clock.year}-${clock.month}-${clock.day}`;
  const tomorrow=nextLocalDate(today);
  // Cron passe à 07:00 ou 08:00 UTC : seul 09h00 en heure de Paris envoie.
  if(clock.hour!=='09'||clock.minute!=='00'||tomorrow.weekday<1||tomorrow.weekday>5){
    return json({skipped:true, reason:'Hors créneau', parisTime:`${today} ${clock.hour}:${clock.minute}`,tomorrow:tomorrow.date});
  }
  const admin=adminClient();
  const profileRes=await admin.from('profiles').select('id').eq('approved',true);
  if(profileRes.error)throw profileRes.error;
  const users=(profileRes.data||[]).map(x=>x.id);
  if(users.length===0)return json({sent:0,date:tomorrow.date});
  const answeredRes=await admin.from('work_days').select('user_id').eq('work_date',tomorrow.date);
  if(answeredRes.error)throw answeredRes.error;
  const answered=new Set((answeredRes.data||[]).map(x=>x.user_id));
  const missing=users.filter(id=>!answered.has(id));
  if(missing.length===0)return json({sent:0,alreadyAnswered:users.length,date:tomorrow.date});
  const subsRes=await admin.from('push_subscriptions').select('endpoint,user_id,p256dh,auth').in('user_id',missing);
  if(subsRes.error)throw subsRes.error;
  const vapidKeys=await webpush.importVapidKeys(JSON.parse(env('SEATPLACE_VAPID_KEYS')));
  const appServer=await webpush.ApplicationServer.new({contactInformation:env('SEATPLACE_VAPID_CONTACT'),vapidKeys});
  let sent=0,failed=0,duplicate=0;
  for(const sub of subsRes.data||[]) {
    // Revérifier immédiatement avant chaque envoi si l'utilisateur a répondu entre-temps.
    const fresh=await admin.from('work_days').select('user_id').eq('work_date',tomorrow.date).eq('user_id',sub.user_id).maybeSingle();
    if(fresh.error){failed++;continue;}
    if(fresh.data)continue;
    const claim=await admin.from('push_reminder_log').upsert({endpoint:sub.endpoint,work_date:tomorrow.date},{onConflict:'endpoint,work_date',ignoreDuplicates:true}).select('endpoint');
    if(claim.error){failed++;continue;}
    if(!claim.data?.length){duplicate++;continue;}
    try {
      await appServer.subscribe({endpoint:sub.endpoint,keys:{auth:sub.auth,p256dh:sub.p256dh}})
        .pushTextMessage(JSON.stringify({date:tomorrow.date}),{ttl:12*60*60});
      sent++;
    }catch(err){
      failed++;
      console.error('Web Push failure:',String(err));
      await admin.from('push_reminder_log').delete().eq('endpoint',sub.endpoint).eq('work_date',tomorrow.date);
      const code=(err as {response?:{status?:number}})?.response?.status;
      if(code===404||code===410)await admin.from('push_subscriptions').delete().eq('endpoint',sub.endpoint);
    }
  }
  return json({date:tomorrow.date,peopleToRemind:missing.length,sent,failed,duplicate});
});
