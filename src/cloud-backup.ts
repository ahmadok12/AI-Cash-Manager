import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashbookProfile } from "./profile";
import type { PersonLedger, PersonLedgerEntry, SavingsEntry, SavingsGoal } from "./planning";

export type CloudPlanningState = {
  goals: SavingsGoal[];
  savingsEntries: SavingsEntry[];
  peopleLedgers: PersonLedger[];
  ledgerEntries: PersonLedgerEntry[];
};

export type CloudCashbookState<TTransaction, TClosing> = {
  transactions: TTransaction[];
  closings: TClosing[];
  profile: CashbookProfile;
  spreadsheetId: string;
  planning: CloudPlanningState;
  updatedAt?: string;
};

export async function loadCloudCashbook<TTransaction, TClosing>(client: SupabaseClient) {
  const { data, error } = await client
    .from("cashbook_state")
    .select("transactions,closings,profile,spreadsheet_id,planning,updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    transactions: (data.transactions || []) as TTransaction[],
    closings: (data.closings || []) as TClosing[],
    profile: data.profile as CashbookProfile,
    spreadsheetId: String(data.spreadsheet_id || ""),
    planning: (data.planning || {}) as CloudPlanningState,
    updatedAt: String(data.updated_at || ""),
  } satisfies CloudCashbookState<TTransaction, TClosing>;
}

export async function saveCloudCashbook<TTransaction, TClosing>(
  client: SupabaseClient,
  userId: string,
  state: CloudCashbookState<TTransaction, TClosing>,
) {
  const { error } = await client.from("cashbook_state").upsert({
    user_id: userId,
    transactions: state.transactions,
    closings: state.closings,
    profile: state.profile,
    spreadsheet_id: state.spreadsheetId || null,
    planning: state.planning,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
}
