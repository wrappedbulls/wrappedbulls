// Client-safe deterministic PRNG. Pure JS, no Node deps. Same seed
// produces the same sequence in Node and the browser, so wizard
// preview rendering can match server side production rendering.

export class PRNG {
  private state: bigint;
  constructor(seed: bigint) {
    // xorshift64 collapses at state=0. Salt with a non zero constant so
    // a seed of 0 still produces a usable sequence.
    this.state = seed === 0n ? 0x123456789ABCDEF0n : seed;
  }
  /** Advance state, return the new 64 bit raw word. */
  nextU64(): bigint {
    let x = this.state;
    x = x ^ (x << 13n);
    x = x & 0xFFFFFFFFFFFFFFFFn;
    x = x ^ (x >> 7n);
    x = x ^ (x << 17n);
    x = x & 0xFFFFFFFFFFFFFFFFn;
    this.state = x;
    return x;
  }
  /** Uniform integer in [0, max). max must be > 0. */
  nextInt(max: number): number {
    if (max <= 0) throw new Error("PRNG.nextInt: max must be > 0");
    return Number(this.nextU64() % BigInt(max));
  }
  /** Uniform float in [0, 1). */
  nextFloat(): number {
    // top 53 bits over 2^53 = uniform [0, 1).
    return Number(this.nextU64() >> 11n) / 2 ** 53;
  }
  /** Pick one element from a non empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("PRNG.pick: empty array");
    return arr[this.nextInt(arr.length)];
  }
}
