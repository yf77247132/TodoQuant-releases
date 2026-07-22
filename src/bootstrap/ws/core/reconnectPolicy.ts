export const calculateBackoffDelayCore = (attempt: number): number => {
  const baseDelay = 1000;
  const maxDelay = 30000;
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = exponentialDelay * 0.2 * (Math.random() - 0.5);
  return Math.floor(exponentialDelay + jitter);
};
