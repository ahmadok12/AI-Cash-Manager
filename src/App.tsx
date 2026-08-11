"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient, Session, SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowDownLeft, ArrowLeft, ArrowUpRight, BarChart3, CalendarDays, Check,
  ChevronRight, CircleCheck, ClipboardCheck, Eye, EyeOff, FileSpreadsheet,
  History, Home, Info, Landmark, MessageCircleMore, Mic, PenLine, Search,
  Send, Settings2, Sparkles, Trash2, X,
} from "lucide-react";
import { parseSpokenAmount, stripSpokenAmount } from "../supabase/functions/_shared/spoken-amount";
import { canDeleteTransaction, canEditTransaction } from "./ledger";
import { cashbookSpreadsheetPayload, sheetProperties, transactionHeaders, transactionRows } from "./google-sheets";

type Direction = "IN" | "OUT";
type Source = "Voice" | "Chat" | "Manual" | "Opening";
type Transaction = { id:number; amount:number; description:string; direction:Direction; action:string; date:string; time:string; source:Source; status:"Synced"|"Pending"|"Local" };
type Closing = { date:string; expected:number; counted:number; difference:number; note:string; closedAt:string };
type Tab = "home" | "history" | "insights" | "settings";
type EntryMode = "voice" | "chat" | "manual" | null;
type SheetState = "disconnected" | "connecting" | "connected" | "error";

declare global {
  interface Window { APP_CONFIG?: { supabaseUrl?: string; supabasePublishableKey?: string } }
}

