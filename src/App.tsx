"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient, Session, SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowDownLeft, ArrowLeft, ArrowUpRight, BarChart3, CalendarDays, Check,
  ChevronRight, CircleCheck, ClipboardCheck, Eye, EyeOff, FileSpreadsheet,
  History, Home, Info, Landmark, MessageCircleMore, Mic, PenLine, Search,
  Send, Settings2, Sparkles, Trash2, X,
  Banknote, Cloud, RefreshCw, ShieldCheck, WalletCards,
} from "lucide-react";
import { parseSpokenAmount, stripSpokenAmount } from "../supabase/functions/_shared/spoken-amount";
import { canDeleteTransaction, canEditTransaction } from "./ledger";
import { cashbookSpreadsheetPayload, sheetProperties, transactionHeadersFor, transactionRows } from "./google-sheets";
import { currentOpeningBalance, isOpeningBalanceEntry, openingBalanceEntries, replaceOpeningBalance } from "./opening-balance";
import { loadCloudCashbook, saveCloudCashbook } from "./cloud-backup";
import { compareSheetTransactions, parseSheetRows, SheetConflictSummary } from "./sheet-conflicts";
import { CashbookProfile, CURRENCY_OPTIONS, currencyPrefix, DEFAULT_PROFILE, normalizeProfile, profileIsValid } from "./profile";

type Direction = "IN" | "OUT";
type Source = "Voice" | "Chat" | "Manual" | "Opening";
type Transaction = { id:number; amount:number; description:string; direction:Direction; action:string; date:string; time:string; source:Source; status:"Synced"|"Pending"|"Local" };
type Closing = { date:string; expected:number; counted:number; difference:number; note:string; closedAt:string };
type Tab = "home" | "history" | "insights" | "settings";
type EntryMode = "voice" | "chat" | "manual" | null;
type SheetState = "disconnected" | "connecting" | "connected" | "error";
type CloudState = "device" | "saving" | "saved" | "unavailable";

declare global {
  interface Window { APP_CONFIG?: { supabaseUrl?: string; supabasePublishableKey?: string } }
}

