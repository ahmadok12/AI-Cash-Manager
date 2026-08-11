"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient, Session, SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowDownLeft, ArrowLeft, ArrowUpRight, BarChart3, CalendarDays, Check,
  ChevronRight, CircleCheck, ClipboardCheck, Eye, EyeOff, FileSpreadsheet,
  History, Home, Info, Landmark, MessageCircleMore, Mic, PenLine, Search,
  Send, Settings2, Sparkles, X,
} from "lucide-react";

type Direction = "IN" | "OUT";
type Source = "Voice" | "Chat" | "Manual" | "Opening";
type Transaction = { id:number; amount:number; description:string; direction:Direction; action:string; date:string; time:string; source:Source; status:"Synced"|"Pending"|"Local" };
type Closing = { date:string; expected:number; counted:number; difference:number; note:string; closedAt:string };
type Tab = "home" | "history" | "insights" | "settings";
type EntryMode = "voice" | "chat" | "manual" | null;

declare global {
  interface Window { APP_CONFIG?: { supabaseUrl?: string; supabasePublishableKey?: string } }
}

const todayKey = () => new Date().toISOString().slice(0,10);
const money = (value:number) => `Rs. ${Math.abs(value).toLocaleString("en-PK")}`;
const signedMoney = (value:number) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${money(value)}`;

function parseNatural(text:string) {
  const clean=text.trim(); const lower=clean.toLowerCase();
  const numeric=lower.match(/(?:rs\.?\s*)?([\d,.]+)\s*(k|hazar|thousand|lakh)?/i);
  let amount=numeric?Number(numeric[1].replace(/,/g,"")):0;
  if (["k","hazar","thousand"].includes(numeric?.[2]||"")) amount*=1000;
  if (numeric?.[2]==="lakh") amount*=100000;
  const received=/\b(se liye|wasool|receive|received|mili|mile|aaya|aya|nikalwaye|withdraw)/i.test(lower);
  const paid=/\b(ko diye|diye|ada kiye|payment ki|pay kiya|paid|spent|khareeda|dalwaya|jama krwaye|jama karwaye|deposit)/i.test(lower);
  const direction:Direction=received?"IN":"OUT";
  let action=received?"Received":"Spent";
  if (/nikalwaye|withdraw/i.test(lower)) action="Withdrawn";
  if (/jama|deposit/i.test(lower)) action="Deposited";
  const description=clean.replace(/(?:rs\.?\s*)?[\d,.]+\s*(?:k|hazar|thousand|lakh)?/i,"").replace(/\b(?:rs\.?|pkr|rmb|cny)\b/gi,"").replace(/^\s*(?:maine|main ne|i)\b\s*/i,"").replace(/\s{2,}/g," ").trim()||"Cash transaction";
  return { amount, description, direction, action, ambiguous:!amount||(!received&&!paid) };
}

export default function CashApp(){
  const [tab,setTab]=useState<Tab>("home");
  const [transactions,setTransactions]=useState<Transaction[]>([]);
  const [closings,setClosings]=useState<Closing[]>([]);
  const [entryMode,setEntryMode]=useState<EntryMode>(null);
  const [input,setInput]=useState("");
  const [manual,setManual]=useState({amount:"",description:"",direction:"OUT" as Direction});
  const [candidate,setCandidate]=useState<ReturnType<typeof parseNatural>|null>(null);
  const [closingOpen,setClosingOpen]=useState(false);
  const [openingOpen,setOpeningOpen]=useState(false);
  const [openingAmount,setOpeningAmount]=useState("");
  const [countedCash,setCountedCash]=useState("");
  const [closingNote,setClosingNote]=useState("");
  const [query,setQuery]=useState("");
  const [hidden,setHidden]=useState(false);
  const [listening,setListening]=useState(false);
  const [parsing,setParsing]=useState(false);
  const [toast,setToast]=useState("");
  const [hydrated,setHydrated]=useState(false);
  const [supabase,setSupabase]=useState<SupabaseClient|null>(null);
  const [session,setSession]=useState<Session|null>(null);
  const [googleToken,setGoogleToken]=useState("");
  const [spreadsheetId,setSpreadsheetId]=useState("");
  const [googleEmail,setGoogleEmail]=useState("");
  const [geminiReady,setGeminiReady]=useState(false);
  const chatRef=useRef<HTMLInputElement>(null);
  const manualRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    const saved=localStorage.getItem("ai-cash-v1"); if(saved) setTransactions(JSON.parse(saved));
    const savedClosings=localStorage.getItem("hisaab-closings"); if(savedClosings) setClosings(JSON.parse(savedClosings));
    setSpreadsheetId(localStorage.getItem("hisaab-sheet-id")||""); setHydrated(true);
    const config=window.APP_CONFIG||{};
    if(config.supabaseUrl&&config.supabasePublishableKey&&!config.supabaseUrl.includes("YOUR_")){
      const client=createClient(config.supabaseUrl,config.supabasePublishableKey);setSupabase(client);setGeminiReady(true);
      client.auth.getSession().then(({data})=>{setSession(data.session);if(data.session?.provider_token){setGoogleToken(data.session.provider_token);setGoogleEmail(data.session.user.email||"Google account")}});
      const {data:listener}=client.auth.onAuthStateChange((_event,next)=>{setSession(next);setGoogleToken(next?.provider_token||"");setGoogleEmail(next?.user.email||"")});
      const quick=new URLSearchParams(location.search).get("quick");if(quick==="voice"||quick==="chat"||quick==="manual")setTimeout(()=>openEntry(quick),250);
      return()=>listener.subscription.unsubscribe();
    }
    const quick=new URLSearchParams(location.search).get("quick");
    if(quick==="voice"||quick==="chat"||quick==="manual") setTimeout(()=>openEntry(quick),250);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{if(hydrated)localStorage.setItem("ai-cash-v1",JSON.stringify(transactions))},[transactions,hydrated]);
  useEffect(()=>{if(hydrated)localStorage.setItem("hisaab-closings",JSON.stringify(closings))},[closings,hydrated]);

  const totals=useMemo(()=>{
    const received=transactions.filter(t=>t.direction==="IN").reduce((a,t)=>a+t.amount,0);
    const spent=transactions.filter(t=>t.direction==="OUT").reduce((a,t)=>a+t.amount,0);
    const todays=transactions.filter(t=>t.date===todayKey());
    const todayIn=todays.filter(t=>t.direction==="IN").reduce((a,t)=>a+t.amount,0);
    const todayOut=todays.filter(t=>t.direction==="OUT").reduce((a,t)=>a+t.amount,0);
    return {received,spent,balance:received-spent,todayIn,todayOut,todays};
  },[transactions]);
  const todayClosing=closings.find(c=>c.date===todayKey());
  const filtered=transactions.filter(t=>t.description.toLowerCase().includes(query.toLowerCase()));
  const display=(value:number)=>hidden?"Rs. •••••":money(value);

  function notify(message:string){setToast(message);setTimeout(()=>setToast(""),2600)}
  function closeEntry(){setEntryMode(null);setCandidate(null);setInput("");setListening(false)}
  function openEntry(mode:Exclude<EntryMode,null>){
    setTab("home");setEntryMode(mode);setCandidate(null);
    setTimeout(()=>{if(mode==="voice")startVoice();if(mode==="chat")chatRef.current?.focus();if(mode==="manual")manualRef.current?.focus()},120);
  }

  async function appendToSheet(row:Transaction,token=googleToken,sheetId=spreadsheetId){
    if(!token||!sheetId)return false;
    const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A:I:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({values:[[row.id,row.date,row.time,row.direction,row.action,row.amount,row.description,row.source,"Hisaab AI"]]})});
    return response.ok;
  }
  async function ensureClosingSheet(token:string,sheetId:string){
    const meta=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,{headers:{Authorization:`Bearer ${token}`}});if(!meta.ok)return false;
    const titles=((await meta.json()).sheets||[]).map((s:{properties:{title:string}})=>s.properties.title);
    if(!titles.includes("Daily Closings"))await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({requests:[{addSheet:{properties:{title:"Daily Closings",frozenRowCount:1}}}]})});
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'Daily Closings'!A1:G1?valueInputOption=RAW`,{method:"PUT",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({values:[["Date","Closed at","Expected cash","Counted cash","Difference","Entries","Note"]]})});return true;
  }
  async function appendClosingToSheet(c:Closing){if(!googleToken||!spreadsheetId)return;await ensureClosingSheet(googleToken,spreadsheetId);await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'Daily Closings'!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,{method:"POST",headers:{Authorization:`Bearer ${googleToken}`,"Content-Type":"application/json"},body:JSON.stringify({values:[[c.date,c.closedAt,c.expected,c.counted,c.difference,totals.todays.length,c.note]]})})}
  async function addTransaction(data:ReturnType<typeof parseNatural>,source:Source){
    const now=new Date(); const row:Transaction={id:Date.now(),amount:data.amount,description:data.description,direction:data.direction,action:data.action,date:todayKey(),time:now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),source,status:googleToken?"Pending":"Local"};
    setTransactions(prev=>[row,...prev]);closeEntry();notify(`${money(row.amount)} recorded`);
    if(googleToken){try{const synced=await appendToSheet(row);setTransactions(prev=>prev.map(t=>t.id===row.id?{...t,status:synced?"Synced":"Pending"}:t))}catch{notify("Saved on device · reconnect Sheets to sync")}}
  }
  async function interpretText(value:string){
    if(!value.trim())return;setParsing(true);
    if(geminiReady&&supabase&&session&&navigator.onLine){try{const {data,error}=await supabase.functions.invoke("parse-transaction",{body:{text:value}});if(!error&&data){setCandidate(data);setParsing(false);return}}catch{}}
    setCandidate(parseNatural(value));setParsing(false);
  }
  function startVoice(){
    const Recognition=(window as unknown as {webkitSpeechRecognition?:new()=>{lang:string;interimResults:boolean;start:()=>void;onresult:(e:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void;onend:()=>void}}).webkitSpeechRecognition;
    if(!Recognition){notify("Voice input works in supported Chrome browsers");setEntryMode(null);return}
    const r=new Recognition();r.lang="en-PK";r.interimResults=false;r.onresult=e=>{const text=e.results[0][0].transcript;setInput(text);void interpretText(text)};r.onend=()=>setListening(false);setListening(true);r.start();
  }
  function submitManual(e:FormEvent){e.preventDefault();const amount=Number(manual.amount);if(!amount||!manual.description.trim())return;void addTransaction({amount,description:manual.description,direction:manual.direction,action:manual.direction==="IN"?"Received":"Spent",ambiguous:false},"Manual");setManual({amount:"",description:"",direction:"OUT"})}
  function saveOpening(e:FormEvent){e.preventDefault();const amount=Number(openingAmount);if(!amount)return;void addTransaction({amount,description:"Opening balance",direction:"IN",action:"Opening balance",ambiguous:false},"Opening");setOpeningAmount("");setOpeningOpen(false)}
  async function saveClosing(e:FormEvent){e.preventDefault();const counted=Number(countedCash);if(countedCash==="")return;const closing:Closing={date:todayKey(),expected:totals.balance,counted,difference:counted-totals.balance,note:closingNote,closedAt:new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})};setClosings(prev=>[closing,...prev.filter(c=>c.date!==closing.date)]);setClosingOpen(false);setCountedCash("");setClosingNote("");try{await appendClosingToSheet(closing)}catch{}notify(closing.difference===0?"Day closed · cash tallied":"Day closed · difference recorded")}

  async function prepareSpreadsheet(token:string){
    let id=spreadsheetId;
    if(!id){const created=await fetch("https://sheets.googleapis.com/v4/spreadsheets",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({properties:{title:"Hisaab AI Cashbook"},sheets:[{properties:{title:"Transactions",frozenRowCount:1}},{properties:{title:"Daily Closings",frozenRowCount:1}}]})});if(!created.ok)throw new Error();id=(await created.json()).spreadsheetId;await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/Transactions!A1:I1?valueInputOption=RAW`,{method:"PUT",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({values:[["ID","Date","Time","Direction","Type","Amount (PKR)","Description","Entry method","Parser"]]})});localStorage.setItem("hisaab-sheet-id",id);setSpreadsheetId(id)}
    await ensureClosingSheet(token,id);
    for(const t of [...transactions].reverse().filter(t=>t.status!=="Synced"))await appendToSheet(t,token,id);return id;
  }
  async function connectGoogle(){
    if(!supabase){notify("Add your Supabase settings in public/config.js");return}
    if(session?.provider_token){try{await prepareSpreadsheet(session.provider_token);setTransactions(prev=>prev.map(t=>({...t,status:"Synced"})));notify("Google Sheets connected")}catch{notify("Google access expired · reconnect your account")}return}
    const {error}=await supabase.auth.signInWithOAuth({provider:"google",options:{scopes:"https://www.googleapis.com/auth/spreadsheets email profile",redirectTo:location.href.split("#")[0],queryParams:{access_type:"offline",prompt:"consent"}}});if(error)notify(error.message)
  }

  const Header=({title,back}:{title:string;back?:boolean})=><header className="screen-header">{back?<button onClick={()=>setTab("home")} aria-label="Back"><ArrowLeft/></button>:<div className="brand-mark">H</div>}<div><small>HISAAB</small><h1>{title}</h1></div><button className="header-sync" onClick={googleToken&&spreadsheetId?()=>window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`,"_blank"):connectGoogle} aria-label="Google Sheets"><FileSpreadsheet/><i className={googleToken?"online":""}/></button></header>;

  return <main className="phone-shell">
    {tab==="home"&&<section className="screen home-screen">
      <Header title="Cashbook"/>
      <div className="date-row"><span>{new Intl.DateTimeFormat("en-PK",{weekday:"long",day:"numeric",month:"long"}).format(new Date())}</span><span className="currency">PKR</span></div>
      <section className="balance-card">
        <div className="balance-label"><span>Current balance</span><button onClick={()=>setHidden(v=>!v)} aria-label={hidden?"Show balance":"Hide balance"}>{hidden?<EyeOff/>:<Eye/>}</button></div>
        <h2>{display(totals.balance)}</h2>
        <div className="today-flow"><div><span className="flow-dot in"><ArrowDownLeft/></span><p>Money in<strong>{display(totals.todayIn)}</strong></p></div><div><span className="flow-dot out"><ArrowUpRight/></span><p>Money out<strong>{display(totals.todayOut)}</strong></p></div></div>
      </section>

      {!transactions.length&&<button className="opening-prompt" onClick={()=>setOpeningOpen(true)}><span><Landmark/></span><div><strong>Add opening balance</strong><small>Set the cash you are starting with</small></div><ChevronRight/></button>}

      <div className="section-title"><div><small>QUICK ENTRY</small><h2>How do you want to record?</h2></div><Sparkles/></div>
      <div className="entry-grid">
        <button className="entry-action voice" onClick={()=>openEntry("voice")}><span><Mic/></span><strong>Voice</strong><small>Tap & speak</small></button>
        <button className="entry-action chat" onClick={()=>openEntry("chat")}><span><MessageCircleMore/></span><strong>Chat</strong><small>Type naturally</small></button>
        <button className="entry-action manual" onClick={()=>openEntry("manual")}><span><PenLine/></span><strong>Manual</strong><small>Fill details</small></button>
      </div>

      <button className={`closing-card ${todayClosing?"closed":""}`} onClick={()=>todayClosing?setTab("insights"):setClosingOpen(true)}>
        <span>{todayClosing?<CircleCheck/>:<ClipboardCheck/>}</span><div><strong>{todayClosing?"Today is closed":"Close today’s cash"}</strong><small>{todayClosing?`${todayClosing.closedAt} · ${todayClosing.difference===0?"Cash tallied":`${signedMoney(todayClosing.difference)} difference`}`:`Tally ${totals.todays.length} entries with cash in hand`}</small></div><ChevronRight/>
      </button>
      {!!transactions.length&&<div className="recent-mini"><div className="mini-head"><h3>Recent</h3><button onClick={()=>setTab("history")}>See all</button></div>{transactions.slice(0,3).map(t=><TransactionRow key={t.id} t={t}/>)}</div>}
    </section>}

    {tab==="history"&&<section className="screen"><Header title="History" back/><div className="search-box"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search transactions"/></div><div className="history-summary"><span>{filtered.length} entries</span><strong>{signedMoney(filtered.reduce((a,t)=>a+(t.direction==="IN"?t.amount:-t.amount),0))}</strong></div><div className="history-list">{!filtered.length?<Empty icon={<History/>} title="No transactions yet" text="Your recorded entries will appear here."/>:filtered.map(t=><TransactionRow key={t.id} t={t} showDate/>)}</div></section>}

    {tab==="insights"&&<section className="screen"><Header title="Insights" back/><section className="insight-hero"><small>ALL-TIME CASH FLOW</small><h2>{signedMoney(totals.balance)}</h2><div><span>Money in <strong>{money(totals.received)}</strong></span><span>Money out <strong>{money(totals.spent)}</strong></span></div></section><div className="section-title compact"><div><small>DAILY CLOSINGS</small><h2>Tally history</h2></div><CalendarDays/></div>{!closings.length?<Empty icon={<ClipboardCheck/>} title="No closing summary yet" text="Close a day to keep a record of expected and counted cash."/>:<div className="closing-list">{closings.map(c=><article key={c.date}><span className={c.difference===0?"match":"difference"}>{c.difference===0?<Check/>:<Info/>}</span><div><strong>{new Date(`${c.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"long",year:"numeric"})}</strong><small>Expected {money(c.expected)} · Counted {money(c.counted)}</small></div><b>{c.difference===0?"Tallied":signedMoney(c.difference)}</b></article>)}</div>}</section>}

    {tab==="settings"&&<section className="screen"><Header title="Settings" back/><div className="settings-group"><small>CASHBOOK</small><button onClick={()=>setOpeningOpen(true)}><span><Landmark/></span><div><strong>Add opening balance</strong><small>Record starting cash as money in</small></div><ChevronRight/></button><button onClick={()=>setClosingOpen(true)}><span><ClipboardCheck/></span><div><strong>Daily closing summary</strong><small>Count and tally today’s cash</small></div><ChevronRight/></button></div><div className="settings-group"><small>SYNC & AI</small><button onClick={connectGoogle}><span><FileSpreadsheet/></span><div><strong>{googleToken?"Google Sheets connected":"Connect Google Sheets"}</strong><small>{googleEmail||"Keep your cashbook in your account"}</small></div><ChevronRight/></button><div className="setting-status"><span><Sparkles/></span><div><strong>Transaction understanding</strong><small>{geminiReady?"Gemini AI is ready":"Smart offline parser active"}</small></div><i className={geminiReady?"on":""}/></div></div><p className="settings-note">Hisaab stores entries on this device and syncs them to your own Google Sheet when connected.</p></section>}

    <nav className="bottom-nav"><button className={tab==="home"?"active":""} onClick={()=>setTab("home")}><Home/><span>Home</span></button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}><History/><span>History</span></button><button className={tab==="insights"?"active":""} onClick={()=>setTab("insights")}><BarChart3/><span>Insights</span></button><button className={tab==="settings"?"active":""} onClick={()=>setTab("settings")}><Settings2/><span>Settings</span></button></nav>

    {entryMode&&<div className="sheet-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)closeEntry()}}><section className="entry-sheet" role="dialog" aria-modal="true"><div className="sheet-handle"/><button className="sheet-close" onClick={closeEntry} aria-label="Close"><X/></button>{entryMode==="voice"&&<><div className={`voice-orb ${listening?"listening":""}`}><Mic/></div><h2>{listening?"Listening…":"Voice entry"}</h2><p className="sheet-sub">Boliye: “500 rupay Imran se liye”</p>{input&&<div className="heard-text">“{input}”</div>} {!listening&&!candidate&&<button className="primary-button" onClick={startVoice}><Mic/> Tap to speak again</button>}</>}{entryMode==="chat"&&<><span className="sheet-icon chat"><MessageCircleMore/></span><h2>Type your transaction</h2><p className="sheet-sub">Roman Urdu or English — dono chalega</p><div className="chat-entry"><input ref={chatRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void interpretText(input)} placeholder="e.g. 2,000 chaye wale ko diye"/><button onClick={()=>void interpretText(input)} disabled={parsing}><Send/></button></div></>}{entryMode==="manual"&&<><span className="sheet-icon manual"><PenLine/></span><h2>Manual entry</h2><form className="manual-form" onSubmit={submitManual}><label>Amount (Rs.)<input ref={manualRef} type="number" inputMode="decimal" value={manual.amount} onChange={e=>setManual({...manual,amount:e.target.value})} placeholder="0"/></label><label>Description<input value={manual.description} onChange={e=>setManual({...manual,description:e.target.value})} placeholder="What was this for?"/></label><div className="direction-toggle"><button type="button" className={manual.direction==="IN"?"selected in":""} onClick={()=>setManual({...manual,direction:"IN"})}><ArrowDownLeft/> Money in</button><button type="button" className={manual.direction==="OUT"?"selected out":""} onClick={()=>setManual({...manual,direction:"OUT"})}><ArrowUpRight/> Money out</button></div><button className="primary-button" type="submit">Save transaction</button></form></>}{parsing&&<p className="parsing"><Sparkles/> Understanding your transaction…</p>}{candidate&&<Confirm candidate={candidate} setCandidate={setCandidate} save={()=>void addTransaction(candidate,entryMode==="voice"?"Voice":"Chat")}/>}</section></div>}

    {openingOpen&&<Modal close={()=>setOpeningOpen(false)} title="Add opening balance" subtitle="Enter the physical cash you are starting this cashbook with."><form onSubmit={saveOpening} className="single-form"><label>Opening cash (Rs.)<input autoFocus type="number" inputMode="decimal" value={openingAmount} onChange={e=>setOpeningAmount(e.target.value)} placeholder="0"/></label><p><Info/> This will be recorded as an opening balance entry.</p><button className="primary-button">Add opening balance</button></form></Modal>}
    {closingOpen&&<Modal close={()=>setClosingOpen(false)} title="Close today’s cash" subtitle="Count the physical cash you have, then compare it with Hisaab."><div className="closing-totals"><span>Opening / current balance<strong>{money(totals.balance)}</strong></span><span>Today’s entries<strong>{totals.todays.length}</strong></span></div><form onSubmit={saveClosing} className="single-form"><label>Cash counted (Rs.)<input autoFocus type="number" inputMode="decimal" value={countedCash} onChange={e=>setCountedCash(e.target.value)} placeholder="Enter physical cash"/></label>{countedCash!==""&&<div className={`difference-preview ${Number(countedCash)-totals.balance===0?"match":""}`}><span>{Number(countedCash)-totals.balance===0?<Check/>:<Info/>}</span><div><small>DIFFERENCE</small><strong>{signedMoney(Number(countedCash)-totals.balance)}</strong></div></div>}<label>Note (optional)<input value={closingNote} onChange={e=>setClosingNote(e.target.value)} placeholder="Reason for any difference"/></label><button className="primary-button">Save closing summary</button></form></Modal>}
    {toast&&<div className="toast" role="status"><Check/>{toast}</div>}
  </main>
}

function TransactionRow({t,showDate=false}:{t:Transaction;showDate?:boolean}){return <article className="transaction-row"><span className={t.direction==="IN"?"in":"out"}>{t.direction==="IN"?<ArrowDownLeft/>:<ArrowUpRight/>}</span><div><strong>{t.description}</strong><small>{showDate?`${new Date(`${t.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"short"})} · `:""}{t.time} · {t.source}</small></div><b className={t.direction==="IN"?"in":"out"}>{t.direction==="IN"?"+":"−"}{money(t.amount)}</b></article>}
function Empty({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{text}</p></div>}
function Modal({close,title,subtitle,children}:{close:()=>void;title:string;subtitle:string;children:React.ReactNode}){return <div className="sheet-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}><section className="entry-sheet modal-sheet" role="dialog" aria-modal="true"><div className="sheet-handle"/><button className="sheet-close" onClick={close} aria-label="Close"><X/></button><h2>{title}</h2><p className="sheet-sub">{subtitle}</p>{children}</section></div>}
function Confirm({candidate,setCandidate,save}:{candidate:ReturnType<typeof parseNatural>;setCandidate:(v:ReturnType<typeof parseNatural>|null)=>void;save:()=>void}){return <div className="confirm-box"><small>HISAAB UNDERSTOOD</small><h3>{money(candidate.amount)} · {candidate.description}</h3><p>{candidate.direction==="IN"?"Money coming in":"Money going out"}</p>{candidate.ambiguous?<div className="confirm-directions"><button onClick={()=>setCandidate({...candidate,direction:"IN",action:"Received",ambiguous:false})}>Money in</button><button onClick={()=>setCandidate({...candidate,direction:"OUT",action:"Spent",ambiguous:false})}>Money out</button></div>:<div className="confirm-actions"><button onClick={()=>setCandidate(null)}>Edit</button><button onClick={save}><Check/> Confirm & save</button></div>}</div>}
