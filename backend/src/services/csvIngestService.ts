import { parse } from "csv-parse";
import { Readable } from "node:stream";
import { IngestResult, ingestRows } from "./transactionIngestService";

const CHUNK_SIZE = 500;

/**
 * Streams a CSV buffer through csv-parse and hands rows to
 * ingestRows() in chunks, rather than loading the whole parsed file
 * into memory at once. This keeps memory bounded for large uploads
 * (the spec's 10k+ row synthetic datasets, or larger).
 */
export async function ingestCsvBuffer(
  buffer: Buffer,
  uploadId: string,
  result: IngestResult
): Promise<void> {
  const parser = Readable.from(buffer).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    })
  );

  let chunk: Record<string, unknown>[] = [];
  let rowOffset = 0;

  for await (const record of parser) {
    chunk.push(record);
    if (chunk.length >= CHUNK_SIZE) {
      await ingestRows(chunk, rowOffset, uploadId, result);
      rowOffset += chunk.length;
      chunk = [];
    }
  }

  if (chunk.length > 0) {
    await ingestRows(chunk, rowOffset, uploadId, result);
  }
}

/**
 * Ingests an already-parsed JSON array of transaction events (the
 * "JSON event upload" ingestion path from the spec).
 */
export async function ingestJsonArray(
  rows: Record<string, unknown>[],
  uploadId: string,
  result: IngestResult
): Promise<void> {
  const chunkSize = CHUNK_SIZE;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await ingestRows(chunk, i, uploadId, result);
  }
}
