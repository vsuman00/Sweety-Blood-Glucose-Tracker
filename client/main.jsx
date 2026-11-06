import React, {useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';
const slots = {morning_fasting:'Morning (fasting)',after_breakfast:'After breakfast',after_lunch:'After lunch',after_dinner:'After dinner'};
const localToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function api(path,options={}) {
 const response=await fetch(`/api${path}`,{...options,headers:{'Content-Type':'application/json',...options.headers},credentials:'same-origin'});
 const data=response.status===204 ? null : await response.json();
 if(!response.ok) throw Object.assign(new Error(data.error?.message || 'Request failed. Please try again.'),{...data.error,status:response.status});
 return data;
}
const send=(method,body)=>({method,body:JSON.stringify(body)});
function App(){
 const [user,setUser]=useState(null),[ready,setReady]=useState(false),[register,setRegister]=useState(false);
 const [auth,setAuth]=useState({name:'',email:'',password:''}),[authError,setAuthError]=useState(null),[busy,setBusy]=useState(false);
 const [maxDate,setMaxDate]=useState(localToday()),[date,setDate]=useState(localToday());
 const [reports,setReports]=useState(null),[loadError,setLoadError]=useState(null),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
 const [form,setForm]=useState({date:localToday(),slot:'morning_fasting',value:''}),[editing,setEditing]=useState(null),[formError,setFormError]=useState(null),[notice,setNotice]=useState('');
 const [deleting,setDeleting]=useState(null);
 useEffect(()=>{api('/auth/me').then(data=>{setUser(data.user);setMaxDate(data.today);setDate(data.today);setForm(f=>({...f,date:data.today}));}).catch(error=>{if(error.status!==401)setAuthError(error);}).finally(()=>setReady(true));},[]);
 useEffect(()=>{
  if(!user)return;
  let active=true;setLoading(true);setReports(null);setLoadError(null);
  api(`/reports?date=${date}`).then(data=>{if(active)setReports(data);}).catch(error=>{if(active){setLoadError(error);if(error.status===401)setUser(null);}}).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[user,date,refresh]);
 useEffect(()=>{const timer=setInterval(()=>{setMaxDate(localToday());},30000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(!editing)setForm(f=>({...f,date}));},[date,editing]);
 const resetForm=()=>{setEditing(null);setForm({date,slot:'morning_fasting',value:''});setFormError(null);};
 async function authenticate(event){
  event.preventDefault();setBusy(true);setAuthError(null);
  try{
   if(register) await api('/auth/register',send('POST',auth));
   const data=await api('/auth/login',send('POST',auth));setUser(data.user);setAuth({...auth,password:''});
   const me=await api('/auth/me');setMaxDate(me.today);setDate(me.today);setForm({date:me.today,slot:'morning_fasting',value:''});
  }catch(error){setAuthError(error);}finally{setBusy(false);}
 }
 async function save(event){
  event.preventDefault();setBusy(true);setFormError(null);setNotice('');
  try{
   const payload={...form,value:form.value.trim()===''?null:Number(form.value),...(editing&&{version:editing.version})};
   await api(editing?`/readings/${editing.id}`:'/readings',send(editing?'PUT':'POST',payload));
   setNotice(editing?'Reading updated.':'Reading added.');setDate(form.date);setEditing(null);setForm({...form,value:''});setRefresh(n=>n+1);
  }catch(error){setFormError(error);if(error.status===401)setUser(null);}finally{setBusy(false);}
 }
 async function remove(reading){
  setBusy(true);setNotice('');setFormError(null);
  try{await api(`/readings/${reading.id}`,send('DELETE',{version:reading.version}));setDeleting(null);if(editing?.id===reading.id)resetForm();setNotice('Reading deleted.');setRefresh(n=>n+1);}
  catch(error){setFormError(error);setDeleting(null);if(error.status===401)setUser(null);}finally{setBusy(false);}
 }
 function edit(reading){setEditing(reading);setForm({...reading,value:String(reading.value)});setFormError(null);setNotice('');document.getElementById('reading-value')?.focus();}
 if(!ready)return <main className="shell"><p role="status">Opening your journal...</p></main>;
 return <>
  <header className="topbar"><a className="brand" href="/" aria-label="Sweety home"><span className="brand-icon" aria-hidden="true">s</span>sweety<span className="brand-dot">.</span></a><span className="top-caption">YOUR DAILY GLUCOSE JOURNAL</span>{user&&<button className="quiet" onClick={async()=>{try{await api('/auth/logout',send('POST',{}));setUser(null);setReports(null);resetForm();setNotice('');}catch(error){setLoadError(error);}}}>Log out</button>}</header>
  {!user ? <main className="auth-layout"><section className="auth-intro"><p className="eyebrow">A LITTLE CHECK-IN, EVERY DAY</p><h1>Small readings.<br/>A clearer picture.</h1><p>Keep your glucose readings together, one day at a time.</p><div className="intro-note"><span aria-hidden="true">✳</span> Four moments. One simple journal.</div></section><section className="panel auth-panel"><p className="eyebrow">WELCOME TO SWEETY</p><h2>{register?'Start your journal':'Welcome back'}</h2><p className="muted">{register?'Create an account to keep your readings private.':'Log in to pick up where you left off.'}</p><ErrorBox error={authError}/><form onSubmit={authenticate}>
   {register&&<label>Name<input required maxLength={100} autoComplete="name" value={auth.name} onChange={e=>setAuth({...auth,name:e.target.value})}/></label>}
   <label>Email<input type="email" required autoComplete="email" value={auth.email} onChange={e=>setAuth({...auth,email:e.target.value})}/></label>
   <label>Password<input type="password" required minLength={8} autoComplete={register?'new-password':'current-password'} value={auth.password} onChange={e=>setAuth({...auth,password:e.target.value})}/></label>
   {register&&<p className="hint">At least 8 characters; no more than 72 UTF-8 bytes.</p>}
   <button className="primary full" disabled={busy}>{busy?'Please wait...':register?'Create account':'Log in'}</button>
  </form><button className="text-button" onClick={()=>{setRegister(!register);setAuthError(null);}}>{register?'Already have an account? Log in':'New here? Create an account'}</button></section></main> :
  <main className="shell"><div className="page-heading"><div><p className="eyebrow">YOUR HEALTH, ONE DAY AT A TIME</p><h1>Hello, {user.name}.</h1><p className="muted">A simple place for your daily readings.</p></div><label className="date-picker">Selected date<input aria-label="Selected date" type="date" min="1900-01-01" max={maxDate} value={date} onChange={e=>{if(e.target.value){setDate(e.target.value);setNotice('');}}}/><span className="hint">All dates use Asia/Kolkata (IST)</span></label></div>
   {notice&&<p className="notice" role="status">{notice}</p>}
   {loadError&&<><ErrorBox error={loadError}/><button onClick={()=>setRefresh(n=>n+1)}>Retry loading</button></>}
   <div className="dashboard"><section className="panel entry-panel"><p className="eyebrow">{editing?'MAKE A CORRECTION':'A MOMENT TO CHECK IN'}</p><h2>{editing?'Edit reading':'Add a reading'}</h2><p className="muted small">One reading per meal slot, up to four a day.</p><ErrorBox error={formError}/>
    {formError?.code==='STALE_VERSION'&&<button onClick={()=>{setRefresh(n=>n+1);resetForm();}}>Reload latest data</button>}
    <form onSubmit={save}><label>Date<input required type="date" min="1900-01-01" max={maxDate} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label>Meal slot<select value={form.slot} onChange={e=>setForm({...form,slot:e.target.value})}>{Object.entries(slots).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label><label htmlFor="reading-value">Glucose <span className="muted">(mg/dl)</span></label><input id="reading-value" required type="number" min="40" max="600" step="1" inputMode="numeric" placeholder="e.g. 105" value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/><p className="hint">Whole numbers between 40 and 600.</p><button className="primary full" disabled={busy}>{busy?'Saving...':editing?'Save changes':'Add reading'}</button>{editing&&<button type="button" className="text-button" disabled={busy} onClick={resetForm}>Cancel edit</button>}</form><div className="privacy-note">Your readings are private to your account.</div></section>
   <div className="report-area" aria-busy={loading}>{loading&&<p role="status">Loading your readings...</p>}{reports&&<>
    <section className="panel daily-panel"><div className="section-heading"><div><p className="eyebrow">THE DAILY PICTURE</p><h2>Daily report</h2></div><span className="pill">{reports.daily.count} of 4 readings</span></div><Stats report={reports.daily}/>
    {!reports.daily.count?<div className="empty"><span aria-hidden="true">○</span><h3>A fresh page for this day</h3><p>Add your first reading to see your daily picture.</p></div>:<ul className="reading-list">{reports.daily.readings.map(reading=><li key={reading.id}><div><span className="slot-name">{slots[reading.slot]}</span><span className="reading-number">{reading.value} <small>mg/dl</small></span></div><div className="row-actions"><button disabled={busy} onClick={()=>edit(reading)} aria-label={`Edit ${slots[reading.slot]}`}>Edit</button><button disabled={busy} className="danger" onClick={()=>setDeleting(reading)} aria-label={`Delete ${slots[reading.slot]}`}>Delete</button></div></li>)}</ul>}
    </section><div className="summary-grid">{[['monthToDate','Month to date'],['previousMonth','Previous month']].map(([key,title])=><section className="panel summary" key={key}><p className="eyebrow">{title.toUpperCase()}</p><h2>{reports[key].start} <span className="muted">to</span> {key==='monthToDate'?date:previousDay(reports[key].end)}</h2><Stats report={reports[key]}/>{!reports[key].count&&<p className="hint">No readings in this period yet.</p>}</section>)}</div>
   </>}</div></div><footer>Made for everyday tracking. All glucose values are in mg/dl.</footer>
   {deleting&&<DeleteDialog close={()=>setDeleting(null)} busy={busy}><h2 id="delete-title">Delete this reading?</h2><p>{slots[deleting.slot]} on {deleting.date}: {deleting.value} mg/dl.</p><p className="muted">This cannot be undone.</p><div className="row-actions"><button autoFocus disabled={busy} onClick={()=>setDeleting(null)}>Keep reading</button><button disabled={busy} className="primary" onClick={()=>remove(deleting)}>Delete reading</button></div></DeleteDialog>}
  </main>}
 </>;
}
function DeleteDialog({children,close,busy}){
 const ref=useRef(null);
 useEffect(()=>{
  const previous=document.activeElement;
  const element=ref.current;
  element.querySelector('button')?.focus();
  function keydown(event){
   if(event.key==='Escape'&&!busy){event.preventDefault();close();}
   if(event.key==='Tab'){
    const buttons=[...element.querySelectorAll('button:not(:disabled)')];
    if(!buttons.length){event.preventDefault();return;}
    if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons.at(-1).focus();}
    else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0].focus();}
   }
  }
  element.addEventListener('keydown',keydown);
  return()=>{element.removeEventListener('keydown',keydown);previous?.focus();};
 },[busy]);
 return <div className="modal-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-labelledby="delete-title" className="panel dialog">{children}</section></div>;
}
function previousDay(date){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
function ErrorBox({error}){return error?<div className="error" role="alert"><p>{error.message}</p>{error.fields&&<ul>{Object.entries(error.fields).map(([field,message])=><li key={field}>{message}</li>)}</ul>}</div>:null;}
function Stats({report}){return <dl className="stats">{[['Highest',report.highest],['Lowest',report.lowest],['Average',report.average===null?null:report.average.toFixed(1)],['Count',report.count]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'—'}</dd></div>)}</dl>;}
createRoot(document.getElementById('root')).render(<App/>);
