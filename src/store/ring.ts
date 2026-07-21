export class RingBuffer<T> {
  private buf: T[] = [];
  dropped = 0;
  cap: number;
  private onEvict?: (item: T) => void;

  constructor(cap: number, onEvict?: (item: T) => void) {
    this.cap = cap;
    this.onEvict = onEvict;
  }

  push(item: T): void {
    this.buf.push(item);
    if (this.buf.length > this.cap) {
      const evicted = this.buf.shift() as T;
      this.dropped++;
      this.onEvict?.(evicted);
    }
  }

  setCap(n: number): void {
    this.cap = n;
    while (this.buf.length > this.cap) {
      const evicted = this.buf.shift() as T;
      this.dropped++;
      this.onEvict?.(evicted);
    }
  }

  items(): T[] {
    return [...this.buf];
  }

  last(): T | undefined {
    return this.buf[this.buf.length - 1];
  }

  clear(): void {
    this.buf = [];
    this.dropped = 0;
  }

  get size(): number {
    return this.buf.length;
  }
}
