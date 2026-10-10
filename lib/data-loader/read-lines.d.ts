export declare function forEachLine(
  file: string,
  onLine: (line: Buffer) => boolean | void,
): Promise<void>;
