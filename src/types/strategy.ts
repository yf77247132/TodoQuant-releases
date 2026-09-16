
export type ScriptType =
  | 'trader'
  | 'amend'
  | 'cancel'
  | 'close'
  | 'margin'
  | 'diy';

export interface ScriptState {
  timer: NodeJS.Timeout | null;
  running: boolean;
  type: ScriptType;
  config?: ModuleConfig;
}

export interface ModuleConfig {
  id?: string;
  name?: string;
  account_id?: string;
  inst_id?: string;
  amend_inst_id?: string;
  amend_loop_execution?: boolean;
  margin_loop_execution?: boolean;
  check_interval?: string;
  margin_guard_check_interval?: string;
  margin_guard_max_rounds?: string;
  triggerId?: string;
  actionId?: string;
  [key: string]: unknown;
}

export interface StrategyError extends Error {
  source: string;
  code?: string;
}