const todayKey = () => new Date().toISOString().slice(0,10);
const money = (value:number) => `Rs. ${Math.abs(value).toLocaleString("en-PK")}`;
const signedMoney = (value:number) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${money(value)}`;

function parseNatural(text:string) {
  const clean=text.trim(); const lower=clean.toLowerCase();
  const amount=parseSpokenAmount(lower);
  const received=/\b(se liye|wasool|receive|received|mili|mile|aaya|aya|nikalwaye|withdraw)/i.test(lower);
  const paid=/\b(ko diye|diye|ada kiye|payment ki|pay kiya|paid|spent|khareeda|dalwaya|jama krwaye|jama karwaye|deposit)/i.test(lower);
  const direction:Direction=received?"IN":"OUT";
  let action=received?"Received":"Spent";
  if (/nikalwaye|withdraw/i.test(lower)) action="Withdrawn";
  if (/jama|deposit/i.test(lower)) action="Deposited";
  const description=stripSpokenAmount(clean).replace(/^\s*(?:maine|main ne|i)\b\s*/i,"").replace(/\s{2,}/g," ").trim()||"Cash transaction";
  return { amount, description, direction, action, ambiguous:!amount||(!received&&!paid) };
}

async function googleApiError(response:Response,fallback:string){
  const detail=await response.json().catch(()=>({})) as {error?:{code?:number;message?:string;status?:string}};
  const message=detail.error?.message||fallback;
  if(response.status===401)return "Google access expired. Tap Reconnect Google Sheets and approve access again.";
  if(response.status===403&&/insufficient|scope|permission/i.test(message))return "Google Sheets permission was not granted. Reconnect and allow spreadsheet access.";
  if(response.status===403&&/api.*disabled|not been used/i.test(message))return "Enable Google Sheets API in the same Google Cloud project, then reconnect.";
  return message;
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
  const [sheetState,setSheetState]=useState<SheetState>("disconnected");
  const [sheetError,setSheetError]=useState("");
  const [editTarget,setEditTarget]=useState<Transaction|null>(null);
  const [editDraft,setEditDraft]=useState({amount:"",description:"",direction:"OUT" as Direction,date:todayKey()});
  const [deleteTarget,setDeleteTarget]=useState<Transaction|null>(null);
  const chatRef=useRef<HTMLInputElement>(null);
  const manualRef=useRef<HTMLInputElement>(null);
  const sheetConnectInFlight=useRef(false);

  useEffect(()=>{
    const saved=localStorage.getItem("ai-cash-v1"); if(saved) setTransactions(JSON.parse(saved));
    const savedClosings=localStorage.getItem("hisaab-closings"); if(savedClosings) setClosings(JSON.parse(savedClosings));
    setSpreadsheetId(localStorage.getItem("hisaab-sheet-id")||""); setHydrated(true);
    const config=window.APP_CONFIG||{};
    if(config.supabaseUrl&&config.supabasePublishableKey&&!config.supabaseUrl.includes("YOUR_")){
      const client=createClient(config.supabaseUrl,config.supabasePublishableKey);setSupabase(client);setGeminiReady(true);
      client.auth.getSession().then(({data})=>{
        const current=data.session;setSession(current);setGoogleEmail(current?.user.email||"");
        if(current?.provider_token){setGoogleToken(current.provider_token);sessionStorage.setItem("hisaab-google-token",current.provider_token)}
      });
      const {data:listener}=client.auth.onAuthStateChange((_event,next)=>{
        setSession(next);setGoogleEmail(next?.user.email||"");
        if(next?.provider_token){setGoogleToken(next.provider_token);sessionStorage.setItem("hisaab-google-token",next.provider_token)}
      });
      const quick=new URLSearchParams(location.search).get("quick");if(quick==="voice"||quick==="chat"||quick==="manual")setTimeout(()=>openEntry(quick),250);
      return()=>listener.subscription.unsubscribe();
    }
    const quick=new URLSearchParams(location.search).get("quick");
    if(quick==="voice"||quick==="chat"||quick==="manual") setTimeout(()=>openEntry(quick),250);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{if(hydrated)localStorage.setItem("ai-cash-v1",JSON.stringify(transactions))},[transactions,hydrated]);
  useEffect(()=>{if(hydrated)localStorage.setItem("hisaab-closings",JSON.stringify(closings))},[closings,hydrated]);
  useEffect(()=>{
    if(!hydrated)return;
    const token=googleToken||sessionStorage.getItem("hisaab-google-token")||"";
    if(token&&!googleToken)setGoogleToken(token);
    if(token&&(!spreadsheetId||localStorage.getItem("hisaab-sheet-connect-pending")==="1"))void finishSheetConnection(token);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[hydrated,googleToken]);

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

  async function syncAllTransactions(list:Transaction[],token=googleToken,sheetId=spreadsheetId){
    if(!token||!sheetId)return false;
    const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
    const heading=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A1:J1?valueInputOption=RAW`,{method:"PUT",headers,body:JSON.stringify({values:[transactionHeaders]})});
    if(!heading.ok)return false;
    const cleared=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A2:Z:clear`,{method:"POST",headers});
    if(!cleared.ok)return false;
    const rows=transactionRows(list);if(!rows.length)return true;
    const written=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A2:J?valueInputOption=USER_ENTERED`,{method:"PUT",headers,body:JSON.stringify({values:rows})});
    return written.ok;
  }
  async function ensureClosingSheet(token:string,sheetId:string){
    const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
    const meta=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,{headers});if(!meta.ok)throw new Error(await googleApiError(meta,"Google could not read the cashbook"));
    const titles=((await meta.json()).sheets||[]).map((s:{properties:{title:string}})=>s.properties.title);
    if(!titles.includes("Daily Closings")){const added=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,{method:"POST",headers,body:JSON.stringify({requests:[{addSheet:{properties:sheetProperties("Daily Closings")}}]})});if(!added.ok)throw new Error(await googleApiError(added,"Google could not add the closing sheet"))}
    const heading=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'Daily Closings'!A1:G1?valueInputOption=RAW`,{method:"PUT",headers,body:JSON.stringify({values:[["Date","Closed at","Expected cash","Counted cash","Difference","Entries","Note"]]})});if(!heading.ok)throw new Error(await googleApiError(heading,"Google could not prepare the closing sheet"));return true;
  }
  async function appendClosingToSheet(c:Closing){if(!googleToken||!spreadsheetId)return;await ensureClosingSheet(googleToken,spreadsheetId);await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'Daily Closings'!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,{method:"POST",headers:{Authorization:`Bearer ${googleToken}`,"Content-Type":"application/json"},body:JSON.stringify({values:[[c.date,c.closedAt,c.expected,c.counted,c.difference,totals.todays.length,c.note]]})})}
  async function addTransaction(data:ReturnType<typeof parseNatural>,source:Source){
    if(data.direction==="OUT"&&data.amount>totals.balance){notify(`Not enough balance · available ${money(totals.balance)}`);return}
    const now=new Date(); const row:Transaction={id:Date.now(),amount:data.amount,description:data.description,direction:data.direction,action:data.action,date:todayKey(),time:now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),source,status:googleToken?"Pending":"Local"};
    const next=[row,...transactions];setTransactions(next);closeEntry();notify(`${money(row.amount)} recorded`);
    if(googleToken&&spreadsheetId){try{const synced=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>t.id===row.id?{...t,status:synced?"Synced":"Pending"}:t));if(!synced)notify("Saved on device · Sheets sync pending")}catch{notify("Saved on device · reconnect Sheets to sync")}}
  }
  async function interpretText(value:string){
    if(!value.trim())return;setParsing(true);
    if(geminiReady&&supabase&&session&&navigator.onLine){try{const {data,error}=await supabase.functions.invoke("parse-transaction",{body:{text:value}});if(!error&&data){const spoken=parseSpokenAmount(value);setCandidate({...data,amount:spoken||data.amount});setParsing(false);return}}catch{}}
    setCandidate(parseNatural(value));setParsing(false);
  }
  function startVoice(){
    const Recognition=(window as unknown as {webkitSpeechRecognition?:new()=>{lang:string;interimResults:boolean;start:()=>void;onresult:(e:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void;onend:()=>void}}).webkitSpeechRecognition;
    if(!Recognition){notify("Voice input works in supported Chrome browsers");setEntryMode(null);return}
    const r=new Recognition();r.lang="en-PK";r.interimResults=false;r.onresult=e=>{const text=e.results[0][0].transcript;setInput(text);void interpretText(text)};r.onend=()=>setListening(false);setListening(true);r.start();
  }
  function submitManual(e:FormEvent){e.preventDefault();const amount=Number(manual.amount);if(!amount||!manual.description.trim())return;void addTransaction({amount,description:manual.description,direction:manual.direction,action:manual.direction==="IN"?"Received":"Spent",ambiguous:false},"Manual");setManual({amount:"",description:"",direction:"OUT"})}
  function saveOpening(e:FormEvent){e.preventDefault();const amount=Number(openingAmount);if(!amount)return;void addTransaction({amount,description:"Opening balance",direction:"IN",action:"Opening balance",ambiguous:false},"Opening");setOpeningAmount("");setOpeningOpen(false)}
  function openEdit(t:Transaction){setEditTarget(t);setEditDraft({amount:String(t.amount),description:t.description,direction:t.direction,date:t.date})}
  async function saveEdit(e:FormEvent){
    e.preventDefault();if(!editTarget)return;const amount=Number(editDraft.amount);if(!amount||!editDraft.description.trim())return;
    const next:Transaction[]=transactions.map(t=>t.id===editTarget.id?{...t,amount,description:editDraft.description.trim(),direction:editDraft.direction,action:editDraft.direction==="IN"?"Received":"Spent",date:editDraft.date,status:googleToken?"Pending":"Local"}:t);
    if(!canEditTransaction(transactions,editTarget,{direction:editDraft.direction,amount})){notify(`This edit would exceed the available balance`);return}
    setTransactions(next);setEditTarget(null);notify("Transaction updated");
    if(googleToken&&spreadsheetId){try{const ok=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>({...t,status:ok?"Synced":"Pending"})));if(!ok)notify("Updated on device · Sheets sync pending")}catch{notify("Updated on device · Sheets sync pending")}}
  }
  async function confirmDelete(){
    if(!deleteTarget)return;const next=transactions.filter(t=>t.id!==deleteTarget.id);
    if(!canDeleteTransaction(transactions,deleteTarget)){notify("Cannot delete this money-in entry because the balance would become negative");return}
    setTransactions(next);setDeleteTarget(null);notify("Transaction deleted");
    if(googleToken&&spreadsheetId){try{const ok=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>({...t,status:ok?"Synced":"Pending"})));if(!ok)notify("Deleted on device · Sheets sync pending")}catch{notify("Deleted on device · Sheets sync pending")}}
  }
  async function saveClosing(e:FormEvent){e.preventDefault();const counted=Number(countedCash);if(countedCash==="")return;const closing:Closing={date:todayKey(),expected:totals.balance,counted,difference:counted-totals.balance,note:closingNote,closedAt:new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})};setClosings(prev=>[closing,...prev.filter(c=>c.date!==closing.date)]);setClosingOpen(false);setCountedCash("");setClosingNote("");try{await appendClosingToSheet(closing)}catch{}notify(closing.difference===0?"Day closed · cash tallied":"Day closed · difference recorded")}

  async function prepareSpreadsheet(token:string){
    let id=spreadsheetId;
    const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
    if(id){const existing=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=spreadsheetId`,{headers});if(!existing.ok){id="";localStorage.removeItem("hisaab-sheet-id");setSpreadsheetId("")}}
    if(!id){const created=await fetch("https://sheets.googleapis.com/v4/spreadsheets",{method:"POST",headers,body:JSON.stringify(cashbookSpreadsheetPayload())});if(!created.ok)throw new Error(await googleApiError(created,"Google Sheets could not create the cashbook"));const createdSheet=await created.json();id=createdSheet.spreadsheetId;if(!id)throw new Error("Google did not return a spreadsheet ID");localStorage.setItem("hisaab-sheet-id",id);setSpreadsheetId(id)}
    await ensureClosingSheet(token,id);
    const synced=await syncAllTransactions(transactions,token,id);if(!synced)throw new Error("Cashbook created, but transactions could not be synced");return id;
  }
  async function finishSheetConnection(token:string){
    if(sheetConnectInFlight.current)return;
    sheetConnectInFlight.current=true;
    setSheetState("connecting");setSheetError("");
    try{await prepareSpreadsheet(token);setTransactions(prev=>prev.map(t=>({...t,status:"Synced"})));localStorage.removeItem("hisaab-sheet-connect-pending");setSheetState("connected");notify("Hisaab AI Cashbook created and connected")}
    catch(error){const message=error instanceof Error?error.message:"Google Sheets connection failed";sessionStorage.removeItem("hisaab-google-token");setGoogleToken("");setSheetState("error");setSheetError(message);notify(message)}
    finally{sheetConnectInFlight.current=false}
  }
  async function connectGoogle(){
    if(!supabase){notify("Add your Supabase settings in public/config.js");return}
    const token=googleToken||sessionStorage.getItem("hisaab-google-token")||session?.provider_token||"";
    if(token&&sheetState!=="error"){await finishSheetConnection(token);return}
    localStorage.setItem("hisaab-sheet-connect-pending","1");setSheetState("connecting");
    const redirectTo=`${location.origin}${location.pathname}`;
    const {error}=await supabase.auth.signInWithOAuth({provider:"google",options:{scopes:"https://www.googleapis.com/auth/spreadsheets email profile",redirectTo,queryParams:{access_type:"offline",prompt:"consent",include_granted_scopes:"true"}}});if(error){localStorage.removeItem("hisaab-sheet-connect-pending");setSheetState("error");notify(error.message)}
  }

  const Header=({title,back}:{title:string;back?:boolean})=><header className="screen-header">{back?<button onClick={()=>setTab("home")} aria-label="Back"><ArrowLeft/></button>:<div className="brand-mark">H</div>}<div><small>HISAAB</small><h1>{title}</h1></div><button className="header-sync" onClick={spreadsheetId&&sheetState!=="error"?()=>window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`,"_blank"):connectGoogle} aria-label="Google Sheets"><FileSpreadsheet/><i className={spreadsheetId?"online":sheetState==="error"?"error":""}/></button></header>;

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
        <button className="entry-action chat" onClick={()=>openEntry("chat")}><span><MessageCircleMore/></span><strong>Chat</strong><small>Type naturally</small></button>
        <button className="entry-action voice" onClick={()=>openEntry("voice")}><span><Mic/></span><strong>Voice</strong><small>Tap & speak</small></button>
        <button className="entry-action manual" onClick={()=>openEntry("manual")}><span><PenLine/></span><strong>Manual</strong><small>Fill details</small></button>
      </div>

      <button className={`closing-card ${todayClosing?"closed":""}`} onClick={()=>todayClosing?setTab("insights"):setClosingOpen(true)}>
        <span>{todayClosing?<CircleCheck/>:<ClipboardCheck/>}</span><div><strong>{todayClosing?"Today is closed":"Close today’s cash"}</strong><small>{todayClosing?`${todayClosing.closedAt} · ${todayClosing.difference===0?"Cash tallied":`${signedMoney(todayClosing.difference)} difference`}`:`Tally ${totals.todays.length} entries with cash in hand`}</small></div><ChevronRight/>
      </button>
      {!!transactions.length&&<div className="recent-mini"><div className="mini-head"><h3>Recent</h3><button onClick={()=>setTab("history")}>See all</button></div>{transactions.slice(0,3).map(t=><TransactionRow key={t.id} t={t}/>)}</div>}
    </section>}

    {tab==="history"&&<section className="screen"><Header title="History" back/><div className="search-box"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search transactions"/></div><div className="history-summary"><span>{filtered.length} entries</span><strong>{signedMoney(filtered.reduce((a,t)=>a+(t.direction==="IN"?t.amount:-t.amount),0))}</strong></div><div className="history-list">{!filtered.length?<Empty icon={<History/>} title="No transactions yet" text="Your recorded entries will appear here."/>:filtered.map(t=><TransactionRow key={t.id} t={t} showDate actions onEdit={()=>openEdit(t)} onDelete={()=>setDeleteTarget(t)}/>)}</div></section>}

    {tab==="insights"&&<section className="screen"><Header title="Insights" back/><section className="insight-hero"><small>ALL-TIME CASH FLOW</small><h2>{signedMoney(totals.balance)}</h2><div><span>Money in <strong>{money(totals.received)}</strong></span><span>Money out <strong>{money(totals.spent)}</strong></span></div></section><div className="section-title compact"><div><small>DAILY CLOSINGS</small><h2>Tally history</h2></div><CalendarDays/></div>{!closings.length?<Empty icon={<ClipboardCheck/>} title="No closing summary yet" text="Close a day to keep a record of expected and counted cash."/>:<div className="closing-list">{closings.map(c=><article key={c.date}><span className={c.difference===0?"match":"difference"}>{c.difference===0?<Check/>:<Info/>}</span><div><strong>{new Date(`${c.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"long",year:"numeric"})}</strong><small>Expected {money(c.expected)} · Counted {money(c.counted)}</small></div><b>{c.difference===0?"Tallied":signedMoney(c.difference)}</b></article>)}</div>}</section>}

    {tab==="settings"&&<section className="screen"><Header title="Settings" back/><div className="settings-group"><small>CASHBOOK</small><button onClick={()=>setOpeningOpen(true)}><span><Landmark/></span><div><strong>Add opening balance</strong><small>Record starting cash as money in</small></div><ChevronRight/></button><button onClick={()=>setClosingOpen(true)}><span><ClipboardCheck/></span><div><strong>Daily closing summary</strong><small>Count and tally today’s cash</small></div><ChevronRight/></button></div><div className="settings-group"><small>SYNC & AI</small><button onClick={connectGoogle} disabled={sheetState==="connecting"}><span><FileSpreadsheet/></span><div><strong>{sheetState==="connecting"?"Creating your Google Sheet…":spreadsheetId?"Google Sheets connected":sheetState==="error"?"Reconnect Google Sheets":"Connect Google Sheets"}</strong><small>{sheetError||googleEmail||"Creates Hisaab AI Cashbook in your account"}</small></div><ChevronRight/></button>{spreadsheetId&&<button onClick={()=>window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`,"_blank")}><span><FileSpreadsheet/></span><div><strong>Open Hisaab AI Cashbook</strong><small>View synced entries in Google Sheets</small></div><ChevronRight/></button>}<div className="setting-status"><span><Sparkles/></span><div><strong>Transaction understanding</strong><small>{geminiReady?"Gemini AI is ready":"Smart offline parser active"}</small></div><i className={geminiReady?"on":""}/></div></div><p className="settings-note">Hisaab stores entries on this device and syncs them to your own Google Sheet when connected.</p></section>}

    <nav className="bottom-nav"><button className={tab==="home"?"active":""} onClick={()=>setTab("home")}><Home/><span>Home</span></button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}><History/><span>History</span></button><button className={tab==="insights"?"active":""} onClick={()=>setTab("insights")}><BarChart3/><span>Insights</span></button><button className={tab==="settings"?"active":""} onClick={()=>setTab("settings")}><Settings2/><span>Settings</span></button></nav>

    {entryMode&&<div className="sheet-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)closeEntry()}}><section className="entry-sheet" role="dialog" aria-modal="true"><div className="sheet-handle"/><button className="sheet-close" onClick={closeEntry} aria-label="Close"><X/></button>{entryMode==="voice"&&<><div className={`voice-orb ${listening?"listening":""}`}><Mic/></div><h2>{listening?"Listening…":"Voice entry"}</h2><p className="sheet-sub">Boliye: “500 rupay Imran se liye”</p>{input&&<div className="heard-text">“{input}”</div>} {!listening&&!candidate&&<button className="primary-button" onClick={startVoice}><Mic/> Tap to speak again</button>}</>}{entryMode==="chat"&&<><span className="sheet-icon chat"><MessageCircleMore/></span><h2>Type your transaction</h2><p className="sheet-sub">Roman Urdu or English — dono chalega</p><div className="chat-entry"><input ref={chatRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void interpretText(input)} placeholder="e.g. 2,000 chaye wale ko diye"/><button onClick={()=>void interpretText(input)} disabled={parsing}><Send/></button></div></>}{entryMode==="manual"&&<><span className="sheet-icon manual"><PenLine/></span><h2>Manual entry</h2><form className="manual-form" onSubmit={submitManual}><label>Amount (Rs.)<input ref={manualRef} type="number" inputMode="decimal" value={manual.amount} onChange={e=>setManual({...manual,amount:e.target.value})} placeholder="0"/></label><label>Description<input value={manual.description} onChange={e=>setManual({...manual,description:e.target.value})} placeholder="What was this for?"/></label><div className="direction-toggle"><button type="button" className={manual.direction==="IN"?"selected in":""} onClick={()=>setManual({...manual,direction:"IN"})}><ArrowDownLeft/> Money in</button><button type="button" className={manual.direction==="OUT"?"selected out":""} onClick={()=>setManual({...manual,direction:"OUT"})}><ArrowUpRight/> Money out</button></div><button className="primary-button" type="submit">Save transaction</button></form></>}{parsing&&<p className="parsing"><Sparkles/> Understanding your transaction…</p>}{candidate&&<Confirm candidate={candidate} setCandidate={setCandidate} save={()=>void addTransaction(candidate,entryMode==="voice"?"Voice":"Chat")}/>}</section></div>}

    {openingOpen&&<Modal close={()=>setOpeningOpen(false)} title="Add opening balance" subtitle="Enter the physical cash you are starting this cashbook with."><form onSubmit={saveOpening} className="single-form"><label>Opening cash (Rs.)<input autoFocus type="number" inputMode="decimal" value={openingAmount} onChange={e=>setOpeningAmount(e.target.value)} placeholder="0"/></label><p><Info/> This will be recorded as an opening balance entry.</p><button className="primary-button">Add opening balance</button></form></Modal>}
    {closingOpen&&<Modal close={()=>setClosingOpen(false)} title="Close today’s cash" subtitle="Count the physical cash you have, then compare it with Hisaab."><div className="closing-totals"><span>Opening / current balance<strong>{money(totals.balance)}</strong></span><span>Today’s entries<strong>{totals.todays.length}</strong></span></div><form onSubmit={saveClosing} className="single-form"><label>Cash counted (Rs.)<input autoFocus type="number" inputMode="decimal" value={countedCash} onChange={e=>setCountedCash(e.target.value)} placeholder="Enter physical cash"/></label>{countedCash!==""&&<div className={`difference-preview ${Number(countedCash)-totals.balance===0?"match":""}`}><span>{Number(countedCash)-totals.balance===0?<Check/>:<Info/>}</span><div><small>DIFFERENCE</small><strong>{signedMoney(Number(countedCash)-totals.balance)}</strong></div></div>}<label>Note (optional)<input value={closingNote} onChange={e=>setClosingNote(e.target.value)} placeholder="Reason for any difference"/></label><button className="primary-button">Save closing summary</button></form></Modal>}
    {editTarget&&<Modal close={()=>setEditTarget(null)} title="Edit transaction" subtitle="Update this past entry. Your balance and Google Sheet will be recalculated."><form onSubmit={saveEdit} className="manual-form"><label>Amount (Rs.)<input autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={editDraft.amount} onChange={e=>setEditDraft({...editDraft,amount:e.target.value})}/></label><label>Description<input value={editDraft.description} onChange={e=>setEditDraft({...editDraft,description:e.target.value})}/></label><label>Date<input type="date" value={editDraft.date} onChange={e=>setEditDraft({...editDraft,date:e.target.value})}/></label><div className="direction-toggle"><button type="button" className={editDraft.direction==="IN"?"selected in":""} onClick={()=>setEditDraft({...editDraft,direction:"IN"})}><ArrowDownLeft/> Money in</button><button type="button" className={editDraft.direction==="OUT"?"selected out":""} onClick={()=>setEditDraft({...editDraft,direction:"OUT"})}><ArrowUpRight/> Money out</button></div><button className="primary-button">Save changes</button></form></Modal>}
    {deleteTarget&&<Modal close={()=>setDeleteTarget(null)} title="Delete transaction?" subtitle={`${money(deleteTarget.amount)} · ${deleteTarget.description}`}><div className="delete-confirm"><p>This removes the entry from the app and the connected Google Sheet.</p><button className="danger-button" onClick={()=>void confirmDelete()}><Trash2/> Delete transaction</button><button className="secondary-button" onClick={()=>setDeleteTarget(null)}>Keep entry</button></div></Modal>}
    {toast&&<div className="toast" role="status"><Check/>{toast}</div>}
  </main>
}

function TransactionRow({t,showDate=false,actions=false,onEdit,onDelete}:{t:Transaction;showDate?:boolean;actions?:boolean;onEdit?:()=>void;onDelete?:()=>void}){return <article className={`transaction-row ${actions?"with-actions":""}`}><span className={t.direction==="IN"?"in":"out"}>{t.direction==="IN"?<ArrowDownLeft/>:<ArrowUpRight/>}</span><div><strong>{t.description}</strong><small>{showDate?`${new Date(`${t.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"short"})} · `:""}{t.time} · {t.source}</small></div><b className={t.direction==="IN"?"in":"out"}>{t.direction==="IN"?"+":"−"}{money(t.amount)}</b>{actions&&<div className="row-actions"><button onClick={onEdit} aria-label={`Edit ${t.description}`}><PenLine/></button><button className="delete" onClick={onDelete} aria-label={`Delete ${t.description}`}><Trash2/></button></div>}</article>}
function Empty({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{text}</p></div>}
function Modal({close,title,subtitle,children}:{close:()=>void;title:string;subtitle:string;children:React.ReactNode}){return <div className="sheet-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}><section className="entry-sheet modal-sheet" role="dialog" aria-modal="true"><div className="sheet-handle"/><button className="sheet-close" onClick={close} aria-label="Close"><X/></button><h2>{title}</h2><p className="sheet-sub">{subtitle}</p>{children}</section></div>}
function Confirm({candidate,setCandidate,save}:{candidate:ReturnType<typeof parseNatural>;setCandidate:(v:ReturnType<typeof parseNatural>|null)=>void;save:()=>void}){return <div className="confirm-box"><small>HISAAB UNDERSTOOD</small><h3>{money(candidate.amount)} · {candidate.description}</h3><p>{candidate.direction==="IN"?"Money coming in":"Money going out"}</p>{candidate.ambiguous?<div className="confirm-directions"><button onClick={()=>setCandidate({...candidate,direction:"IN",action:"Received",ambiguous:false})}>Money in</button><button onClick={()=>setCandidate({...candidate,direction:"OUT",action:"Spent",ambiguous:false})}>Money out</button></div>:<div className="confirm-actions"><button onClick={()=>setCandidate(null)}>Edit</button><button onClick={save}><Check/> Confirm & save</button></div>}</div>}
