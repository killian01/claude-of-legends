// How many bytes a download will hand the page, for its progress bar
// (star_orchard.ts). Content-Length counts the bytes on the wire: under a
// Content-Encoding (the server's gzip twins, server/static_files.ts) those
// are the compressed ones, while the body the page reads is decoded, so
// the bar would fill two thirds of the way in and sit there. The size the
// page expected (the manifest's) is the one to count against then.

export interface HeaderReader {
  get(name: string): string | null;
}

export function downloadTotal(headers: HeaderReader, expected: number): number {
  const encoding = (headers.get('content-encoding') ?? '').trim().toLowerCase();
  if (encoding !== '' && encoding !== 'identity') return expected;
  return Number(headers.get('content-length')) || expected;
}
