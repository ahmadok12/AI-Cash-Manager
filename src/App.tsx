"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient, Session, SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowDownLeft, ArrowLeft, ArrowUpRight, BarChart3, CalendarDays, Check,
  ChevronRight, CircleCheck, ClipboardCheck, Eye, EyeOff, FileSpreadsheet,
  History, Home, Info, Landmark, MessageCircleMore, Mic, PenLine, Search,
  Send, Settings2, Sparkles, Trash2, X,
  Banknote, Cloud, RefreshCw, ShieldCheck, WalletCards,
  ArrowRightLeft, Plus, Archive, PiggyBank, UsersRound, Target, HandCoins,
  Download, Share2, CalendarClock,
} from "lucide-react";
import { parseSpokenAmount, stripSpokenAmount } from "../supabase/functions/_shared/spoken-amount";
import { canDeleteTransaction } from "./ledger";
import { cashbookSpreadsheetPayload, sheetProperties, transactionHeadersFor, transactionRows } from "./google-sheets";
import { currentOpeningBalance, isOpeningBalanceEntry, openingBalanceEntries, replaceOpeningBalance } from "./opening-balance";
import { loadCloudCashbook, saveCloudCashbook } from "./cloud-backup";
import { compareSheetTransactions, parseSheetRows, SheetConflictSummary } from "./sheet-conflicts";
import { activeWallet, CashbookProfile, CURRENCY_OPTIONS, currencyPrefix, DEFAULT_PROFILE, normalizeProfile, profileIsValid, Wallet, walletIsValid, withActiveWallet } from "./profile";
import { migrateWalletTransactions, totalBalance, transferEntries, uniqueWalletName, walletBalance, walletLabel, walletTransactions } from "./wallets";
import { detectMentionedWallet, detectWalletTransfer } from "./voice-transfer";
import { goalProgress, goalSaved, installmentSchedule, ledgerOutstanding, ledgerPrincipal, ledgerReceived, normalizePlanningState, PersonLedger, PersonLedgerEntry, savingsWalletDirection, SavingsEntry, SavingsGoal } from "./planning";
import { createLedgerPdf, ledgerPdfFile } from "./ledger-pdf";
import { cashReportCsv, createCashReportPdf } from "./cash-report-pdf";

