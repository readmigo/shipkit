const STORE_LIMITS: Record<string, { capacity: number; refillRate: number }> = {
  google_play: { capacity: 10, refillRate: 10 },
  app_store: { capacity: 10, refillRate: 2 },
  huawei_agc: { capacity: 5, refillRate: 1 },
};

const DEFAULT_LIMIT = { capacity: 10, refillRate: 5 };

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  tryConsume(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  async consume(tokens = 1): Promise<void> {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }
    const deficit = tokens - this.tokens;
    const waitMs = (deficit / this.refillRate) * 1000;
    await new Promise(resolve => setTimeout(resolve, waitMs));
    this.tokens = 0;
    this.refill();
    this.tokens -= tokens;
  }
}

export function createRateLimiter(storeId: string): RateLimiter {
  const config = STORE_LIMITS[storeId] ?? DEFAULT_LIMIT;
  return new RateLimiter(config.capacity, config.refillRate);
}
