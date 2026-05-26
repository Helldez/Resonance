export interface IClock {
  /** Unix epoch milliseconds. */
  now(): number;
}
