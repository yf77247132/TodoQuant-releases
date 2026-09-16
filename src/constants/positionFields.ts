
export type PositionSide = 'long' | 'short' | 'net';

export const POS_SIDE_LABELS: Record<PositionSide, string> = {
  long: 'position.long',
  short: 'position.short',
  net: 'position.net',
};

export const POS_SIDE_OPTIONS_FILTERED: ReadonlyArray<{
  value: Exclude<PositionSide, 'net'>;
  label: string;
}> = [
  { value: 'long', label: 'long' },
  { value: 'short', label: 'short' },
];
