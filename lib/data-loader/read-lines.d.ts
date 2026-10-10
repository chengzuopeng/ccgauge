export declare function forEachLine(
  file: string,
  onLine: (line: Buffer, end: number, terminated: boolean) => boolean | void,
  opts?: { start?: number },
): Promise<void>;
