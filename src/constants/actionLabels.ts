import { ActionType } from '../types/diy.ts';

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  place_order: 'action.place',
  amend_order: 'action.amend',
  cancel_order: 'action.cancel',
  close_pos: 'action.close',
  prevent_margin_risk: 'action.transfer',
  stop_strategy: 'action.stop',
  notify: 'action.notify',
  transfer: 'action.transfer',
};
