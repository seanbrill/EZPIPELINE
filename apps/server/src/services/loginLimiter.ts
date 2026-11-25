/**
 * Wrong passwords, counted, so a password cannot be guessed at full speed.
 *
 * Two counts over a sliding window: per account (someone guessing one person's
 * password from many places) and per address (one place trying many accounts).
 * Past either limit, sign-in is refused until the oldest failure in the window
 * ages out. A right password clears that account's count. In memory: a restart
 * forgets, which costs an attacker a restart they cannot cause.
 */

export interface LimiterOptions { window: number; perAccount: number; perAddress: number; now?: () => number }

export function createLoginLimiter({ window, perAccount, perAddress, now = Date.now }: LimiterOptions) {
  const accounts = new Map<string, number[]>();
  const addresses = new Map<string, number[]>();
  const recent = (m: Map<string, number[]>, k: string) => {
    const t = now();
    const list = (m.get(k) ?? []).filter((x) => t - x < window);
    if (list.length) m.set(k, list); else m.delete(k);
    return list;
  };
  const key = (account: string) => account.trim().toLowerCase();

  return {
    /** Seconds until this sign-in may be tried, or 0 when it may be tried now. */
    wait(account: string, address: string): number {
      const t = now();
      const a = recent(accounts, key(account)), b = recent(addresses, address);
      const over = [a.length >= perAccount ? a[a.length - perAccount] : null, b.length >= perAddress ? b[b.length - perAddress] : null]
        .filter((x): x is number => x !== null);
      if (!over.length) return 0;
      return Math.max(1, Math.ceil((Math.max(...over) + window - t) / 1000));
    },
    failed(account: string, address: string) {
      const t = now();
      accounts.set(key(account), [...recent(accounts, key(account)), t]);
      addresses.set(address, [...recent(addresses, address), t]);
    },
    succeeded(account: string) { accounts.delete(key(account)); },
  };
}

/** The server's: 10 wrong passwords for one account, or 30 from one address, in 15 minutes. */
export const loginLimiter = createLoginLimiter({ window: 15 * 60_000, perAccount: 10, perAddress: 30 });