type Direction = "IN" | "OUT";
type Source = "Voice" | "Chat" | "Manual" | "Opening" | "Transfer" | "Savings";
type Transaction = { id:number; amount:number; description:string; direction:Direction; action:string; date:string; time:string; source:Source; status:"Synced"|"Pending"|"Local"; walletId:string; transferId?:string; ledgerEntryId?:string; savingsEntryId?:string };
type Closing = { date:string; expected:number; counted:number; difference:number; note:string; closedAt:string; walletId:string };
type Tab = "home" | "history" | "plans" | "insights" | "settings";
type EntryMode = "voice" | "chat" | "manual" | null;
type SheetState = "disconnected" | "connecting" | "connected" | "error";
type CloudState = "device" | "saving" | "saved" | "unavailable";
type ParsedCandidate = ReturnType<typeof parseNatural> & { walletId?:string; walletRequired?:boolean; transfer?: { fromWalletId:string; toWalletId:string; fromLabel:string; toLabel:string } };

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
  const [manual,setManual]=useState({amount:"",description:"",direction:"OUT" as Direction,walletId:""});
  const [candidate,setCandidate]=useState<ParsedCandidate|null>(null);
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
  const [editDraft,setEditDraft]=useState({amount:"",description:"",direction:"OUT" as Direction,date:todayKey(),walletId:""});
  const [deleteTarget,setDeleteTarget]=useState<Transaction|null>(null);
  const [profile,setProfile]=useState<CashbookProfile>({...DEFAULT_PROFILE});
  const [profileDraft,setProfileDraft]=useState<CashbookProfile>({...DEFAULT_PROFILE});
  const [profileOpen,setProfileOpen]=useState(false);
  const [walletOpen,setWalletOpen]=useState(false);
  const [walletDraft,setWalletDraft]=useState<Wallet>({id:"",type:"cash",name:"",bankName:""});
  const [transferOpen,setTransferOpen]=useState(false);
  const [transferDraft,setTransferDraft]=useState({fromWalletId:"",toWalletId:"",amount:"",note:""});
  const [onboardingStep,setOnboardingStep]=useState(0);
  const [cloudState,setCloudState]=useState<CloudState>("device");
  const [cloudReadyUser,setCloudReadyUser]=useState("");
  const [sheetConflict,setSheetConflict]=useState<SheetConflictSummary<Transaction>|null>(null);
  const [checkingSheet,setCheckingSheet]=useState(false);
  const [goals,setGoals]=useState<SavingsGoal[]>([]);
  const [savingsEntries,setSavingsEntries]=useState<SavingsEntry[]>([]);
  const [peopleLedgers,setPeopleLedgers]=useState<PersonLedger[]>([]);
  const [ledgerEntries,setLedgerEntries]=useState<PersonLedgerEntry[]>([]);
  const [planView,setPlanView]=useState<"goals"|"people">("goals");
  const [goalOpen,setGoalOpen]=useState(false);
  const [goalEntryTarget,setGoalEntryTarget]=useState<SavingsGoal|null>(null);
  const [goalDraft,setGoalDraft]=useState({name:"",targetAmount:"",targetDate:"",note:""});
  const [goalEntryDraft,setGoalEntryDraft]=useState({amount:"",direction:"ADD" as SavingsEntry["direction"],date:todayKey(),walletId:"",note:""});
  const [goalEditTarget,setGoalEditTarget]=useState<SavingsGoal|null>(null);
  const [selectedGoal,setSelectedGoal]=useState<SavingsGoal|null>(null);
  const [savingEditTarget,setSavingEditTarget]=useState<SavingsEntry|null>(null);
  const [ledgerOpen,setLedgerOpen]=useState(false);
  const [selectedLedger,setSelectedLedger]=useState<PersonLedger|null>(null);
  const [ledgerDraft,setLedgerDraft]=useState({personName:"",relation:"",mode:"TARGET" as PersonLedger["mode"],openingReceivable:"",installmentAmount:"",firstDueDate:"",note:""});
  const [ledgerEntryOpen,setLedgerEntryOpen]=useState(false);
  const [ledgerEntryDraft,setLedgerEntryDraft]=useState({kind:"RECEIVED" as PersonLedgerEntry["kind"],amount:"",date:todayKey(),walletId:"",note:""});
  const [ledgerEditTarget,setLedgerEditTarget]=useState<PersonLedger|null>(null);
  const [ledgerEntryEditTarget,setLedgerEntryEditTarget]=useState<PersonLedgerEntry|null>(null);
  const [reportDates,setReportDates]=useState({from:`${todayKey().slice(0,7)}-01`,to:todayKey()});
  const [khaataDates,setKhaataDates]=useState({from:"",to:todayKey()});
  const chatRef=useRef<HTMLInputElement>(null);
  const manualRef=useRef<HTMLInputElement>(null);
  const sheetConnectInFlight=useRef(false);
  const cloudLoadedForUser=useRef("");
  const cloudSaveTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(()=>{
    const saved=localStorage.getItem("ai-cash-v1"); const rawTransactions=saved?JSON.parse(saved):[];
    const savedProfile=localStorage.getItem("hisaab-profile-v2");
    let nextProfile=savedProfile?normalizeProfile(JSON.parse(savedProfile)):normalizeProfile(DEFAULT_PROFILE);
    if(!savedProfile&&rawTransactions.length)nextProfile={...nextProfile,onboardingComplete:true};
    const migratedTransactions=migrateWalletTransactions<Transaction>(rawTransactions,nextProfile.activeWalletId);
    setTransactions(migratedTransactions);
    const savedClosings=localStorage.getItem("hisaab-closings");
    if(savedClosings)setClosings((JSON.parse(savedClosings) as Array<Partial<Closing>>).map(c=>({...c,walletId:c.walletId||nextProfile.activeWalletId}) as Closing));
    setProfile(nextProfile);setProfileDraft(nextProfile);
    const planning=normalizePlanningState(JSON.parse(localStorage.getItem("hisaab-planning-v1")||"{}"));
    setGoals(planning.goals);setSavingsEntries(planning.savingsEntries);setPeopleLedgers(planning.peopleLedgers);setLedgerEntries(planning.ledgerEntries);
    if(!nextProfile.onboardingComplete)setOnboardingStep(1);
    if(!savedProfile&&rawTransactions.length)localStorage.setItem("hisaab-profile-v2",JSON.stringify(nextProfile));
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
  useEffect(()=>{if(hydrated)localStorage.setItem("hisaab-planning-v1",JSON.stringify({goals,savingsEntries,peopleLedgers,ledgerEntries}))},[goals,savingsEntries,peopleLedgers,ledgerEntries,hydrated]);
  useEffect(()=>{
    if(!hydrated||!supabase||!session||cloudLoadedForUser.current===session.user.id)return;
    cloudLoadedForUser.current=session.user.id;
    void loadCloudCashbook<Transaction,Closing>(supabase).then(remote=>{
      if(remote&&transactions.length===0&&closings.length===0){
        const restored=remote.profile?normalizeProfile(remote.profile):normalizeProfile(DEFAULT_PROFILE);
        setTransactions(migrateWalletTransactions<Transaction>(remote.transactions||[],restored.activeWalletId));
        setClosings((remote.closings||[]).map(c=>({...c,walletId:c.walletId||restored.activeWalletId})));
        if(remote.profile){setProfile(restored);setProfileDraft(restored);setOnboardingStep(restored.onboardingComplete?0:1)}
        const planning=normalizePlanningState(remote.planning);setGoals(planning.goals);setSavingsEntries(planning.savingsEntries);setPeopleLedgers(planning.peopleLedgers);setLedgerEntries(planning.ledgerEntries);
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
      void saveCloudCashbook(supabase,session.user.id,{transactions,closings,profile,spreadsheetId,planning:{goals,savingsEntries,peopleLedgers,ledgerEntries}})
        .then(()=>setCloudState("saved")).catch(()=>setCloudState("unavailable"));
    },700);
    return()=>{if(cloudSaveTimer.current)clearTimeout(cloudSaveTimer.current)};
  },[transactions,closings,profile,spreadsheetId,goals,savingsEntries,peopleLedgers,ledgerEntries,hydrated,supabase,session,cloudReadyUser]);
  useEffect(()=>{
    if(!hydrated)return;
    const token=googleToken||sessionStorage.getItem("hisaab-google-token")||"";
    if(token&&!googleToken)setGoogleToken(token);
    if(token&&(!spreadsheetId||localStorage.getItem("hisaab-sheet-connect-pending")==="1"))void finishSheetConnection(token);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[hydrated,googleToken]);

  const selectedWallet=activeWallet(profile);
  const availableWallets=profile.wallets.filter(wallet=>!wallet.archived);
  const selectedTransactions=walletTransactions(transactions,selectedWallet.id);
  const walletNames=Object.fromEntries(profile.wallets.map(wallet=>[wallet.id,walletLabel(wallet)]));
  const walletIdsByLabel=Object.fromEntries(profile.wallets.map(wallet=>[walletLabel(wallet).toLocaleLowerCase(),wallet.id]));
  const totals=useMemo(()=>{
    const received=selectedTransactions.filter(t=>t.direction==="IN").reduce((a,t)=>a+t.amount,0);
    const spent=selectedTransactions.filter(t=>t.direction==="OUT").reduce((a,t)=>a+t.amount,0);
    const todays=selectedTransactions.filter(t=>t.date===todayKey());
    const todayIn=todays.filter(t=>t.direction==="IN").reduce((a,t)=>a+t.amount,0);
    const todayOut=todays.filter(t=>t.direction==="OUT").reduce((a,t)=>a+t.amount,0);
    return {received,spent,balance:received-spent,todayIn,todayOut,todays};
  },[selectedTransactions]);
  const todayClosing=closings.find(c=>c.date===todayKey()&&c.walletId===selectedWallet.id);
  const openingEntry=currentOpeningBalance(transactions,selectedWallet.id);
  const openingEntryCount=openingBalanceEntries(transactions,selectedWallet.id).length;
  const filtered=transactions.filter(t=>t.description.toLowerCase().includes(query.toLowerCase())&&(!reportDates.from||t.date>=reportDates.from)&&(!reportDates.to||t.date<=reportDates.to));
  const formatMoney=(value:number)=>money(value,profile.currency);
  const formatSigned=(value:number)=>signedMoney(value,profile.currency);
  const display=(value:number)=>hidden?`${currencyPrefix(profile.currency)} •••••`:formatMoney(value);
  const activeGoals=goals.filter(goal=>!goal.archived);
  const activePeopleLedgers=peopleLedgers.filter(ledger=>!ledger.archived);
  const totalSaved=activeGoals.reduce((sum,goal)=>sum+goalSaved(savingsEntries,goal.id),0);
  const totalReceivable=activePeopleLedgers.reduce((sum,ledger)=>sum+Math.max(0,ledgerOutstanding(ledger,ledgerEntries)),0);

  function notify(message:string){setToast(message);setTimeout(()=>setToast(""),2600)}
  function closeEntry(){setEntryMode(null);setCandidate(null);setInput("");setListening(false)}
  function openEntry(mode:Exclude<EntryMode,null>){
    setTab("home");setEntryMode(mode);setCandidate(null);
    if(mode==="manual")setManual(current=>({...current,walletId:selectedWallet.id}));
    setTimeout(()=>{if(mode==="voice")startVoice();if(mode==="chat")chatRef.current?.focus();if(mode==="manual")manualRef.current?.focus()},120);
  }

  const normalizedSheetRows=(rows:unknown[][])=>JSON.stringify(rows.map(row=>row.map(cell=>String(cell??""))));
  const rowsForSheet=(list:Transaction[])=>transactionRows(list.map(t=>({...t,walletName:walletNames[t.walletId]||"Archived wallet"})));
  async function readSheetRows(token:string,sheetId:string){
    const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A2:K`,{headers:{Authorization:`Bearer ${token}`}});
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
        : Boolean(compareSheetTransactions(list,parseSheetRows<Transaction>(remoteRows,walletIdsByLabel)));
      if(remoteChanged){
        const parsed=parseSheetRows<Transaction>(remoteRows,walletIdsByLabel);const conflict=compareSheetTransactions(list,parsed);
        if(conflict){setSheetConflict(conflict);setSheetError("Changes were found in Google Sheets. Review them before syncing.");return false}
      }
    }
    const heading=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A1:K1?valueInputOption=RAW`,{method:"PUT",headers,body:JSON.stringify({values:[transactionHeadersFor(profile.currency)]})});
    if(!heading.ok)return false;
    const cleared=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A2:Z:clear`,{method:"POST",headers});
    if(!cleared.ok)return false;
    const rows=rowsForSheet(list);if(!rows.length){localStorage.setItem("hisaab-sheet-snapshot",normalizedSheetRows([]));return true}
    const written=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Transactions!A2:K?valueInputOption=USER_ENTERED`,{method:"PUT",headers,body:JSON.stringify({values:rows})});
    if(written.ok)localStorage.setItem("hisaab-sheet-snapshot",normalizedSheetRows(rows));
    return written.ok;
  }

  async function checkSheetChanges(){
    const token=googleToken||sessionStorage.getItem("hisaab-google-token")||"";
    if(!token||!spreadsheetId){notify("Reconnect Google Sheets to check changes");return}
    setCheckingSheet(true);setSheetError("");
    try{
      const rows=await readSheetRows(token,spreadsheetId);const parsed=parseSheetRows<Transaction>(rows,walletIdsByLabel);const conflict=compareSheetTransactions(transactions,parsed);
      if(conflict)setSheetConflict(conflict);else{localStorage.setItem("hisaab-sheet-snapshot",normalizedSheetRows(rowsForSheet(transactions)));notify("Google Sheet matches the app")}
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
    const imported=sheetConflict.sheetTransactions.map(t=>({...t,status:"Synced" as const,ledgerEntryId:ledgerEntries.find(entry=>entry.transactionId===t.id)?.id,savingsEntryId:savingsEntries.find(entry=>entry.transactionId===t.id)?.id}));
    setTransactions(imported);localStorage.setItem("hisaab-sheet-snapshot",normalizedSheetRows(rowsForSheet(imported)));
    setSheetConflict(null);setSheetError("");notify("Google Sheet changes imported");
  }
  async function ensureClosingSheet(token:string,sheetId:string){
    const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
    const meta=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,{headers});if(!meta.ok)throw new Error(await googleApiError(meta,"Google could not read the cashbook"));
    const titles=((await meta.json()).sheets||[]).map((s:{properties:{title:string}})=>s.properties.title);
    if(!titles.includes("Daily Closings")){const added=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,{method:"POST",headers,body:JSON.stringify({requests:[{addSheet:{properties:sheetProperties("Daily Closings")}}]})});if(!added.ok)throw new Error(await googleApiError(added,"Google could not add the closing sheet"))}
    const heading=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'Daily Closings'!A1:H1?valueInputOption=RAW`,{method:"PUT",headers,body:JSON.stringify({values:[["Date","Wallet","Closed at","Expected balance","Counted balance","Difference","Entries","Note"]]})});if(!heading.ok)throw new Error(await googleApiError(heading,"Google could not prepare the closing sheet"));return true;
  }
  async function appendClosingToSheet(c:Closing){if(!googleToken||!spreadsheetId)return;await ensureClosingSheet(googleToken,spreadsheetId);await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'Daily Closings'!A:H:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,{method:"POST",headers:{Authorization:`Bearer ${googleToken}`,"Content-Type":"application/json"},body:JSON.stringify({values:[[c.date,walletNames[c.walletId]||"Wallet",c.closedAt,c.expected,c.counted,c.difference,totals.todays.length,c.note]]})})}
  async function addTransaction(data:ParsedCandidate,source:Source){
    const walletId=data.walletId||selectedWallet.id;const targetWallet=profile.wallets.find(wallet=>wallet.id===walletId&&!wallet.archived);
    if(!targetWallet){notify("Choose a wallet");return}
    const available=walletBalance(transactions,targetWallet.id);
    if(data.direction==="OUT"&&data.amount>available){notify(`Not enough balance · available ${formatMoney(available)}`);return}
    const now=new Date(); const row:Transaction={id:Date.now(),amount:data.amount,description:data.description,direction:data.direction,action:data.action,date:todayKey(),time:now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),source,status:googleToken?"Pending":"Local",walletId:targetWallet.id};
    const next=[row,...transactions];setTransactions(next);closeEntry();notify(`${formatMoney(row.amount)} recorded`);
    if(googleToken&&spreadsheetId){try{const synced=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>t.id===row.id?{...t,status:synced?"Synced":"Pending"}:t));if(!synced)notify("Saved on device · Sheets sync pending")}catch{notify("Saved on device · reconnect Sheets to sync")}}
  }
  function markWalletTransfer(value:string,data:ReturnType<typeof parseNatural>):ParsedCandidate{
    const detected=detectWalletTransfer(value,availableWallets,selectedWallet.id);
    if(!detected){
      const mentioned=detectMentionedWallet(value,availableWallets);
      const walletRequired=data.direction==="OUT"&&availableWallets.length>1&&!mentioned;
      return {...data,walletId:mentioned?.id||(walletRequired?"":selectedWallet.id),walletRequired};
    }
    const from=profile.wallets.find(wallet=>wallet.id===detected.fromWalletId)!;
    const to=profile.wallets.find(wallet=>wallet.id===detected.toWalletId)!;
    return {...data,direction:"OUT",action:"Transfer",ambiguous:false,description:`Transfer from ${walletLabel(from)} to ${walletLabel(to)}`,transfer:{...detected,fromLabel:walletLabel(from),toLabel:walletLabel(to)}};
  }
  async function addDetectedTransfer(data:ParsedCandidate){
    if(!data.transfer)return;
    const from=profile.wallets.find(w=>w.id===data.transfer!.fromWalletId);const to=profile.wallets.find(w=>w.id===data.transfer!.toWalletId);
    if(!from||!to||from.id===to.id||!data.amount)return;
    const available=walletBalance(transactions,from.id);if(data.amount>available){notify(`Not enough balance · available ${formatMoney(available)}`);return}
    const now=new Date();const base=Date.now();const transferId=`transfer-${base}`;const time=now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
    const outgoing:Transaction={id:base,amount:data.amount,description:`Transfer to ${walletLabel(to)}`,direction:"OUT",action:"Transfer out",date:todayKey(),time,source:"Transfer",status:googleToken?"Pending":"Local",walletId:from.id,transferId};
    const incoming:Transaction={...outgoing,id:base+1,description:`Transfer from ${walletLabel(from)}`,direction:"IN",action:"Transfer in",walletId:to.id};
    const next=[incoming,outgoing,...transactions];setTransactions(next);closeEntry();notify(`${formatMoney(data.amount)} transferred`);
    if(googleToken&&spreadsheetId){try{const ok=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>t.transferId===transferId?{...t,status:ok?"Synced":"Pending"}:t))}catch{notify("Transfer saved · Sheets sync pending")}}
  }
  async function interpretText(value:string){
    if(!value.trim())return;setParsing(true);
    if(geminiReady&&supabase&&session&&navigator.onLine){try{const {data,error}=await supabase.functions.invoke("parse-transaction",{body:{text:value}});if(!error&&data){const spoken=parseSpokenAmount(value);setCandidate(markWalletTransfer(value,{...data,amount:spoken||data.amount}));setParsing(false);return}}catch{}}
    setCandidate(markWalletTransfer(value,parseNatural(value)));setParsing(false);
  }
  function startVoice(){
    const Recognition=(window as unknown as {webkitSpeechRecognition?:new()=>{lang:string;interimResults:boolean;start:()=>void;onresult:(e:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void;onend:()=>void}}).webkitSpeechRecognition;
    if(!Recognition){notify("Voice input works in supported Chrome browsers");setEntryMode(null);return}
    const r=new Recognition();r.lang="en-PK";r.interimResults=false;r.onresult=e=>{const text=e.results[0][0].transcript;setInput(text);void interpretText(text)};r.onend=()=>setListening(false);setListening(true);r.start();
  }
  function submitManual(e:FormEvent){e.preventDefault();const amount=Number(manual.amount);if(!amount||!manual.description.trim()||!manual.walletId){notify("Choose a wallet");return}void addTransaction({amount,description:manual.description,direction:manual.direction,action:manual.direction==="IN"?"Received":"Spent",ambiguous:false,walletId:manual.walletId},"Manual");setManual({amount:"",description:"",direction:"OUT",walletId:selectedWallet.id})}
  function openOpeningBalance(){
    const existing=currentOpeningBalance(transactions,selectedWallet.id);
    setOpeningAmount(existing?String(existing.amount):"");
    setOpeningDate(existing?.date||todayKey());
    setOpeningOpen(true);
  }
  async function saveOpening(e:FormEvent){
    e.preventDefault();const amount=Number(openingAmount);if(!amount||!openingDate)return;
    const existing=currentOpeningBalance(transactions,selectedWallet.id);const now=new Date();
    const row:Transaction={id:existing?.id||Date.now(),amount,description:"Opening balance",direction:"IN",action:"Opening balance",date:openingDate,time:existing?.time||now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),source:"Opening",status:googleToken?"Pending":"Local",walletId:selectedWallet.id};
    const next=replaceOpeningBalance(transactions,row,selectedWallet.id);
    const nextBalance=walletBalance(next,selectedWallet.id);
    if(nextBalance<0){notify(`Opening balance is too low · increase it by at least ${formatMoney(Math.abs(nextBalance))}`);return}
    setTransactions(next);setOpeningOpen(false);notify(existing||openingEntryCount>1?"Opening balance updated":"Opening balance saved");
    if(googleToken&&spreadsheetId){try{const ok=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>({...t,status:ok?"Synced":"Pending"})));if(!ok)notify("Saved on device · Sheets sync pending")}catch{notify("Saved on device · Sheets sync pending")}}
  }
  function openEdit(t:Transaction){if(t.transferId){notify("Edit a transfer by deleting it and recording it again");return}if(t.savingsEntryId){const entry=savingsEntries.find(item=>item.id===t.savingsEntryId);const goal=entry&&goals.find(item=>item.id===entry.goalId);if(entry&&goal)openGoalEntry(goal,entry.direction,entry);return}if(t.ledgerEntryId){const entry=ledgerEntries.find(item=>item.id===t.ledgerEntryId);const ledger=entry&&peopleLedgers.find(item=>item.id===entry.ledgerId);if(entry&&ledger)openPersonEntry(ledger,entry.kind,entry);return}if(isOpeningBalanceEntry(t)){const nextProfile=withActiveWallet(profile,t.walletId);setProfile(nextProfile);setProfileDraft(nextProfile);setOpeningAmount(String(t.amount));setOpeningDate(t.date);setOpeningOpen(true);return}setEditTarget(t);setEditDraft({amount:String(t.amount),description:t.description,direction:t.direction,date:t.date,walletId:t.walletId})}
  async function saveEdit(e:FormEvent){
    e.preventDefault();if(!editTarget)return;const amount=Number(editDraft.amount);if(!amount||!editDraft.description.trim())return;
    const next:Transaction[]=transactions.map(t=>t.id===editTarget.id?{...t,amount,description:editDraft.description.trim(),direction:editDraft.direction,action:editDraft.direction==="IN"?"Received":"Spent",date:editDraft.date,walletId:editDraft.walletId,status:googleToken?"Pending":"Local"}:t);
    const affectedWallets=new Set([editTarget.walletId,editDraft.walletId]);
    const invalid=[...affectedWallets].some(walletId=>{
      const before=walletBalance(transactions,walletId);const after=walletBalance(next,walletId);
      return after<0&&after<before;
    });
    if(invalid){notify(`This edit would exceed the available balance`);return}
    setTransactions(next);setEditTarget(null);notify("Transaction updated");
    if(googleToken&&spreadsheetId){try{const ok=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>({...t,status:ok?"Synced":"Pending"})));if(!ok)notify("Updated on device · Sheets sync pending")}catch{notify("Updated on device · Sheets sync pending")}}
  }
  async function confirmDelete(){
    if(!deleteTarget)return;const deleting=deleteTarget.transferId?transferEntries(transactions,deleteTarget.transferId):[deleteTarget];const deletingIds=new Set(deleting.map(t=>t.id));const next=transactions.filter(t=>!deletingIds.has(t.id));
    const affectedWallets=new Set(deleting.map(t=>t.walletId));const invalid=[...affectedWallets].some(walletId=>{const before=walletBalance(transactions,walletId);const after=walletBalance(next,walletId);return after<0&&after<before});
    if(invalid||(!deleteTarget.transferId&&!canDeleteTransaction(walletTransactions(transactions,deleteTarget.walletId),deleteTarget))){notify("Cannot delete this entry because a wallet balance would become negative");return}
    setTransactions(next);if(deleteTarget.ledgerEntryId)setLedgerEntries(prev=>prev.filter(entry=>entry.id!==deleteTarget.ledgerEntryId));if(deleteTarget.savingsEntryId)setSavingsEntries(prev=>prev.filter(entry=>entry.id!==deleteTarget.savingsEntryId));setDeleteTarget(null);notify(deleteTarget.ledgerEntryId?"Wallet and Khaata entry deleted":deleteTarget.savingsEntryId?"Wallet and savings entry deleted":"Transaction deleted");
    if(googleToken&&spreadsheetId){try{const ok=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>({...t,status:ok?"Synced":"Pending"})));if(!ok)notify("Deleted on device · Sheets sync pending")}catch{notify("Deleted on device · Sheets sync pending")}}
  }
  async function saveClosing(e:FormEvent){e.preventDefault();const counted=Number(countedCash);if(countedCash==="")return;const closing:Closing={date:todayKey(),expected:totals.balance,counted,difference:counted-totals.balance,note:closingNote,closedAt:new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),walletId:selectedWallet.id};setClosings(prev=>[closing,...prev.filter(c=>!(c.date===closing.date&&c.walletId===closing.walletId))]);setClosingOpen(false);setCountedCash("");setClosingNote("");try{await appendClosingToSheet(closing)}catch{}notify(closing.difference===0?"Wallet closed · balance tallied":"Wallet closed · difference recorded")}

  function selectWallet(walletId:string){const next=withActiveWallet(profile,walletId);setProfile(next);setProfileDraft(next)}
  function openNewWallet(){setWalletDraft({id:"",type:"cash",name:"",bankName:""});setWalletOpen(true)}
  function openWalletEdit(wallet:Wallet){setWalletDraft({...wallet});setWalletOpen(true)}
  function saveWallet(e:FormEvent){
    e.preventDefault();const clean={...walletDraft,name:walletDraft.name.trim(),bankName:walletDraft.type==="bank"?walletDraft.bankName.trim():""};
    if(!walletIsValid(clean)){notify(clean.type==="bank"?"Enter the bank and account names":"Enter a wallet name");return}
    if(!uniqueWalletName(profile.wallets,clean.name,clean.id)){notify("Use a different wallet name");return}
    const id=clean.id||`wallet-${Date.now()}`;const existing=profile.wallets.find(w=>w.id===id);
    const wallets=existing?profile.wallets.map(w=>w.id===id?{...clean,id}:w):[...profile.wallets,{...clean,id}];
    const next=withActiveWallet({...profile,wallets},id);setProfile(next);setProfileDraft(next);setWalletOpen(false);notify(existing?"Wallet updated":"Wallet added");
    if(googleToken&&spreadsheetId)void syncAllTransactions(transactions,googleToken,spreadsheetId,true);
  }
  function archiveWallet(wallet:Wallet){
    if(availableWallets.length<=1){notify("Keep at least one active wallet");return}
    if(walletBalance(transactions,wallet.id)!==0){notify("A wallet can only be archived when its balance is zero");return}
    const wallets=profile.wallets.map(item=>item.id===wallet.id?{...item,archived:true}:item);const next=withActiveWallet({...profile,wallets},availableWallets.find(item=>item.id!==wallet.id)?.id||"");setProfile(next);setProfileDraft(next);notify("Wallet archived");
  }
  function openTransfer(){
    if(availableWallets.length<2){notify("Add another wallet before making a transfer");return}
    setTransferDraft({fromWalletId:selectedWallet.id,toWalletId:availableWallets.find(w=>w.id!==selectedWallet.id)?.id||"",amount:"",note:""});setTransferOpen(true);
  }
  async function saveTransfer(e:FormEvent){
    e.preventDefault();const amount=Number(transferDraft.amount);const from=profile.wallets.find(w=>w.id===transferDraft.fromWalletId);const to=profile.wallets.find(w=>w.id===transferDraft.toWalletId);
    if(!from||!to||from.id===to.id||!amount)return;
    const available=walletBalance(transactions,from.id);if(amount>available){notify(`Not enough balance · available ${formatMoney(available)}`);return}
    const now=new Date();const base=Date.now();const transferId=`transfer-${base}`;const time=now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});const note=transferDraft.note.trim();
    const outgoing:Transaction={id:base,amount,description:note||`Transfer to ${walletLabel(to)}`,direction:"OUT",action:"Transfer out",date:todayKey(),time,source:"Transfer",status:googleToken?"Pending":"Local",walletId:from.id,transferId};
    const incoming:Transaction={...outgoing,id:base+1,description:note||`Transfer from ${walletLabel(from)}`,direction:"IN",action:"Transfer in",walletId:to.id};
    const next=[incoming,outgoing,...transactions];setTransactions(next);setTransferOpen(false);notify(`${formatMoney(amount)} transferred`);
    if(googleToken&&spreadsheetId){try{const ok=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>t.transferId===transferId?{...t,status:ok?"Synced":"Pending"}:t))}catch{notify("Transfer saved · Sheets sync pending")}}
  }

  function openNewGoal(){setGoalEditTarget(null);setGoalDraft({name:"",targetAmount:"",targetDate:"",note:""});setGoalOpen(true)}
  function openGoalEdit(goal:SavingsGoal){setGoalEditTarget(goal);setGoalDraft({name:goal.name,targetAmount:String(goal.targetAmount),targetDate:goal.targetDate||"",note:goal.note||""});setGoalOpen(true)}
  function saveGoal(e:FormEvent){
    e.preventDefault();const targetAmount=Number(goalDraft.targetAmount);if(!goalDraft.name.trim()||!targetAmount)return;
    if(goalEditTarget){setGoals(prev=>prev.map(goal=>goal.id===goalEditTarget.id?{...goal,name:goalDraft.name.trim(),targetAmount,targetDate:goalDraft.targetDate||undefined,note:goalDraft.note.trim()||undefined}:goal));setGoalOpen(false);setGoalEditTarget(null);notify("Savings goal updated");return}
    const goal:SavingsGoal={id:`goal-${Date.now()}`,name:goalDraft.name.trim(),targetAmount,targetDate:goalDraft.targetDate||undefined,note:goalDraft.note.trim()||undefined,createdAt:new Date().toISOString()};setGoals(prev=>[goal,...prev]);setGoalOpen(false);notify("Savings goal created");
  }
  function openGoalEntry(goal:SavingsGoal,direction:SavingsEntry["direction"]="ADD",entry?:SavingsEntry){
    setGoalEntryTarget(goal);setSavingEditTarget(entry||null);setGoalEntryDraft({amount:entry?String(entry.amount):"",direction:entry?.direction||direction,date:entry?.date||todayKey(),walletId:entry?.walletId||selectedWallet.id,note:entry?.note||""});
  }
  async function saveGoalEntry(e:FormEvent){
    e.preventDefault();if(!goalEntryTarget)return;const amount=Number(goalEntryDraft.amount);const wallet=profile.wallets.find(item=>item.id===goalEntryDraft.walletId&&!item.archived);if(!amount||!wallet){notify("Enter an amount and choose a wallet");return}
    const baseEntries=savingEditTarget?savingsEntries.filter(entry=>entry.id!==savingEditTarget.id):savingsEntries;const savedBefore=goalSaved(baseEntries,goalEntryTarget.id);
    if(goalEntryDraft.direction==="WITHDRAW"&&amount>savedBefore){notify(`You can withdraw up to ${formatMoney(savedBefore)} from this goal`);return}
    const baseTransactions=savingEditTarget?.transactionId?transactions.filter(t=>t.id!==savingEditTarget.transactionId):transactions;const direction:Direction=savingsWalletDirection(goalEntryDraft.direction);
    if(direction==="OUT"&&amount>walletBalance(baseTransactions,wallet.id)){notify(`Not enough balance in ${wallet.name} · available ${formatMoney(walletBalance(baseTransactions,wallet.id))}`);return}
    const entryId=savingEditTarget?.id||`saving-${Date.now()}`;const transactionId=savingEditTarget?.transactionId||Date.now();const note=goalEntryDraft.note.trim();
    const entry:SavingsEntry={id:entryId,goalId:goalEntryTarget.id,amount,direction:goalEntryDraft.direction,date:goalEntryDraft.date,walletId:wallet.id,transactionId,note:note||undefined};
    const transaction:Transaction={id:transactionId,amount,description:note||(direction==="OUT"?`Saved for ${goalEntryTarget.name}`:`Withdrawn from ${goalEntryTarget.name}`),direction,action:direction==="OUT"?"Saved":"Savings withdrawn",date:goalEntryDraft.date,time:new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),source:"Savings",status:googleToken?"Pending":"Local",walletId:wallet.id,savingsEntryId:entryId};
    const nextTransactions=[transaction,...baseTransactions];setTransactions(nextTransactions);setSavingsEntries([entry,...baseEntries]);setGoalEntryTarget(null);setSavingEditTarget(null);notify(direction==="OUT"?"Saving deducted from wallet":"Withdrawal added to wallet");
    if(googleToken&&spreadsheetId){try{const ok=await syncAllTransactions(nextTransactions);setTransactions(prev=>prev.map(t=>t.id===transactionId?{...t,status:ok?"Synced":"Pending"}:t))}catch{notify("Saved · Sheets sync pending")}}
  }

  function openNewLedger(){setLedgerEditTarget(null);setLedgerDraft({personName:"",relation:"",mode:"TARGET",openingReceivable:"",installmentAmount:"",firstDueDate:"",note:""});setLedgerOpen(true)}
  function openLedgerEdit(ledger:PersonLedger){setLedgerEditTarget(ledger);setLedgerDraft({personName:ledger.personName,relation:ledger.relation||"",mode:ledger.mode,openingReceivable:String(ledger.openingReceivable||""),installmentAmount:String(ledger.installmentAmount||""),firstDueDate:ledger.firstDueDate||"",note:ledger.note||""});setLedgerOpen(true)}
  function saveLedger(e:FormEvent){
    e.preventDefault();const openingReceivable=ledgerDraft.mode==="TARGET"?Number(ledgerDraft.openingReceivable):0;const installmentAmount=Number(ledgerDraft.installmentAmount||0);
    if(!ledgerDraft.personName.trim()||(ledgerDraft.mode==="TARGET"&&!openingReceivable)){notify("Enter the person and receivable amount");return}
    if(installmentAmount&&!ledgerDraft.firstDueDate){notify("Choose the first installment date");return}
    if(ledgerEditTarget){const related=ledgerEntries.filter(entry=>entry.ledgerId===ledgerEditTarget.id);const given=related.filter(entry=>entry.kind==="LENT").reduce((sum,entry)=>sum+entry.amount,0);const received=related.filter(entry=>entry.kind==="RECEIVED").reduce((sum,entry)=>sum+entry.amount,0);if(openingReceivable+given<received){notify(`Initial receivable cannot be below ${formatMoney(Math.max(0,received-given))}`);return}}
    const ledger:PersonLedger={id:ledgerEditTarget?.id||`person-${Date.now()}`,personName:ledgerDraft.personName.trim(),relation:ledgerDraft.relation.trim()||undefined,mode:ledgerDraft.mode,openingReceivable,installmentAmount:installmentAmount||undefined,firstDueDate:ledgerDraft.firstDueDate||undefined,note:ledgerDraft.note.trim()||undefined,createdAt:ledgerEditTarget?.createdAt||new Date().toISOString()};
    if(ledgerEditTarget){setPeopleLedgers(prev=>prev.map(item=>item.id===ledger.id?ledger:item));setSelectedLedger(ledger);setLedgerEditTarget(null);notify("Khaata updated")}else{setPeopleLedgers(prev=>[ledger,...prev]);setSelectedLedger(ledger);notify("Khaata created")}setLedgerOpen(false);
  }
  function openPersonEntry(ledger:PersonLedger,kind:PersonLedgerEntry["kind"],entry?:PersonLedgerEntry){
    setSelectedLedger(ledger);setLedgerEntryEditTarget(entry||null);setLedgerEntryDraft({kind:entry?.kind||kind,amount:entry?String(entry.amount):"",date:entry?.date||todayKey(),walletId:entry?.walletId||selectedWallet.id,note:entry?.note||""});setLedgerEntryOpen(true);
  }
  async function savePersonEntry(e:FormEvent){
    e.preventDefault();if(!selectedLedger)return;const amount=Number(ledgerEntryDraft.amount);const wallet=profile.wallets.find(item=>item.id===ledgerEntryDraft.walletId&&!item.archived);if(!amount||!wallet){notify("Enter amount and choose a wallet");return}
    const baseEntries=ledgerEntryEditTarget?ledgerEntries.filter(entry=>entry.id!==ledgerEntryEditTarget.id):ledgerEntries;const baseTransactions=ledgerEntryEditTarget?.transactionId?transactions.filter(t=>t.id!==ledgerEntryEditTarget.transactionId):transactions;const outstanding=ledgerOutstanding(selectedLedger,baseEntries);
    if(ledgerEntryDraft.kind==="RECEIVED"&&amount>outstanding){notify(`Outstanding amount is ${formatMoney(outstanding)}`);return}
    if(ledgerEntryDraft.kind==="LENT"&&amount>walletBalance(baseTransactions,wallet.id)){notify(`Not enough balance · available ${formatMoney(walletBalance(baseTransactions,wallet.id))}`);return}
    const now=new Date();const transactionId=ledgerEntryEditTarget?.transactionId||Date.now();const entryId=ledgerEntryEditTarget?.id||`ledger-entry-${transactionId}`;const direction:Direction=ledgerEntryDraft.kind==="RECEIVED"?"IN":"OUT";
    const description=ledgerEntryDraft.note.trim()||(direction==="IN"?`Installment received from ${selectedLedger.personName}`:`Money lent to ${selectedLedger.personName}`);
    const transaction:Transaction={id:transactionId,amount,description,direction,action:direction==="IN"?"Received":"Lent",date:ledgerEntryDraft.date,time:now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),source:"Manual",status:googleToken?"Pending":"Local",walletId:wallet.id,ledgerEntryId:entryId};
    const entry:PersonLedgerEntry={id:entryId,ledgerId:selectedLedger.id,kind:ledgerEntryDraft.kind,amount,date:ledgerEntryDraft.date,note:ledgerEntryDraft.note.trim()||undefined,walletId:wallet.id,transactionId};
    const next=[transaction,...baseTransactions];setTransactions(next);setLedgerEntries([entry,...baseEntries]);setLedgerEntryOpen(false);setLedgerEntryEditTarget(null);notify(direction==="IN"?"Payment updated":"Money given updated");
    if(googleToken&&spreadsheetId){try{const ok=await syncAllTransactions(next);setTransactions(prev=>prev.map(t=>t.id===transactionId?{...t,status:ok?"Synced":"Pending"}:t))}catch{notify("Saved · Sheets sync pending")}}
  }
  function khaataDateRangeIsValid(){if(khaataDates.from&&khaataDates.to&&khaataDates.from>khaataDates.to){notify("Choose a valid Khaata date range");return false}return true}
  async function downloadLedger(ledger:PersonLedger){if(!khaataDateRangeIsValid())return;const {doc,filename}=await createLedgerPdf(ledger,ledgerEntries,profile,walletNames,{from:khaataDates.from,to:khaataDates.to});doc.save(filename);notify("Khaata PDF downloaded")}
  async function shareLedger(ledger:PersonLedger){
    if(!khaataDateRangeIsValid())return;
    const {doc,filename}=await createLedgerPdf(ledger,ledgerEntries,profile,walletNames,{from:khaataDates.from,to:khaataDates.to});const file=ledgerPdfFile(doc,filename);const text=`${ledger.personName}'s Khaata · Outstanding ${formatMoney(ledgerOutstanding(ledger,ledgerEntries))}`;
    const shareNavigator=navigator as Navigator & {canShare?:(data:ShareData)=>boolean;share?:(data:ShareData)=>Promise<void>};
    try{if(shareNavigator.share&&shareNavigator.canShare?.({files:[file]})){await shareNavigator.share({title:`${ledger.personName} ledger`,text,files:[file]});return}}
    catch(error){if(error instanceof DOMException&&error.name==="AbortError")return}
    doc.save(filename);window.open(`https://wa.me/?text=${encodeURIComponent(`${text}. The PDF has been downloaded; please attach it to this chat.`)}`,"_blank","noopener,noreferrer");notify("PDF downloaded · attach it in WhatsApp");
  }
  const reportTransactions=transactions.filter(t=>t.date>=reportDates.from&&t.date<=reportDates.to);
  function cashReportRangeIsValid(){if(!reportDates.from||!reportDates.to){notify("Choose both report dates");return false}if(reportDates.from>reportDates.to){notify("Choose a valid date range");return false}return true}
  async function downloadCashReport(){if(!cashReportRangeIsValid())return;const {doc,filename}=await createCashReportPdf(reportTransactions,profile,walletNames,reportDates.from,reportDates.to);doc.save(filename);notify("Cash report PDF downloaded")}
  function downloadCashCsv(){if(!cashReportRangeIsValid())return;const blob=new Blob([cashReportCsv(reportTransactions,walletNames)],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`cash-report-${reportDates.from}-to-${reportDates.to}.csv`;link.click();URL.revokeObjectURL(url);notify("Cash report CSV downloaded")}

  function openProfileSettings(){setProfileDraft({...profile});setProfileOpen(true)}
  function saveProfileSettings(e:FormEvent){
    e.preventDefault();
    const clean={...profileDraft};
    if(!profileIsValid(clean)){notify("Check your wallet details");return}
    setProfile(clean);setProfileDraft(clean);setProfileOpen(false);notify("Currency updated");
    if(googleToken&&spreadsheetId)void syncAllTransactions(transactions,googleToken,spreadsheetId,true);
  }
  function advanceOnboarding(){
    if(onboardingStep===2&&(!profileDraft.walletName.trim()||(profileDraft.walletType==="bank"&&!profileDraft.bankName.trim()))){notify(profileDraft.walletType==="bank"?"Enter the bank name and account name":"Enter a wallet name");return}
    setOnboardingStep(step=>Math.min(3,step+1));
  }
  function completeOnboarding(){
    const wallet={id:profileDraft.wallets[0]?.id||"wallet-cash",type:profileDraft.walletType,name:profileDraft.walletName.trim(),bankName:profileDraft.walletType==="bank"?profileDraft.bankName.trim():""};
    const clean={...profileDraft,wallets:[wallet],activeWalletId:wallet.id,walletName:wallet.name,bankName:wallet.bankName,onboardingComplete:true};
    if(!walletIsValid(wallet)){setOnboardingStep(2);notify("Complete your wallet details first");return false}
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
      <div className="wallet-switcher" aria-label="Choose wallet">{availableWallets.map(wallet=><button key={wallet.id} className={wallet.id===selectedWallet.id?"active":""} onClick={()=>selectWallet(wallet.id)}>{wallet.type==="bank"?<Landmark/>:<WalletCards/>}<span>{wallet.name}<small>{display(walletBalance(transactions,wallet.id))}</small></span></button>)}<button className="add-wallet" onClick={openNewWallet} aria-label="Add wallet"><Plus/></button></div>
      <section className="balance-card">
        <div className="balance-label"><span>{walletLabel(selectedWallet)} balance</span><button onClick={()=>setHidden(v=>!v)} aria-label={hidden?"Show balance":"Hide balance"}>{hidden?<EyeOff/>:<Eye/>}</button></div>
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
      <button className="transfer-button" onClick={openTransfer}><ArrowRightLeft/><span><strong>Transfer between wallets</strong><small>Move money without changing total balance</small></span><ChevronRight/></button>
      <div className="home-plan-buttons"><button onClick={()=>{setPlanView("goals");setTab("plans")}}><PiggyBank/><span><strong>Savings</strong><small>{formatMoney(totalSaved)} saved</small></span><ChevronRight/></button><button onClick={()=>{setPlanView("people");setTab("plans")}}><UsersRound/><span><strong>Khaata</strong><small>{formatMoney(totalReceivable)} receivable</small></span><ChevronRight/></button></div>

      <button className={`closing-card ${todayClosing?"closed":""}`} onClick={()=>todayClosing?setTab("insights"):setClosingOpen(true)}>
        <span>{todayClosing?<CircleCheck/>:<ClipboardCheck/>}</span><div><strong>{todayClosing?`${selectedWallet.name} is closed`:selectedWallet.type==="bank"?"Close today’s account":"Close today’s cash"}</strong><small>{todayClosing?`${todayClosing.closedAt} · ${todayClosing.difference===0?"Balance tallied":`${formatSigned(todayClosing.difference)} difference`}`:selectedWallet.type==="bank"?`Tally ${totals.todays.length} entries with the bank balance`:`Tally ${totals.todays.length} entries with cash in hand`}</small></div><ChevronRight/>
      </button>
      {!!selectedTransactions.length&&<div className="recent-mini"><div className="mini-head"><h3>Recent in {selectedWallet.name}</h3><button onClick={()=>setTab("history")}>See all</button></div>{selectedTransactions.slice(0,3).map(t=><TransactionRow key={t.id} t={t} currency={profile.currency}/>)}</div>}
    </section>}

    {tab==="history"&&<section className="screen"><Header title="History & reports" back/><div className="search-box"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search all wallets"/></div><div className="date-filter"><label>From<input type="date" value={reportDates.from} onChange={e=>setReportDates({...reportDates,from:e.target.value})}/></label><label>To<input type="date" value={reportDates.to} onChange={e=>setReportDates({...reportDates,to:e.target.value})}/></label></div><div className="report-actions"><button onClick={()=>void downloadCashReport()}><Download/> Cash report PDF</button><button onClick={downloadCashCsv}><FileSpreadsheet/> Export CSV</button></div><div className="history-summary"><span>{filtered.length} entries · all wallets</span><strong>{formatSigned(totalBalance(filtered))}</strong></div><div className="history-list">{!filtered.length?<Empty icon={<History/>} title="No transactions yet" text="Your recorded entries will appear here."/>:filtered.map(t=><TransactionRow key={t.id} t={t} currency={profile.currency} walletName={walletNames[t.walletId]} showDate actions onEdit={()=>openEdit(t)} onDelete={isOpeningBalanceEntry(t)?undefined:()=>setDeleteTarget(t)}/>)}</div></section>}

    {tab==="plans"&&<section className="screen plans-screen"><Header title="Plans & ledgers" back/>
      <section className="plans-hero"><div><small>{planView==="goals"?"SAVINGS":"KHAATA"}</small><h2>{planView==="goals"?formatMoney(totalSaved):formatMoney(totalReceivable)}</h2><p>{planView==="goals"?"Money currently held in savings":"Still to receive from people"}</p></div><span>{planView==="goals"?<PiggyBank/>:<HandCoins/>}</span></section>
      <div className="plan-tabs"><button className={planView==="goals"?"active":""} onClick={()=>setPlanView("goals")}><Target/> Savings</button><button className={planView==="people"?"active":""} onClick={()=>setPlanView("people")}><UsersRound/> Khaata</button></div>
      {planView==="goals"&&<><div className="plans-heading"><div><small>SAVINGS</small><h2>What are you saving for?</h2></div><button onClick={openNewGoal}><Plus/> Add goal</button></div>{!activeGoals.length?<Empty icon={<PiggyBank/>} title="Create your first savings goal" text="Track money moved from a wallet into savings for assets, shopping, tours, or anything important."/>:<div className="goal-list">{activeGoals.map(goal=>{const saved=goalSaved(savingsEntries,goal.id);const progress=goalProgress(goal,savingsEntries);return <article className="goal-card" key={goal.id}><div className="goal-card-head"><span><Target/></span><button className="goal-name" onClick={()=>setSelectedGoal(goal)}><strong>{goal.name}</strong><small>{goal.targetDate?`Target ${new Date(`${goal.targetDate}T12:00:00`).toLocaleDateString("en-PK",{month:"short",year:"numeric"})}`:"View savings entries"}</small></button><button className="icon-edit" onClick={()=>openGoalEdit(goal)} aria-label={`Edit ${goal.name}`}><PenLine/></button></div><div className="goal-amount"><strong>{formatMoney(saved)}</strong><span>of {formatMoney(goal.targetAmount)}</span></div><div className="progress-track"><i style={{width:`${progress}%`}}/></div><div className="goal-actions"><button onClick={()=>openGoalEntry(goal,"WITHDRAW")} disabled={saved<=0}>Withdraw to wallet</button><button onClick={()=>openGoalEntry(goal,"ADD")}><Plus/> Save from wallet</button></div></article>})}</div>}</>}
      {planView==="people"&&<><div className="plans-heading"><div><small>KHAATA</small><h2>Who has to pay you?</h2></div><button onClick={openNewLedger}><Plus/> Add Khaata</button></div>{!activePeopleLedgers.length?<Empty icon={<UsersRound/>} title="No Khaata yet" text="Create an open Khaata or set a receivable with monthly installments."/>:<div className="people-list">{activePeopleLedgers.map(ledger=>{const outstanding=Math.max(0,ledgerOutstanding(ledger,ledgerEntries));const received=ledgerReceived(ledgerEntries,ledger.id);const principal=ledgerPrincipal(ledger,ledgerEntries);const next=installmentSchedule(ledger,ledgerEntries).find(row=>row.status!=="PAID");return <button className="person-card" key={ledger.id} onClick={()=>{setKhaataDates({from:"",to:todayKey()});setSelectedLedger(ledger)}}><span><UsersRound/></span><div><strong>{ledger.personName}</strong><small>{ledger.relation||"Khaata"}{next?` · Next ${formatMoney(next.amount-next.paid)} ${new Date(`${next.dueDate}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"short"})}`:""}</small><div className="person-progress"><i style={{width:`${principal?Math.min(100,(received/principal)*100):0}%`}}/></div></div><b>{formatMoney(outstanding)}<small>outstanding</small></b><ChevronRight/></button>})}</div>}</>}
    </section>}

    {tab==="insights"&&<section className="screen"><Header title="Insights" back/><section className="insight-hero"><small>TOTAL ACROSS ALL WALLETS</small><h2>{formatSigned(totalBalance(transactions))}</h2><div><span>Active wallets <strong>{availableWallets.length}</strong></span><span>Transactions <strong>{transactions.length}</strong></span></div></section><div className="wallet-balance-list">{availableWallets.map(wallet=><button key={wallet.id} onClick={()=>{selectWallet(wallet.id);setTab("home")}}><span>{wallet.type==="bank"?<Landmark/>:<WalletCards/>}</span><div><strong>{walletLabel(wallet)}</strong><small>{wallet.type==="bank"?"Bank account":"Cash wallet"}</small></div><b>{formatMoney(walletBalance(transactions,wallet.id))}</b></button>)}</div><div className="section-title compact"><div><small>DAILY CLOSINGS</small><h2>Tally history</h2></div><CalendarDays/></div>{!closings.length?<Empty icon={<ClipboardCheck/>} title="No closing summary yet" text="Close a wallet to keep a record of expected and counted balance."/>:<div className="closing-list">{closings.map(c=><article key={`${c.walletId}-${c.date}`}><span className={c.difference===0?"match":"difference"}>{c.difference===0?<Check/>:<Info/>}</span><div><strong>{new Date(`${c.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"long",year:"numeric"})}</strong><small>{walletNames[c.walletId]||"Wallet"} · Expected {formatMoney(c.expected)} · Counted {formatMoney(c.counted)}</small></div><b>{c.difference===0?"Tallied":formatSigned(c.difference)}</b></article>)}</div>}</section>}

    {tab==="settings"&&<section className="screen">
      <Header title="Settings" back/>
      <div className="settings-group"><small>ACCOUNT & CURRENCY</small>
        <button onClick={openProfileSettings}><span><Banknote/></span><div><strong>Currency</strong><small>{profile.currency} · Amounts shown as {currencyPrefix(profile.currency)}</small></div><ChevronRight/></button>
      </div>
      <div className="settings-group wallet-settings"><small>WALLETS</small>
        {availableWallets.map(wallet=><button key={wallet.id} onClick={()=>openWalletEdit(wallet)}><span>{wallet.type==="bank"?<Landmark/>:<WalletCards/>}</span><div><strong>{walletLabel(wallet)}</strong><small>{formatMoney(walletBalance(transactions,wallet.id))} · {wallet.id===selectedWallet.id?"Currently selected":wallet.type==="bank"?"Bank account":"Cash wallet"}</small></div><ChevronRight/></button>)}
        <button onClick={openNewWallet}><span><Plus/></span><div><strong>Add another wallet</strong><small>Cash, bank, mobile wallet, or petty cash</small></div><ChevronRight/></button>
        <button onClick={openTransfer}><span><ArrowRightLeft/></span><div><strong>Transfer between wallets</strong><small>Move money without recording income or expense</small></div><ChevronRight/></button>
      </div>
      <div className="settings-group"><small>CASHBOOK</small>
        <button onClick={openOpeningBalance}><span><Landmark/></span><div><strong>{openingEntry?`Edit ${selectedWallet.name} opening balance`:`Add ${selectedWallet.name} opening balance`}</strong><small>{openingEntry?`${formatMoney(openingEntry.amount)} · ${new Date(`${openingEntry.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"short",year:"numeric"})}`:"Record this wallet’s starting balance"}</small></div><ChevronRight/></button>
        <button onClick={()=>setClosingOpen(true)}><span><ClipboardCheck/></span><div><strong>{selectedWallet.name} closing summary</strong><small>Count and tally today’s wallet balance</small></div><ChevronRight/></button>
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

    <nav className="bottom-nav"><button className={tab==="home"?"active":""} onClick={()=>setTab("home")}><Home/><span>Home</span></button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}><History/><span>History</span></button><button className={tab==="plans"?"active":""} onClick={()=>setTab("plans")}><PiggyBank/><span>Plans</span></button><button className={tab==="insights"?"active":""} onClick={()=>setTab("insights")}><BarChart3/><span>Insights</span></button><button className={tab==="settings"?"active":""} onClick={()=>setTab("settings")}><Settings2/><span>Settings</span></button></nav>

    {entryMode&&<div className="sheet-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)closeEntry()}}><section className="entry-sheet" role="dialog" aria-modal="true"><div className="sheet-handle"/><button className="sheet-close" onClick={closeEntry} aria-label="Close"><X/></button><div className="entry-wallet-pill">{selectedWallet.type==="bank"?<Landmark/>:<WalletCards/>} {walletLabel(selectedWallet)}</div>{entryMode==="voice"&&<><div className={`voice-orb ${listening?"listening":""}`}><Mic/></div><h2>{listening?"Listening…":"Voice entry"}</h2><p className="sheet-sub">Boliye: “500 rupay Imran se liye”</p>{input&&<div className="heard-text">“{input}”</div>} {!listening&&!candidate&&<button className="primary-button" onClick={startVoice}><Mic/> Tap to speak again</button>}</>}{entryMode==="chat"&&<><span className="sheet-icon chat"><MessageCircleMore/></span><h2>Type your transaction</h2><p className="sheet-sub">Roman Urdu or English — dono chalega</p><div className="chat-entry"><input ref={chatRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void interpretText(input)} placeholder="e.g. 2,000 chaye wale ko diye"/><button onClick={()=>void interpretText(input)} disabled={parsing}><Send/></button></div></>}{entryMode==="manual"&&<><span className="sheet-icon manual"><PenLine/></span><h2>Manual entry</h2><form className="manual-form" onSubmit={submitManual}><label>Wallet<select value={manual.walletId} onChange={e=>setManual({...manual,walletId:e.target.value})} required><option value="" disabled>Choose wallet</option>{availableWallets.map(wallet=><option value={wallet.id} key={wallet.id}>{walletLabel(wallet)} · {formatMoney(walletBalance(transactions,wallet.id))}</option>)}</select></label><label>Amount ({currencyPrefix(profile.currency)})<input ref={manualRef} type="number" inputMode="decimal" value={manual.amount} onChange={e=>setManual({...manual,amount:e.target.value})} placeholder="0"/></label><label>Description<input value={manual.description} onChange={e=>setManual({...manual,description:e.target.value})} placeholder="What was this for?"/></label><div className="direction-toggle"><button type="button" className={manual.direction==="IN"?"selected in":""} onClick={()=>setManual({...manual,direction:"IN"})}><ArrowDownLeft/> Money in</button><button type="button" className={manual.direction==="OUT"?"selected out":""} onClick={()=>setManual({...manual,direction:"OUT"})}><ArrowUpRight/> Money out</button></div><button className="primary-button" type="submit">Save transaction</button></form></>}{parsing&&<p className="parsing"><Sparkles/> Understanding your transaction…</p>}{candidate&&<Confirm candidate={candidate} setCandidate={setCandidate} cancel={closeEntry} currency={profile.currency} wallets={availableWallets} save={()=>void (candidate.transfer?addDetectedTransfer(candidate):addTransaction(candidate,entryMode==="voice"?"Voice":"Chat"))}/>}</section></div>}

    {openingOpen&&<Modal close={()=>setOpeningOpen(false)} title={openingEntry?`Edit ${selectedWallet.name} opening balance`:`Add ${selectedWallet.name} opening balance`} subtitle={openingEntryCount>1?"Multiple old opening entries were found. Saving will replace them with this single corrected balance.":"Set the balance and date you started this wallet with."}><form onSubmit={saveOpening} className="single-form"><label>Opening balance ({currencyPrefix(profile.currency)})<input autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={openingAmount} onChange={e=>setOpeningAmount(e.target.value)} placeholder="0"/></label><label>Opening balance date<input type="date" max={todayKey()} value={openingDate} onChange={e=>setOpeningDate(e.target.value)} required/></label><p><Info/> Each wallet has its own opening balance.</p><button className="primary-button">{openingEntry?"Save opening balance changes":"Save opening balance"}</button></form></Modal>}
    {closingOpen&&<Modal close={()=>setClosingOpen(false)} title={selectedWallet.type==="bank"?`Close ${selectedWallet.name} account`:`Close ${selectedWallet.name}`} subtitle={selectedWallet.type==="bank"?"Enter the bank balance, then compare it with Hisaab.":"Count the physical cash you have, then compare it with Hisaab."}><div className="closing-totals"><span>Current balance<strong>{formatMoney(totals.balance)}</strong></span><span>Today’s entries<strong>{totals.todays.length}</strong></span></div><form onSubmit={saveClosing} className="single-form"><label>{selectedWallet.type==="bank"?"Bank balance":"Cash counted"} ({currencyPrefix(profile.currency)})<input autoFocus type="number" inputMode="decimal" value={countedCash} onChange={e=>setCountedCash(e.target.value)} placeholder={selectedWallet.type==="bank"?"Enter bank balance":"Enter physical cash"}/></label>{countedCash!==""&&<div className={`difference-preview ${Number(countedCash)-totals.balance===0?"match":""}`}><span>{Number(countedCash)-totals.balance===0?<Check/>:<Info/>}</span><div><small>DIFFERENCE</small><strong>{formatSigned(Number(countedCash)-totals.balance)}</strong></div></div>}<label>Note (optional)<input value={closingNote} onChange={e=>setClosingNote(e.target.value)} placeholder="Reason for any difference"/></label><button className="primary-button">Save closing summary</button></form></Modal>}
    {editTarget&&<Modal close={()=>setEditTarget(null)} title="Edit transaction" subtitle="Update this past entry. Wallet balances and Google Sheets will be recalculated."><form onSubmit={saveEdit} className="manual-form"><label>Wallet<select value={editDraft.walletId} onChange={e=>setEditDraft({...editDraft,walletId:e.target.value})}>{availableWallets.map(wallet=><option value={wallet.id} key={wallet.id}>{walletLabel(wallet)}</option>)}</select></label><label>Amount ({currencyPrefix(profile.currency)})<input autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={editDraft.amount} onChange={e=>setEditDraft({...editDraft,amount:e.target.value})}/></label><label>Description<input value={editDraft.description} onChange={e=>setEditDraft({...editDraft,description:e.target.value})}/></label><label>Date<input type="date" value={editDraft.date} onChange={e=>setEditDraft({...editDraft,date:e.target.value})}/></label><div className="direction-toggle"><button type="button" className={editDraft.direction==="IN"?"selected in":""} onClick={()=>setEditDraft({...editDraft,direction:"IN"})}><ArrowDownLeft/> Money in</button><button type="button" className={editDraft.direction==="OUT"?"selected out":""} onClick={()=>setEditDraft({...editDraft,direction:"OUT"})}><ArrowUpRight/> Money out</button></div><button className="primary-button">Save changes</button></form></Modal>}
    {deleteTarget&&<Modal close={()=>setDeleteTarget(null)} title={deleteTarget.transferId?"Delete transfer?":"Delete transaction?"} subtitle={`${formatMoney(deleteTarget.amount)} · ${deleteTarget.description}`}><div className="delete-confirm"><p>{deleteTarget.transferId?"Both sides of this wallet transfer will be removed.":"This removes the entry from the app, private backup, and connected Google Sheet."}</p><button className="danger-button" onClick={()=>void confirmDelete()}><Trash2/> {deleteTarget.transferId?"Delete transfer":"Delete transaction"}</button><button className="secondary-button" onClick={()=>setDeleteTarget(null)}>Keep entry</button></div></Modal>}
    {profileOpen&&<Modal close={()=>setProfileOpen(false)} title="Currency" subtitle="This controls amount labels throughout the cashbook and Google Sheet."><form className="manual-form" onSubmit={saveProfileSettings}><label>Currency<select value={profileDraft.currency} onChange={e=>setProfileDraft({...profileDraft,currency:e.target.value as CashbookProfile["currency"]})}>{CURRENCY_OPTIONS.map(option=><option value={option.code} key={option.code}>{option.code} · {option.label}</option>)}</select></label><button className="primary-button">Save currency</button></form></Modal>}
    {walletOpen&&<Modal close={()=>setWalletOpen(false)} title={walletDraft.id?"Edit wallet":"Add wallet"} subtitle="Keep cash, bank accounts, and other balances separate."><form className="manual-form" onSubmit={saveWallet}><div className="direction-toggle"><button type="button" className={walletDraft.type==="cash"?"selected in":""} onClick={()=>setWalletDraft({...walletDraft,type:"cash",bankName:""})}><WalletCards/> Cash</button><button type="button" className={walletDraft.type==="bank"?"selected in":""} onClick={()=>setWalletDraft({...walletDraft,type:"bank"})}><Landmark/> Bank</button></div>{walletDraft.type==="bank"&&<label>Bank name<input value={walletDraft.bankName} onChange={e=>setWalletDraft({...walletDraft,bankName:e.target.value})} placeholder="e.g. Meezan Bank" required/></label>}<label>{walletDraft.type==="bank"?"Account name":"Wallet name"}<input autoFocus value={walletDraft.name} onChange={e=>setWalletDraft({...walletDraft,name:e.target.value})} placeholder={walletDraft.type==="bank"?"e.g. Business account":"e.g. Cash drawer"} required/></label><button className="primary-button">{walletDraft.id?"Save wallet":"Add wallet"}</button>{walletDraft.id&&<button className="archive-button" type="button" onClick={()=>{archiveWallet(walletDraft);setWalletOpen(false)}}><Archive/> Archive wallet</button>}</form></Modal>}
    {transferOpen&&<Modal close={()=>setTransferOpen(false)} title="Transfer between wallets" subtitle="This moves money internally, so your total balance stays the same."><form className="manual-form" onSubmit={saveTransfer}><label>From wallet<select value={transferDraft.fromWalletId} onChange={e=>setTransferDraft({...transferDraft,fromWalletId:e.target.value,toWalletId:e.target.value===transferDraft.toWalletId?availableWallets.find(w=>w.id!==e.target.value)?.id||"":transferDraft.toWalletId})}>{availableWallets.map(wallet=><option value={wallet.id} key={wallet.id}>{walletLabel(wallet)} · {formatMoney(walletBalance(transactions,wallet.id))}</option>)}</select></label><div className="transfer-arrow"><ArrowDownLeft/></div><label>To wallet<select value={transferDraft.toWalletId} onChange={e=>setTransferDraft({...transferDraft,toWalletId:e.target.value})}>{availableWallets.filter(wallet=>wallet.id!==transferDraft.fromWalletId).map(wallet=><option value={wallet.id} key={wallet.id}>{walletLabel(wallet)}</option>)}</select></label><label>Amount ({currencyPrefix(profile.currency)})<input autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={transferDraft.amount} onChange={e=>setTransferDraft({...transferDraft,amount:e.target.value})} placeholder="0"/></label><label>Note (optional)<input value={transferDraft.note} onChange={e=>setTransferDraft({...transferDraft,note:e.target.value})} placeholder="e.g. Cash deposited in bank"/></label><button className="primary-button"><ArrowRightLeft/> Transfer money</button></form></Modal>}
    {goalOpen&&<Modal close={()=>{setGoalOpen(false);setGoalEditTarget(null)}} title={goalEditTarget?"Edit savings goal":"New savings goal"} subtitle="Set the goal details. Money only moves when you record a savings entry and choose a wallet."><form className="manual-form" onSubmit={saveGoal}><label>Goal name<input autoFocus value={goalDraft.name} onChange={e=>setGoalDraft({...goalDraft,name:e.target.value})} placeholder="e.g. Family tour" required/></label><label>Target amount ({currencyPrefix(profile.currency)})<input type="number" min="1" step="0.01" inputMode="decimal" value={goalDraft.targetAmount} onChange={e=>setGoalDraft({...goalDraft,targetAmount:e.target.value})} placeholder="0" required/></label><label>Target date (optional)<input type="date" value={goalDraft.targetDate} onChange={e=>setGoalDraft({...goalDraft,targetDate:e.target.value})}/></label><label>Note (optional)<input value={goalDraft.note} onChange={e=>setGoalDraft({...goalDraft,note:e.target.value})} placeholder="What is this goal for?"/></label><button className="primary-button"><Target/> {goalEditTarget?"Save goal changes":"Create goal"}</button></form></Modal>}
    {goalEntryTarget&&<Modal close={()=>{setGoalEntryTarget(null);setSavingEditTarget(null)}} title={savingEditTarget?"Edit savings entry":goalEntryDraft.direction==="ADD"?`Save for ${goalEntryTarget.name}`:`Withdraw from ${goalEntryTarget.name}`} subtitle={goalEntryDraft.direction==="ADD"?"The amount will leave the selected wallet and enter this savings goal.":"The amount will leave this savings goal and enter the selected wallet."}><form className="manual-form" onSubmit={saveGoalEntry}><div className="direction-toggle"><button type="button" className={goalEntryDraft.direction==="ADD"?"selected out":""} onClick={()=>setGoalEntryDraft({...goalEntryDraft,direction:"ADD"})}>Save from wallet</button><button type="button" className={goalEntryDraft.direction==="WITHDRAW"?"selected in":""} onClick={()=>setGoalEntryDraft({...goalEntryDraft,direction:"WITHDRAW"})}>Withdraw to wallet</button></div><label>Wallet<select value={goalEntryDraft.walletId} onChange={e=>setGoalEntryDraft({...goalEntryDraft,walletId:e.target.value})} required>{availableWallets.map(wallet=><option key={wallet.id} value={wallet.id}>{walletLabel(wallet)} · {formatMoney(walletBalance(transactions,wallet.id))}</option>)}</select></label><label>Amount ({currencyPrefix(profile.currency)})<input autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={goalEntryDraft.amount} onChange={e=>setGoalEntryDraft({...goalEntryDraft,amount:e.target.value})} placeholder="0" required/></label><label>Date<input type="date" value={goalEntryDraft.date} onChange={e=>setGoalEntryDraft({...goalEntryDraft,date:e.target.value})} required/></label><label>Note (optional)<input value={goalEntryDraft.note} onChange={e=>setGoalEntryDraft({...goalEntryDraft,note:e.target.value})} placeholder="e.g. Monthly saving"/></label><button className="primary-button">{savingEditTarget?"Save entry changes":"Save entry"}</button></form></Modal>}
    {selectedGoal&&!goalEntryTarget&&!goalOpen&&<Modal close={()=>setSelectedGoal(null)} title={selectedGoal.name} subtitle={`${formatMoney(goalSaved(savingsEntries,selectedGoal.id))} currently saved`}><div className="ledger-history"><div className="mini-head"><h3>Savings entries</h3><button onClick={()=>openGoalEdit(selectedGoal)}><PenLine/> Edit goal</button></div>{savingsEntries.filter(entry=>entry.goalId===selectedGoal.id).length===0?<p>No savings entries yet.</p>:savingsEntries.filter(entry=>entry.goalId===selectedGoal.id).sort((a,b)=>b.date.localeCompare(a.date)).map(entry=><article key={entry.id}><span className={entry.direction==="ADD"?"in":"out"}>{entry.direction==="ADD"?<ArrowDownLeft/>:<ArrowUpRight/>}</span><div><strong>{entry.note||(entry.direction==="ADD"?"Saved from wallet":"Withdrawn to wallet")}</strong><small>{new Date(`${entry.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"short",year:"numeric"})} · {entry.walletId?walletNames[entry.walletId]:"Older entry"}</small></div><b className={entry.direction==="ADD"?"in":"out"}>{entry.direction==="ADD"?"+":"−"}{formatMoney(entry.amount)}</b><button className="entry-edit" onClick={()=>openGoalEntry(selectedGoal,entry.direction,entry)}><PenLine/> Edit</button></article>)}</div></Modal>}
    {ledgerOpen&&<Modal close={()=>{setLedgerOpen(false);setLedgerEditTarget(null)}} title={ledgerEditTarget?"Edit Khaata":"Create Khaata"} subtitle="Use an open Khaata for ongoing give-and-receive, or set an initial receivable with installments."><form className="manual-form" onSubmit={saveLedger}><label>Person name<input autoFocus value={ledgerDraft.personName} onChange={e=>setLedgerDraft({...ledgerDraft,personName:e.target.value})} placeholder="e.g. Ammi" required/></label><label>Relation (optional)<input value={ledgerDraft.relation} onChange={e=>setLedgerDraft({...ledgerDraft,relation:e.target.value})} placeholder="e.g. Mother, sister"/></label><div className="direction-toggle"><button type="button" className={ledgerDraft.mode==="OPEN"?"selected in":""} onClick={()=>setLedgerDraft({...ledgerDraft,mode:"OPEN",openingReceivable:""})}>Open Khaata</button><button type="button" className={ledgerDraft.mode==="TARGET"?"selected in":""} onClick={()=>setLedgerDraft({...ledgerDraft,mode:"TARGET"})}>Initial receivable</button></div>{ledgerDraft.mode==="TARGET"&&<label>Initial receivable ({currencyPrefix(profile.currency)})<input type="number" min="0.01" step="0.01" inputMode="decimal" value={ledgerDraft.openingReceivable} onChange={e=>setLedgerDraft({...ledgerDraft,openingReceivable:e.target.value})} placeholder="0" required/></label>}<label>Monthly installment (optional)<input type="number" min="0.01" step="0.01" inputMode="decimal" value={ledgerDraft.installmentAmount} onChange={e=>setLedgerDraft({...ledgerDraft,installmentAmount:e.target.value})} placeholder="e.g. 10,000"/></label>{ledgerDraft.installmentAmount&&<label>First due date<input type="date" value={ledgerDraft.firstDueDate} onChange={e=>setLedgerDraft({...ledgerDraft,firstDueDate:e.target.value})} required/></label>}<label>Note (optional)<input value={ledgerDraft.note} onChange={e=>setLedgerDraft({...ledgerDraft,note:e.target.value})} placeholder="Loan or arrangement details"/></label><button className="primary-button"><UsersRound/> {ledgerEditTarget?"Save Khaata changes":"Create Khaata"}</button></form></Modal>}
    {selectedLedger&&!ledgerEntryOpen&&!ledgerOpen&&<Modal close={()=>setSelectedLedger(null)} title={selectedLedger.personName} subtitle={`${selectedLedger.relation||"Khaata"} · ${selectedLedger.mode==="OPEN"?"Open Khaata":"Initial receivable"}`}>
      <button className="modal-edit-button" onClick={()=>openLedgerEdit(selectedLedger)}><PenLine/> Edit Khaata & initial receivable</button>
      <div className="ledger-summary"><span><small>TOTAL</small><strong>{formatMoney(ledgerPrincipal(selectedLedger,ledgerEntries))}</strong></span><span><small>RECEIVED</small><strong>{formatMoney(ledgerReceived(ledgerEntries,selectedLedger.id))}</strong></span><span className="due"><small>OUTSTANDING</small><strong>{formatMoney(Math.max(0,ledgerOutstanding(selectedLedger,ledgerEntries)))}</strong></span></div>
      <div className="ledger-action-grid"><button onClick={()=>openPersonEntry(selectedLedger,"LENT")}><ArrowUpRight/> Give money</button><button onClick={()=>openPersonEntry(selectedLedger,"RECEIVED")} disabled={ledgerOutstanding(selectedLedger,ledgerEntries)<=0}><ArrowDownLeft/> Receive payment</button></div>
      {installmentSchedule(selectedLedger,ledgerEntries).length>0&&<div className="schedule-box"><div><CalendarClock/><strong>Installments</strong></div>{installmentSchedule(selectedLedger,ledgerEntries).slice(0,6).map(row=><span key={row.number} className={row.status.toLowerCase()}><b>#{row.number} · {new Date(`${row.dueDate}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"short"})}</b><small>{formatMoney(row.amount)} · {row.status}{row.paid?` · ${formatMoney(row.paid)} paid`:""}</small></span>)}</div>}
      <div className="ledger-history"><div className="mini-head"><h3>Khaata entries</h3><small>{ledgerEntries.filter(entry=>entry.ledgerId===selectedLedger.id).length} entries</small></div>{ledgerEntries.filter(entry=>entry.ledgerId===selectedLedger.id).length===0?<p>No cash movement recorded yet.</p>:ledgerEntries.filter(entry=>entry.ledgerId===selectedLedger.id).sort((a,b)=>b.date.localeCompare(a.date)).map(entry=><article key={entry.id}><span className={entry.kind==="RECEIVED"?"in":"out"}>{entry.kind==="RECEIVED"?<ArrowDownLeft/>:<ArrowUpRight/>}</span><div><strong>{entry.note||(entry.kind==="RECEIVED"?"Payment received":"Money given")}</strong><small>{new Date(`${entry.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"short",year:"numeric"})} · {entry.walletId?walletNames[entry.walletId]:"Adjustment"}</small></div><b className={entry.kind==="RECEIVED"?"in":"out"}>{entry.kind==="RECEIVED"?"−":"+"}{formatMoney(entry.amount)}</b><button className="entry-edit" onClick={()=>openPersonEntry(selectedLedger,entry.kind,entry)}><PenLine/> Edit</button></article>)}</div>
      <div className="date-filter khaata-filter"><label>PDF from<input type="date" value={khaataDates.from} onChange={e=>setKhaataDates({...khaataDates,from:e.target.value})}/></label><label>PDF to<input type="date" value={khaataDates.to} onChange={e=>setKhaataDates({...khaataDates,to:e.target.value})}/></label></div><div className="pdf-actions"><button onClick={()=>void downloadLedger(selectedLedger)}><Download/> Save Khaata PDF</button><button onClick={()=>void shareLedger(selectedLedger)}><Share2/> Share on WhatsApp</button></div>
    </Modal>}
    {ledgerEntryOpen&&selectedLedger&&<Modal close={()=>{setLedgerEntryOpen(false);setLedgerEntryEditTarget(null)}} title={ledgerEntryEditTarget?"Edit Khaata entry":ledgerEntryDraft.kind==="RECEIVED"?`Receive from ${selectedLedger.personName}`:`Give money to ${selectedLedger.personName}`} subtitle={ledgerEntryDraft.kind==="RECEIVED"?`Outstanding: ${formatMoney(Math.max(0,ledgerOutstanding(selectedLedger,ledgerEntries)))}`:"This reduces the selected wallet and increases the amount to receive."}><form className="manual-form" onSubmit={savePersonEntry}><div className="direction-toggle"><button type="button" className={ledgerEntryDraft.kind==="LENT"?"selected out":""} onClick={()=>setLedgerEntryDraft({...ledgerEntryDraft,kind:"LENT"})}>Money given</button><button type="button" className={ledgerEntryDraft.kind==="RECEIVED"?"selected in":""} onClick={()=>setLedgerEntryDraft({...ledgerEntryDraft,kind:"RECEIVED"})}>Payment received</button></div><label>Wallet<select value={ledgerEntryDraft.walletId} onChange={e=>setLedgerEntryDraft({...ledgerEntryDraft,walletId:e.target.value})} required>{availableWallets.map(wallet=><option key={wallet.id} value={wallet.id}>{walletLabel(wallet)} · {formatMoney(walletBalance(transactions,wallet.id))}</option>)}</select></label><label>Amount ({currencyPrefix(profile.currency)})<input autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={ledgerEntryDraft.amount} onChange={e=>setLedgerEntryDraft({...ledgerEntryDraft,amount:e.target.value})} placeholder="0" required/></label><label>Date<input type="date" value={ledgerEntryDraft.date} onChange={e=>setLedgerEntryDraft({...ledgerEntryDraft,date:e.target.value})} required/></label><label>Note (optional)<input value={ledgerEntryDraft.note} onChange={e=>setLedgerEntryDraft({...ledgerEntryDraft,note:e.target.value})} placeholder={ledgerEntryDraft.kind==="RECEIVED"?"e.g. August installment":"Purpose or details"}/></label><button className="primary-button">{ledgerEntryEditTarget?"Save Khaata entry changes":"Save to wallet & Khaata"}</button></form></Modal>}
    {sheetConflict&&<Modal close={()=>setSheetConflict(null)} title="Google Sheet changes found" subtitle="Nothing has been overwritten. Choose which version should become your cashbook."><div className="conflict-summary"><span><b>{sheetConflict.added}</b> added in Sheet</span><span><b>{sheetConflict.changed}</b> changed in Sheet</span><span><b>{sheetConflict.removed}</b> removed in Sheet</span></div><div className="delete-confirm"><button className="primary-button" onClick={importSheetChanges}><FileSpreadsheet/> Keep Google Sheet changes</button><button className="secondary-button" onClick={()=>void restoreSheetFromApp()}><RefreshCw/> Restore Sheet from app</button><p><ShieldCheck/> The running balance and negative-balance rules are validated before Sheet changes can be imported.</p></div></Modal>}
    {onboardingStep>0&&<Onboarding step={onboardingStep} profile={profileDraft} setProfile={setProfileDraft} next={advanceOnboarding} back={()=>setOnboardingStep(step=>Math.max(1,step-1))} skip={completeOnboarding} connect={()=>void connectFromOnboarding()}/>} 
    {toast&&<div className="toast" role="status"><Check/>{toast}</div>}
  </main>
}

function TransactionRow({t,currency,walletName,showDate=false,actions=false,onEdit,onDelete}:{t:Transaction;currency:CashbookProfile["currency"];walletName?:string;showDate?:boolean;actions?:boolean;onEdit?:()=>void;onDelete?:()=>void}){return <article className={`transaction-row ${actions?"with-actions":""}`}><span className={t.direction==="IN"?"in":"out"}>{t.source==="Transfer"?<ArrowRightLeft/>:t.direction==="IN"?<ArrowDownLeft/>:<ArrowUpRight/>}</span><div><strong>{t.description}</strong><small>{showDate?`${new Date(`${t.date}T12:00:00`).toLocaleDateString("en-PK",{day:"numeric",month:"short"})} · `:""}{walletName?`${walletName} · `:""}{t.time} · {t.source}</small></div><b className={t.direction==="IN"?"in":"out"}>{t.direction==="IN"?"+":"−"}{money(t.amount,currency)}</b>{actions&&<div className="row-actions"><button onClick={onEdit} aria-label={`Edit ${t.description}`}><PenLine/></button>{onDelete&&<button className="delete" onClick={onDelete} aria-label={`Delete ${t.description}`}><Trash2/></button>}</div>}</article>}
function Empty({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{text}</p></div>}
function Modal({close,title,subtitle,children}:{close:()=>void;title:string;subtitle:string;children:React.ReactNode}){return <div className="sheet-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close()}}><section className="entry-sheet modal-sheet" role="dialog" aria-modal="true"><div className="sheet-handle"/><button className="sheet-close" onClick={close} aria-label="Close"><X/></button><h2>{title}</h2><p className="sheet-sub">{subtitle}</p>{children}</section></div>}
function Confirm({candidate,setCandidate,save,cancel,currency,wallets}:{candidate:ParsedCandidate;setCandidate:(v:ParsedCandidate|null)=>void;save:()=>void;cancel:()=>void;currency:CashbookProfile["currency"];wallets:Wallet[]}){
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(candidate);
  useEffect(()=>setDraft(candidate),[candidate]);
  const needsWallet=!candidate.transfer&&candidate.direction==="OUT"&&wallets.length>1;
  if(editing)return <form className="confirm-box confirm-editor" onSubmit={e=>{e.preventDefault();if(!draft.amount||!draft.description.trim()||(draft.direction==="OUT"&&wallets.length>1&&!draft.walletId))return;setCandidate({...draft,description:draft.description.trim(),ambiguous:false,walletRequired:false});setEditing(false)}}><small>EDIT BEFORE SAVING</small>{!draft.transfer&&<label>Wallet<select value={draft.walletId||""} onChange={e=>setDraft({...draft,walletId:e.target.value,walletRequired:false})} required={draft.direction==="OUT"&&wallets.length>1}><option value="" disabled>Choose wallet</option>{wallets.map(wallet=><option value={wallet.id} key={wallet.id}>{walletLabel(wallet)}</option>)}</select></label>}<label>Amount ({currencyPrefix(currency)})<input autoFocus type="number" min="0.01" step="0.01" value={draft.amount||""} onChange={e=>setDraft({...draft,amount:Number(e.target.value)})}/></label><label>Description<input value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>{!draft.transfer&&<div className="direction-toggle"><button type="button" className={draft.direction==="IN"?"selected in":""} onClick={()=>setDraft({...draft,direction:"IN",action:"Received",walletId:draft.walletId||wallets[0]?.id,walletRequired:false})}>Money in</button><button type="button" className={draft.direction==="OUT"?"selected out":""} onClick={()=>setDraft({...draft,direction:"OUT",action:"Spent",walletRequired:wallets.length>1&&!draft.walletId})}>Money out</button></div>}<button className="primary-button">Apply correction</button></form>;
  return <div className="confirm-box"><small>HISAAB UNDERSTOOD</small><h3>{money(candidate.amount,currency)} · {candidate.description}</h3><p>{candidate.transfer?`Wallet transfer · ${candidate.transfer.fromLabel} → ${candidate.transfer.toLabel}`:candidate.direction==="IN"?"Money coming in":"Money going out"}</p>{candidate.ambiguous&&<div className="confirm-directions"><button onClick={()=>setCandidate({...candidate,direction:"IN",action:"Received",ambiguous:false,walletId:candidate.walletId||wallets[0]?.id,walletRequired:false})}>Money in</button><button onClick={()=>setCandidate({...candidate,direction:"OUT",action:"Spent",ambiguous:false,walletId:wallets.length===1?wallets[0].id:candidate.walletId,walletRequired:wallets.length>1&&!candidate.walletId})}>Money out</button></div>}{needsWallet&&<label className="confirm-wallet">Wallet{candidate.walletRequired&&<small>Choose where this expense was paid from</small>}<select value={candidate.walletId||""} onChange={e=>setCandidate({...candidate,walletId:e.target.value,walletRequired:false})}><option value="" disabled>Choose wallet</option>{wallets.map(wallet=><option value={wallet.id} key={wallet.id}>{walletLabel(wallet)}</option>)}</select></label>}<div className="confirm-actions three"><button onClick={cancel}>Cancel</button><button onClick={()=>setEditing(true)}><PenLine/> Edit</button><button onClick={save} disabled={candidate.ambiguous||Boolean(candidate.walletRequired&&!candidate.walletId)}><Check/> Confirm & save</button></div></div>
}

function Onboarding({step,profile,setProfile,next,back,skip,connect}:{step:number;profile:CashbookProfile;setProfile:(value:CashbookProfile)=>void;next:()=>void;back:()=>void;skip:()=>boolean;connect:()=>void}){
  return <div className="onboarding-backdrop"><section className="onboarding-card" role="dialog" aria-modal="true"><div className="onboarding-brand">H</div><small>WELCOME TO HISAAB · {step} OF 3</small>{step===1&&<><h1>Choose your currency</h1><p>Hisaab will use clear English currency labels everywhere.</p><div className="currency-options">{CURRENCY_OPTIONS.map(option=><button key={option.code} className={profile.currency===option.code?"selected":""} onClick={()=>setProfile({...profile,currency:option.code})}><b>{option.prefix}</b><span>{option.code}<small>{option.label}</small></span>{profile.currency===option.code&&<Check/>}</button>)}</div></>}{step===2&&<><h1>Set up your wallet</h1><p>Choose whether this cashbook represents physical cash or a bank account.</p><div className="wallet-options"><button className={profile.walletType==="cash"?"selected":""} onClick={()=>setProfile({...profile,walletType:"cash",bankName:"",walletName:profile.walletName||"Cash"})}><WalletCards/><span><b>Cash</b><small>Physical cash wallet</small></span></button><button className={profile.walletType==="bank"?"selected":""} onClick={()=>setProfile({...profile,walletType:"bank",walletName:profile.walletName==="Cash"?"Main account":profile.walletName})}><Landmark/><span><b>Bank</b><small>Track a bank balance</small></span></button></div><div className="onboarding-fields">{profile.walletType==="bank"&&<label>Bank name<input value={profile.bankName} onChange={e=>setProfile({...profile,bankName:e.target.value})} placeholder="e.g. Meezan Bank"/></label>}<label>{profile.walletType==="bank"?"Account name":"Wallet name"}<input value={profile.walletName} onChange={e=>setProfile({...profile,walletName:e.target.value})} placeholder={profile.walletType==="bank"?"e.g. Business account":"e.g. Cash"}/></label></div></>}{step===3&&<><h1>Connect Google Sheets?</h1><p>This is optional. You can start now, keep a private cloud backup when available, and connect your own Sheet later from Settings.</p><div className="onboarding-sync"><FileSpreadsheet/><div><b>Hisaab AI Cashbook</b><small>Your existing entries will sync when you connect.</small></div></div><button className="primary-button" onClick={connect}><FileSpreadsheet/> Connect Google Sheets</button><button className="secondary-button" onClick={()=>skip()}>Skip for now</button></>} {step<3&&<div className="onboarding-actions">{step>1?<button className="secondary-button" onClick={back}>Back</button>:<span/>}<button className="primary-button" onClick={next}>Continue <ChevronRight/></button></div>}</section></div>
}