const todayKey = () => new Date().toISOString().slice(0,10);
const money = (value:number,currency:CashbookProfile["currency"]="PKR") => `${currencyPrefix(currency)} ${Math.abs(value).toLocaleString("en-PK")}`;
const signedMoney = (value:number,currency:CashbookProfile["currency"]="PKR") => `${value < 0 ? "−" : value > 0 ? "+" : ""}${money(value,currency)}`;

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
  const [openingDate,setOpeningDate]=useState(todayKey());
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
  const [profile,setProfile]=useState<CashbookProfile>({...DEFAULT_PROFILE});
  const [profileDraft,setProfileDraft]=useState<CashbookProfile>({...DEFAULT_PROFILE});
  const [profileOpen,setProfileOpen]=useState(false);
  const [onboardingStep,setOnboardingStep]=useState(0);
  const [cloudState,setCloudState]=useState<CloudState>("device");
  const [cloudReadyUser,setCloudReadyUser]=useState("");
  const [sheetConflict,setSheetConflict]=useState<SheetConflictSummary<Transaction>|null>(null);
  const [checkingSheet,setCheckingSheet]=useState(false);
  const chatRef=useRef<HTMLInputElement>(null);
  const manualRef=useRef<HTMLInputElement>(null);
  const sheetConnectInFlight=useRef(false);
  const cloudLoadedForUser=useRef("");
  const cloudSaveTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(()=>{
    const saved=localStorage.getItem("ai-cash-v1"); const savedTransactions:Transaction[]=saved?JSON.parse(saved):[];if(saved)setTransactions(savedTransactions);
    const savedClosings=localStorage.getItem("hisaab-closings"); if(savedClosings) setClosings(JSON.parse(savedClosings));
    const savedProfile=localStorage.getItem("hisaab-profile-v2");
    if(savedProfile){const next=normalizeProfile(JSON.parse(savedProfile));setProfile(next);setProfileDraft(next);if(!next.onboardingComplete)setOnboardingStep(1)}
    else if(savedTransactions.length){const migrated={...DEFAULT_PROFILE,onboardingComplete:true};setProfile(migrated);setProfileDraft(migrated);localStorage.setItem("hisaab-profile-v2",JSON.stringify(migrated))}
    else setOnboardingStep(1);
    setSpreadsheetId(localStorage.getItem("hisaab-sheet-id")||""); setHydrated(true);
    const config=window.APP_CONFIG||{};
    if(config.supabaseUrl&&config.supabasePublishableKey&&!config.supabaseUrl.includes("YOUR_")){
      const client=createClient(config.supabaseUrl,config.supabasePublishableKey);setSupabase(client);setGeminiReady(true);
      client.auth.getSession().then(({data})=>{
        const current=data.session;setSession(current);setGoogleEmail(current?.user.email||"");
        if(current?.provider_token){setGoogleToken(current.provider_token);sessionStorage.setItem("hisaab-google-token",current.provider_token)}
        if(!current)void client.auth.signInAnonymously();
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
  useEffect(()=>{if(hydrated)localStorage.setItem("hisaab-profile-v2",JSON.stringify(profile))},[profile,hydrated]);
  useEffect(()=>{
    if(!hydrated||!supabase||!session||cloudLoadedForUser.current===session.user.id)return;
    cloudLoadedForUser.current=session.user.id;
    void loadCloudCashbook<Transaction,Closing>(supabase).then(remote=>{
      if(remote&&transactions.length===0&&closings.length===0){
        setTransactions(remote.transactions||[]);setClosings(remote.closings||[]);
        if(remote.profile){const restored=normalizeProfile(remote.profile);setProfile(restored);setProfileDraft(restored);setOnboardingStep(restored.onboardingComplete?0:1)}
        if(remote.spreadsheetId&&!spreadsheetId){setSpreadsheetId(remote.spreadsheetId);localStorage.setItem("hisaab-sheet-id",remote.spreadsheetId)}
      }
      setCloudReadyUser(session.user.id);setCloudState("saved");
    }).catch(()=>{setCloudReadyUser(session.user.id);setCloudState("unavailable")});
  // load once per authenticated/anonymous user; current local state intentionally wins when present
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[hydrated,supabase,session]);
  useEffect(()=>{
    if(!hydrated||!supabase||!session||cloudReadyUser!==session.user.id)return;
    if(cloudSaveTimer.current)clearTimeout(cloudSaveTimer.current);
    setCloudState("saving");
    cloudSaveTimer.current=setTimeout(()=>{
      void saveCloudCashbook(supabase,session.user.id,{transactions,closings,profile,spreadsheetId})
        .then(()=>setCloudState("saved")).catch(()=>setCloudState("unavailable"));
    },700);
    return()=>{if(cloudSaveTimer.current)clearTimeout(cloudSaveTimer.current)};
  },[transactions,closings,profile,spreadsheetId,hydrated,supabase,session,cloudReadyUser]);
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
  const openingEntry=currentOpeningBalance(transactions);
  const openingEntryCount=openingBalanceEntries(transactions).length;
  const filtered=transactions.filter(t=>t.description.toLowerCase().includes(query.toLowerCase()));
  const formatMoney=(value:number)=>money(value,profile.currency);
  const formatSigned=(value:number)=>signedMoney(value,profile.currency);
  const display=(value:number)=>hidden?`${currencyPrefix(profile.currency)} •••••`:formatMoney(value);

  function notify(message:string){setToast(message);setTimeout(()=>setToast(""),2600)}
  function closeEntry(){setEntryMode(null);setCandidate(null);setInput("");setListening(false)}
  function openEntry(mode:Exclude<EntryMode,null>){
    setTab("home");setEntryMode(mode);setCandidate(null);
    setTimeout(()=>{if(mode==="voice")startVoice();if(mode==="chat")chatRef.current?.focus();if(mode==="manual")manualRef.current?.focus()},120);
  }

  const normalizedSheetRows=(rows:unknown[][])=>JSON.stringify(rows.map(row=>row.map(cell=>String(cell??""))));
  async function readSheetRows(token:string,sheetId:string){
    const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A2:J`,{headers:{Authorization:`Bearer ${token}`}});
    if(!response.ok)throw new Error(await googleApiError(response,"Google Sheet could not be checked for changes"));
    return ((await response.json()).values||[]) as unknown[][];
  }
  async function syncAllTransactions(list:Transaction[],token=googleToken,sheetId=spreadsheetId,bypassConflict=false){
    if(!token||!sheetId)return false;
    const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
    if(!bypassConflict){
      const remoteRows=await readSheetRows(token,sheetId);
      const savedSnapshot=localStorage.getItem("hisaab-sheet-snapshot");
      const remoteChanged=savedSnapshot
        ? normalizedSheetRows(remoteRows)!==savedSnapshot
        : Boolean(compareSheetTransactions(list,parseSheetRows<Transaction>(remoteRows)));
      if(remoteChanged){
        const parsed=parseSheetRows<Transaction>(remoteRows);const conflict=compareSheetTransactions(list,parsed);
        if(conflict){setSheetConflict(conflict);setSheetError("Changes were found in Google Sheets. Review them before syncing.");return false}
      }
    }
    const heading=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A1:J1?valueInputOption=RAW`,{method:"PUT",headers,body:JSON.stringify({values:[transactionHeadersFor(profile.currency)]})});
    if(!heading.ok)return false;
    const cleared=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A2:Z:clear`,{method:"POST",headers});
    if(!cleared.ok)return false;
    const rows=transactionRows(list);if(!rows.length){localStorage.setItem("hisaab-sheet-snapshot",normalizedSheetRows([]));return true}
    const written=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A2:J?valueInputOption=USER_ENTERED`,{method:"PUT",headers,body:JSON.stringify({values:rows})});
    if(written.ok)localStorage.setItem("hisaab-sheet-snapshot",normalizedSheetRows(rows));
    return written.ok;
  }

  async function checkSheetChanges(){
    const token=googleToken||sessionStorage.getItem("hisaab-google-token")||"";
    if(!token||!spreadsheetId){notify("Reconnect Google Sheets to check changes");return}
    setCheckingSheet(true);setSheetError("");
    try{
      const rows=await readSheetRows(token,spreadsheetId);const parsed=parseSheetRows<Transaction>(rows);const conflict=compareSheetTransactions(transactions,parsed);
      if(conflict)setSheetConflict(conflict);else{localStorage.setItem("hisaab-sheet-snapshot",normalizedSheetRows(transactionRows(transactions)));notify("Google Sheet matches the app")}
    }catch(error){const message=error instanceof Error?error.message:"Could not check Google Sheet";setSheetError(message);notify(message)}
    finally{setCheckingSheet(false)}
  }

  async function restoreSheetFromApp(){
    setCheckingSheet(true);
    try{const ok=await syncAllTransactions(transactions,googleToken,spreadsheetId,true);if(!ok)throw new Error("Google Sheet could not be restored");setSheetConflict(null);setSheetError("");setTransactions(prev=>prev.map(t=>({...t,status:"Synced"})));notify("Google Sheet restored from the app")}
    catch(error){notify(error instanceof Error?error.message:"Could not restore Google Sheet")}
    finally{setCheckingSheet(false)}
  }

  function importSheetChanges(){
    if(!sheetConflict)return;
    const imported=sheetConflict.sheetTransactions.map(t=>({...t,status:"Synced" as const}));
    setTransactions(imported);localStorage.setItem("hisaab-sheet-snapshot",normalizedSheetRows(transactionRows(imported)));
    setSheetConflict(null);setSheetError("");notify("Google Sheet changes imported");
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
    if(data.direction==="OUT"&&data.amount>totals.balance){notify(`Not enough balance · available ${formatMoney(totals.balance)}`);return}
    const now=new Date(); const row:Transaction={id:Date.now(),amount:data.amount,description:data.description,direction:data.direction,action:data.action,date:todayKey(),time:now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),source,status:googleToken?"Pending":"Local"};
    const next=[row,...transactions];setTransactions(next);closeEntry();notify(`${formatMoney(row.amount)} recorded`);
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
  function openOpeningBalance(){
    const existing=currentOpeningBalance(transactions);
    setOpeningAmount(existing?String(existing.amount):"");
    setOpeningDate(existing?.date||todayKey());
    setOpeningOpen(true);
  }
  async function saveOpening(e:FormEvent){
    e.preventDefault();const amount=Number(openingAmount);if(!amount||!openingDate)return;
    const existing=currentOpeningBalance(transactions);const now=new Date();
    const row:Transaction={id:existing?.id||Date.now(),amount,description:"Opening balance",direction:"IN",action:"Opening balance",date:openingDate,time:existing?.time||now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),source:"Opening",status:googleToken?"Pending":"Local"};
    const next=replaceOpeningBalance(transactions,row);
    const nextBalance=next.reduce((sum,t)=>sum+(t.direction==="IN"?t.amount:-t.amount),0);
    if(nextBalance<0){notify(`Opening balance is too low · increase it by at least ${formatMoney(Math.abs(nextBalance))}`);return}
    setTransactions(next);setOpeningOpen(false);notify(existing||openingEntryCount>1?"Opening balance updated":"Opening balance saved");
    if(googleToken&&spreadsheetId){try{const ok=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>({...t,status:ok?"Synced":"Pending"})));if(!ok)notify("Saved on device · Sheets sync pending")}catch{notify("Saved on device · Sheets sync pending")}}
  }
  function openEdit(t:Transaction){if(isOpeningBalanceEntry(t)){openOpeningBalance();return}setEditTarget(t);setEditDraft({amount:String(t.amount),description:t.description,direction:t.direction,date:t.date})}
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

  function openProfileSettings(){setProfileDraft({...profile});setProfileOpen(true)}
  function saveProfileSettings(e:FormEvent){
    e.preventDefault();
    const clean={...profileDraft,walletName:profileDraft.walletName.trim(),bankName:profileDraft.walletType==="bank"?profileDraft.bankName.trim():""};
    if(!profileIsValid(clean)){notify(clean.walletType==="bank"?"Enter the bank name and account name":"Enter a wallet name");return}
    setProfile(clean);setProfileDraft(clean);setProfileOpen(false);notify("Currency and wallet updated");
    if(googleToken&&spreadsheetId)void syncAllTransactions(transactions,googleToken,spreadsheetId,true);
  }
  function advanceOnboarding(){
    if(onboardingStep===2&&!profileIsValid(profileDraft)){notify(profileDraft.walletType==="bank"?"Enter the bank name and account name":"Enter a wallet name");return}
    setOnboardingStep(step=>Math.min(3,step+1));
  }
  function completeOnboarding(){
    const clean={...profileDraft,walletName:profileDraft.walletName.trim(),bankName:profileDraft.walletType==="bank"?profileDraft.bankName.trim():"",onboardingComplete:true};
    if(!profileIsValid(clean)){setOnboardingStep(2);notify("Complete your wallet details first");return false}
    setProfile(clean);setProfileDraft(clean);setOnboardingStep(0);return true;
  }
  async function connectFromOnboarding(){if(completeOnboarding())await connectGoogle()}

  async function prepareSpreadsheet(token:string){
    let id=spreadsheetId;let createdNew=false;
    const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
    if(id){const existing=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=spreadsheetId`,{headers});if(!existing.ok){id="";localStorage.removeItem("hisaab-sheet-id");setSpreadsheetId("")}}
    if(!id){const created=await fetch("https://sheets.googleapis.com/v4/spreadsheets",{method:"POST",headers,body:JSON.stringify(cashbookSpreadsheetPayload())});if(!created.ok)throw new Error(await googleApiError(created,"Google Sheets could not create the cashbook"));const createdSheet=await created.json();id=createdSheet.spreadsheetId;if(!id)throw new Error("Google did not return a spreadsheet ID");createdNew=true;localStorage.setItem("hisaab-sheet-id",id);setSpreadsheetId(id)}
    await ensureClosingSheet(token,id);
    const synced=await syncAllTransactions(transactions,token,id,createdNew);if(!synced)throw new Error(createdNew?"Cashbook created, but transactions could not be synced":"Review Google Sheet changes before syncing");return id;
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
    if(!supabase){notify("Cloud services are not configured yet");return}
    const token=googleToken||sessionStorage.getItem("hisaab-google-token")||session?.provider_token||"";
    if(token&&sheetState!=="error"){await finishSheetConnection(token);return}
    localStorage.setItem("hisaab-sheet-connect-pending","1");setSheetState("connecting");
    const redirectTo=`${location.origin}${location.pathname}`;
    const oauthOptions={scopes:"https://www.googleapis.com/auth/spreadsheets email profile",redirectTo,queryParams:{access_type:"offline",prompt:"consent",include_granted_scopes:"true"}};
    const result=session?.user.is_anonymous
      ? await supabase.auth.linkIdentity({provider:"google",options:oauthOptions})
      : await supabase.auth.signInWithOAuth({provider:"google",options:oauthOptions});
    if(result.error){localStorage.removeItem("hisaab-sheet-connect-pending");setSheetState("error");notify(result.error.message)}
  }

  const Header=({title,back}:{title:string;back?:boolean})=><header className="screen-header">{back?<button onClick={()=>setTab("home")} aria-label="Back"><ArrowLeft/></button>:<div className="brand-mark">H</div>}<div><small>HISAAB</small><h1>{title}</h1></div><button className="header-sync" onClick={spreadsheetId&&sheetState!=="error"?()=>window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`,"_blank"):connectGoogle} aria-label="Google Sheets"><FileSpreadsheet/><i className={spreadsheetId?"online":sheetState==="error"?"error":""}/></button></header>;

  return <main className="phone-shell">
    {tab==="home"&&<section className="screen home-screen">
      <Header title="Cashbook"/>
      <div className="date-row"><span>{new Intl.DateTimeFormat("en-PK",{weekday:"long",day:"numeric",month:"long"}).format(new Date())}</span><span className="currency">{profile.currency}</span></div>
      <section className="balance-card">
        <div className="balance-label"><span>Current balance</span><button onClick={()=>setHidden(v=>!v)} aria-label={hidden?"Show balance":"Hide balance"}>{hidden?<EyeOff/>:<Eye/>}</button></div>
        <h2>{display(totals.balance)}</h2>
        <div className="today-flow"><div><span className="flow-dot in"><ArrowDownLeft/></span><p>Money in<strong>{display(totals.todayIn)}</strong></p></div><div><span className="flow-dot out"><ArrowUpRight/></span><p>Money out<strong>{display(totals.todayOut)}</strong></p></div></div>
      </section>

      {!openingEntry&&<button className="opening-prompt" onClick={openOpeningBalance}><span><Landmark/></span><div><strong>Add opening balance</strong><small>Set the cash and date you are starting with</small></div><ChevronRight/></button>}

      <div className="section-title"><div><small>QUICK ENTRY</small><h2>How do you want to record?</h2></div><Sparkles/></div>
      <div className="entry-grid">
        <button className="entry-action chat" onClick={()=>openEntry("chat")}><span><MessageCircleMore/></span><strong>Chat</strong><small>Type naturally</small></button>
        <button className="entry-action voice" onClick={()=>openEntry("voice")}><span><Mic/></span><strong>Voice</strong><small>Tap & speak</small></button>
        <button className="entry-action manual" onClick={()=>openEntry("manual")}><span><PenLine/></span><strong>Manual</strong><small>Fill details</small></button>
      </div>

      <button className={`closing-card ${todayClosing?"closed":""}`} onClick={()=>todayClosing?setTab("insights"):setClosingOpen(true)}>
        <span>{todayClosing?<CircleCheck/>:<ClipboardCheck/>}</span><div><strong>{todayClosing?"Today is closed":profile.walletType==="bank"?"Close today’s account":"Close today’s cash"}</strong><small>{todayClosing?`${todayClosing.closedAt} · ${todayClosing.difference===0?"Balance tallied":`${formatSigned(todayClosing.difference)} difference`}`:profile.walletType==="bank"?`Tally ${totals.todays.length} entries with the bank balance`:`Tally ${totals.todays.length} entries with cash in hand`}</small></div><ChevronRight/>
      </button>
      {!!transactions.length&&<div className="recent-mini"><div className="mini-head"><h3>Recent</h3><button onClick={()=>setTab("history")}>See all</button></div>{transactions.slice(0,3).map(t=><TransactionRow key={t.id} t={t} currency={profile.currency}/>)}</div>}
    </section>}

    {tab==="history"&&<section className="screen"><Header title="History" back/><div className="search-box"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search transactions"/></div><div className="history-summary"><span>{filtered.length} entries</span><strong>{formatSigned(filtered.reduce((a,t)=>a+(t.direction==="IN"?t.amount:-t.amount),0))}</strong></div><div className="history-list">{!filtered.length?<Empty icon={<History/>} title="No transactions yet" text="Your recorded entries will appear here."/>:filtered.map(t=><TransactionRow key={t.id} t={t} currency={profile.currency} showDate actions onEdit={()=>openEdit(t)} onDelete={isOpeningBalanceEntry(t)?undefined:()=>setDeleteTarget(t)}/>)}</div></section>}

    {tab==="insights"&&<section className="screen"><Header title="Insights" back/><section className="insight-hero"><small>ALL-TIME CASH FLOW</small><h2>{formatSigned(totals.balance)}</h2><div><span>Money in <strong>{formatMoney(totals.received)}</strong></span><span>Money out <strong>{formatMoney(totals.spent)}</strong></span></div></section><div className="section-title compact"><div><small>DAILY CLOSINGS</small><h2>Tally history</h2></div><CalendarDays/></div>{!closings.length?<Empty icon={<ClipboardCheck/>} title="No closing summary yet" text="Close a day to keep a record of expected and counted balance."/>:<div className="closing-list">{closings.map(c=><article key={c.date}><span className={c.difference===0?"match":"difference"}>{c.difference===0?<Check/>:<Info/>}</span><div><strong>{new Date(`${c.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"long",year:"numeric"})}</strong><small>Expected {formatMoney(c.expected)} · Counted {formatMoney(c.counted)}</small></div><b>{c.difference===0?"Tallied":formatSigned(c.difference)}</b></article>)}</div>}</section>}

    {tab==="settings"&&<section className="screen">
      <Header title="Settings" back/>
      <div className="settings-group"><small>ACCOUNT & CURRENCY</small>
        <button onClick={openProfileSettings}><span><Banknote/></span><div><strong>Currency</strong><small>{profile.currency} · Amounts shown as {currencyPrefix(profile.currency)}</small></div><ChevronRight/></button>
        <button onClick={openProfileSettings}><span>{profile.walletType==="bank"?<Landmark/>:<WalletCards/>}</span><div><strong>{profile.walletType==="bank"?profile.bankName:profile.walletName}</strong><small>{profile.walletType==="bank"?`Bank · ${profile.walletName}`:"Cash wallet"}</small></div><ChevronRight/></button>
      </div>
      <div className="settings-group"><small>CASHBOOK</small>
        <button onClick={openOpeningBalance}><span><Landmark/></span><div><strong>{openingEntry?"Edit opening balance":"Add opening balance"}</strong><small>{openingEntry?`${formatMoney(openingEntry.amount)} · ${new Date(`${openingEntry.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"short",year:"numeric"})}`:"Record starting balance and date once"}</small></div><ChevronRight/></button>
        <button onClick={()=>setClosingOpen(true)}><span><ClipboardCheck/></span><div><strong>Daily closing summary</strong><small>Count and tally today’s balance</small></div><ChevronRight/></button>
      </div>
      <div className="settings-group"><small>BACKUP & SYNC</small>
        <div className="setting-status"><span><Cloud/></span><div><strong>Cloud backup</strong><small>{cloudState==="saved"?"Private cloud copy is up to date":cloudState==="saving"?"Saving private cloud copy…":cloudState==="unavailable"?"Setup required · entries remain on this device":"Saved securely online"}</small></div><i className={cloudState==="saved"?"on":""}/></div>
        <button onClick={connectGoogle} disabled={sheetState==="connecting"}><span><FileSpreadsheet/></span><div><strong>{sheetState==="connecting"?"Creating your Google Sheet…":spreadsheetId?"Google Sheets connected":sheetState==="error"?"Reconnect Google Sheets":"Connect Google Sheets"}</strong><small>{sheetError||googleEmail||"Optional · connect now or later"}</small></div><ChevronRight/></button>
        {spreadsheetId&&<button onClick={()=>void checkSheetChanges()} disabled={checkingSheet}><span><RefreshCw/></span><div><strong>{checkingSheet?"Checking Google Sheet…":"Check Google Sheet changes"}</strong><small>Review outside edits before importing or restoring</small></div><ChevronRight/></button>}
        {spreadsheetId&&<button onClick={()=>window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`,"_blank")}><span><FileSpreadsheet/></span><div><strong>Open Hisaab AI Cashbook</strong><small>View synced entries in Google Sheets</small></div><ChevronRight/></button>}
        <div className="setting-status"><span><Sparkles/></span><div><strong>Transaction understanding</strong><small>{geminiReady?"Gemini AI is ready":"Smart offline parser active"}</small></div><i className={geminiReady?"on":""}/></div>
      </div>
      <p className="settings-note">The app is the main ledger. Google Sheet edits are never imported or overwritten without your approval.</p>
    </section>}

    <nav className="bottom-nav"><button className={tab==="home"?"active":""} onClick={()=>setTab("home")}><Home/><span>Home</span></button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}><History/><span>History</span></button><button className={tab==="insights"?"active":""} onClick={()=>setTab("insights")}><BarChart3/><span>Insights</span></button><button className={tab==="settings"?"active":""} onClick={()=>setTab("settings")}><Settings2/><span>Settings</span></button></nav>

    {entryMode&&<div className="sheet-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)closeEntry()}}><section className="entry-sheet" role="dialog" aria-modal="true"><div className="sheet-handle"/><button className="sheet-close" onClick={closeEntry} aria-label="Close"><X/></button>{entryMode==="voice"&&<><div className={`voice-orb ${listening?"listening":""}`}><Mic/></div><h2>{listening?"Listening…":"Voice entry"}</h2><p className="sheet-sub">Boliye: “500 rupay Imran se liye”</p>{input&&<div className="heard-text">“{input}”</div>} {!listening&&!candidate&&<button className="primary-button" onClick={startVoice}><Mic/> Tap to speak again</button>}</>}{entryMode==="chat"&&<><span className="sheet-icon chat"><MessageCircleMore/></span><h2>Type your transaction</h2><p className="sheet-sub">Roman Urdu or English — dono chalega</p><div className="chat-entry"><input ref={chatRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void interpretText(input)} placeholder="e.g. 2,000 chaye wale ko diye"/><button onClick={()=>void interpretText(input)} disabled={parsing}><Send/></button></div></>}{entryMode==="manual"&&<><span className="sheet-icon manual"><PenLine/></span><h2>Manual entry</h2><form className="manual-form" onSubmit={submitManual}><label>Amount ({currencyPrefix(profile.currency)})<input ref={manualRef} type="number" inputMode="decimal" value={manual.amount} onChange={e=>setManual({...manual,amount:e.target.value})} placeholder="0"/></label><label>Description<input value={manual.description} onChange={e=>setManual({...manual,description:e.target.value})} placeholder="What was this for?"/></label><div className="direction-toggle"><button type="button" className={manual.direction==="IN"?"selected in":""} onClick={()=>setManual({...manual,direction:"IN"})}><ArrowDownLeft/> Money in</button><button type="button" className={manual.direction==="OUT"?"selected out":""} onClick={()=>setManual({...manual,direction:"OUT"})}><ArrowUpRight/> Money out</button></div><button className="primary-button" type="submit">Save transaction</button></form></>}{parsing&&<p className="parsing"><Sparkles/> Understanding your transaction…</p>}{candidate&&<Confirm candidate={candidate} setCandidate={setCandidate} cancel={closeEntry} currency={profile.currency} save={()=>void addTransaction(candidate,entryMode==="voice"?"Voice":"Chat")}/>}</section></div>}

    {openingOpen&&<Modal close={()=>setOpeningOpen(false)} title={openingEntry?"Edit opening balance":"Add opening balance"} subtitle={openingEntryCount>1?"Multiple old opening entries were found. Saving will replace them with this single corrected balance.":"Set the balance and date you started this cashbook with."}><form onSubmit={saveOpening} className="single-form"><label>Opening balance ({currencyPrefix(profile.currency)})<input autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={openingAmount} onChange={e=>setOpeningAmount(e.target.value)} placeholder="0"/></label><label>Opening balance date<input type="date" max={todayKey()} value={openingDate} onChange={e=>setOpeningDate(e.target.value)} required/></label><p><Info/> The opening balance can be saved once and edited later.</p><button className="primary-button">{openingEntry?"Save opening balance changes":"Save opening balance"}</button></form></Modal>}
    {closingOpen&&<Modal close={()=>setClosingOpen(false)} title={profile.walletType==="bank"?"Close today’s account":"Close today’s cash"} subtitle={profile.walletType==="bank"?"Enter the bank balance, then compare it with Hisaab.":"Count the physical cash you have, then compare it with Hisaab."}><div className="closing-totals"><span>Opening / current balance<strong>{formatMoney(totals.balance)}</strong></span><span>Today’s entries<strong>{totals.todays.length}</strong></span></div><form onSubmit={saveClosing} className="single-form"><label>{profile.walletType==="bank"?"Bank balance":"Cash counted"} ({currencyPrefix(profile.currency)})<input autoFocus type="number" inputMode="decimal" value={countedCash} onChange={e=>setCountedCash(e.target.value)} placeholder={profile.walletType==="bank"?"Enter bank balance":"Enter physical cash"}/></label>{countedCash!==""&&<div className={`difference-preview ${Number(countedCash)-totals.balance===0?"match":""}`}><span>{Number(countedCash)-totals.balance===0?<Check/>:<Info/>}</span><div><small>DIFFERENCE</small><strong>{formatSigned(Number(countedCash)-totals.balance)}</strong></div></div>}<label>Note (optional)<input value={closingNote} onChange={e=>setClosingNote(e.target.value)} placeholder="Reason for any difference"/></label><button className="primary-button">Save closing summary</button></form></Modal>}
    {editTarget&&<Modal close={()=>setEditTarget(null)} title="Edit transaction" subtitle="Update this past entry. Your balance and Google Sheet will be recalculated."><form onSubmit={saveEdit} className="manual-form"><label>Amount ({currencyPrefix(profile.currency)})<input autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={editDraft.amount} onChange={e=>setEditDraft({...editDraft,amount:e.target.value})}/></label><label>Description<input value={editDraft.description} onChange={e=>setEditDraft({...editDraft,description:e.target.value})}/></label><label>Date<input type="date" value={editDraft.date} onChange={e=>setEditDraft({...editDraft,date:e.target.value})}/></label><div className="direction-toggle"><button type="button" className={editDraft.direction==="IN"?"selected in":""} onClick={()=>setEditDraft({...editDraft,direction:"IN"})}><ArrowDownLeft/> Money in</button><button type="button" className={editDraft.direction==="OUT"?"selected out":""} onClick={()=>setEditDraft({...editDraft,direction:"OUT"})}><ArrowUpRight/> Money out</button></div><button className="primary-button">Save changes</button></form></Modal>}
    {deleteTarget&&<Modal close={()=>setDeleteTarget(null)} title="Delete transaction?" subtitle={`${formatMoney(deleteTarget.amount)} · ${deleteTarget.description}`}><div className="delete-confirm"><p>This removes the entry from the app, private backup, and connected Google Sheet.</p><button className="danger-button" onClick={()=>void confirmDelete()}><Trash2/> Delete transaction</button><button className="secondary-button" onClick={()=>setDeleteTarget(null)}>Keep entry</button></div></Modal>}
    {profileOpen&&<Modal close={()=>setProfileOpen(false)} title="Currency & wallet" subtitle="These details control amount labels, closing language, and your Google Sheet headings."><form className="manual-form" onSubmit={saveProfileSettings}><label>Currency<select value={profileDraft.currency} onChange={e=>setProfileDraft({...profileDraft,currency:e.target.value as CashbookProfile["currency"]})}>{CURRENCY_OPTIONS.map(option=><option value={option.code} key={option.code}>{option.code} · {option.label}</option>)}</select></label><div className="direction-toggle"><button type="button" className={profileDraft.walletType==="cash"?"selected in":""} onClick={()=>setProfileDraft({...profileDraft,walletType:"cash",bankName:"",walletName:profileDraft.walletName||"Cash"})}><WalletCards/> Cash</button><button type="button" className={profileDraft.walletType==="bank"?"selected in":""} onClick={()=>setProfileDraft({...profileDraft,walletType:"bank",walletName:profileDraft.walletName==="Cash"?"Main account":profileDraft.walletName})}><Landmark/> Bank</button></div>{profileDraft.walletType==="bank"&&<label>Bank name<input value={profileDraft.bankName} onChange={e=>setProfileDraft({...profileDraft,bankName:e.target.value})} placeholder="e.g. Meezan Bank" required/></label>}<label>{profileDraft.walletType==="bank"?"Account name":"Wallet name"}<input value={profileDraft.walletName} onChange={e=>setProfileDraft({...profileDraft,walletName:e.target.value})} placeholder={profileDraft.walletType==="bank"?"e.g. Business account":"e.g. Cash"} required/></label><button className="primary-button">Save settings</button></form></Modal>}
    {sheetConflict&&<Modal close={()=>setSheetConflict(null)} title="Google Sheet changes found" subtitle="Nothing has been overwritten. Choose which version should become your cashbook."><div className="conflict-summary"><span><b>{sheetConflict.added}</b> added in Sheet</span><span><b>{sheetConflict.changed}</b> changed in Sheet</span><span><b>{sheetConflict.removed}</b> removed in Sheet</span></div><div className="delete-confirm"><button className="primary-button" onClick={importSheetChanges}><FileSpreadsheet/> Keep Google Sheet changes</button><button className="secondary-button" onClick={()=>void restoreSheetFromApp()}><RefreshCw/> Restore Sheet from app</button><p><ShieldCheck/> The running balance and negative-balance rules are validated before Sheet changes can be imported.</p></div></Modal>}
    {onboardingStep>0&&<Onboarding step={onboardingStep} profile={profileDraft} setProfile={setProfileDraft} next={advanceOnboarding} back={()=>setOnboardingStep(step=>Math.max(1,step-1))} skip={completeOnboarding} connect={()=>void connectFromOnboarding()}/>} 
    {toast&&<div className="toast" role="status"><Check/>{toast}</div>}
  </main>
}

function TransactionRow({t,currency,showDate=false,actions=false,onEdit,onDelete}:{t:Transaction;currency:CashbookProfile["currency"];showDate?:boolean;actions?:boolean;onEdit?:()=>void;onDelete?:()=>void}){return <article className={`transaction-row ${actions?"with-actions":""}`}><span className={t.direction==="IN"?"in":"out"}>{t.direction==="IN"?<ArrowDownLeft/>:<ArrowUpRight/>}</span><div><strong>{t.description}</strong><small>{showDate?`${new Date(`${t.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"short"})} · `:""}{t.time} · {t.source}</small></div><b className={t.direction==="IN"?"in":"out"}>{t.direction==="IN"?"+":"−"}{money(t.amount,currency)}</b>{actions&&<div className="row-actions"><button onClick={onEdit} aria-label={`Edit ${t.description}`}><PenLine/></button>{onDelete&&<button className="delete" onClick={onDelete} aria-label={`Delete ${t.description}`}><Trash2/></button>}</div>}</article>}
function Empty({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{text}</p></div>}
function Modal({close,title,subtitle,children}:{close:()=>void;title:string;subtitle:string;children:React.ReactNode}){return <div className="sheet-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}><section className="entry-sheet modal-sheet" role="dialog" aria-modal="true"><div className="sheet-handle"/><button className="sheet-close" onClick={close} aria-label="Close"><X/></button><h2>{title}</h2><p className="sheet-sub">{subtitle}</p>{children}</section></div>}
function Confirm({candidate,setCandidate,save,cancel,currency}:{candidate:ReturnType<typeof parseNatural>;setCandidate:(v:ReturnType<typeof parseNatural>|null)=>void;save:()=>void;cancel:()=>void;currency:CashbookProfile["currency"]}){
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(candidate);
  useEffect(()=>setDraft(candidate),[candidate]);
  if(editing)return <form className="confirm-box confirm-editor" onSubmit={e=>{e.preventDefault();if(!draft.amount||!draft.description.trim())return;setCandidate({...draft,description:draft.description.trim(),ambiguous:false});setEditing(false)}}><small>EDIT BEFORE SAVING</small><label>Amount ({currencyPrefix(currency)})<input autoFocus type="number" min="0.01" step="0.01" value={draft.amount||""} onChange={e=>setDraft({...draft,amount:Number(e.target.value)})}/></label><label>Description<input value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label><div className="direction-toggle"><button type="button" className={draft.direction==="IN"?"selected in":""} onClick={()=>setDraft({...draft,direction:"IN",action:"Received"})}>Money in</button><button type="button" className={draft.direction==="OUT"?"selected out":""} onClick={()=>setDraft({...draft,direction:"OUT",action:"Spent"})}>Money out</button></div><button className="primary-button">Apply correction</button></form>;
  return <div className="confirm-box"><small>HISAAB UNDERSTOOD</small><h3>{money(candidate.amount,currency)} · {candidate.description}</h3><p>{candidate.direction==="IN"?"Money coming in":"Money going out"}</p>{candidate.ambiguous&&<div className="confirm-directions"><button onClick={()=>setCandidate({...candidate,direction:"IN",action:"Received",ambiguous:false})}>Money in</button><button onClick={()=>setCandidate({...candidate,direction:"OUT",action:"Spent",ambiguous:false})}>Money out</button></div>}<div className="confirm-actions three"><button onClick={cancel}>Cancel</button><button onClick={()=>setEditing(true)}><PenLine/> Edit</button><button onClick={save} disabled={candidate.ambiguous}><Check/> Confirm & save</button></div></div>
}

function Onboarding({step,profile,setProfile,next,back,skip,connect}:{step:number;profile:CashbookProfile;setProfile:(value:CashbookProfile)=>void;next:()=>void;back:()=>void;skip:()=>boolean;connect:()=>void}){
  return <div className="onboarding-backdrop"><section className="onboarding-card" role="dialog" aria-modal="true"><div className="onboarding-brand">H</div><small>WELCOME TO HISAAB · {step} OF 3</small>{step===1&&<><h1>Choose your currency</h1><p>Hisaab will use clear English currency labels everywhere.</p><div className="currency-options">{CURRENCY_OPTIONS.map(option=><button key={option.code} className={profile.currency===option.code?"selected":""} onClick={()=>setProfile({...profile,currency:option.code})}><b>{option.prefix}</b><span>{option.code}<small>{option.label}</small></span>{profile.currency===option.code&&<Check/>}</button>)}</div></>}{step===2&&<><h1>Set up your wallet</h1><p>Choose whether this cashbook represents physical cash or a bank account.</p><div className="wallet-options"><button className={profile.walletType==="cash"?"selected":""} onClick={()=>setProfile({...profile,walletType:"cash",bankName:"",walletName:profile.walletName||"Cash"})}><WalletCards/><span><b>Cash</b><small>Physical cash wallet</small></span></button><button className={profile.walletType==="bank"?"selected":""} onClick={()=>setProfile({...profile,walletType:"bank",walletName:profile.walletName==="Cash"?"Main account":profile.walletName})}><Landmark/><span><b>Bank</b><small>Track a bank balance</small></span></button></div><div className="onboarding-fields">{profile.walletType==="bank"&&<label>Bank name<input value={profile.bankName} onChange={e=>setProfile({...profile,bankName:e.target.value})} placeholder="e.g. Meezan Bank"/></label>}<label>{profile.walletType==="bank"?"Account name":"Wallet name"}<input value={profile.walletName} onChange={e=>setProfile({...profile,walletName:e.target.value})} placeholder={profile.walletType==="bank"?"e.g. Business account":"e.g. Cash"}/></label></div></>}{step===3&&<><h1>Connect Google Sheets?</h1><p>This is optional. You can start now, keep a private cloud backup when available, and connect your own Sheet later from Settings.</p><div className="onboarding-sync"><FileSpreadsheet/><div><b>Hisaab AI Cashbook</b><small>Your existing entries will sync when you connect.</small></div></div><button className="primary-button" onClick={connect}><FileSpreadsheet/> Connect Google Sheets</button><button className="secondary-button" onClick={()=>skip()}>Skip for now</button></>} {step<3&&<div className="onboarding-actions">{step>1?<button className="secondary-button" onClick={back}>Back</button>:<span/>}<button className="primary-button" onClick={next}>Continue <ChevronRight/></button></div>}</section></div>
}
