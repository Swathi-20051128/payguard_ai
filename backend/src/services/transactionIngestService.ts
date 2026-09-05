import { Transaction } from "../models/Transaction";
import { TransactionRowInput, transactionRowSchema } from "../validation/transactionSchemas";

export interface IngestResult {
  totalRows: number;
  insertedCount: number;
  duplicateCount: number;
  invalidCount: number;
  sampleErrors: { row: number; message: string }[];
}

const MAX_SAMPLE_ERRORS = 20;
const BATCH_SIZE = 500;

/**
 * Validates and inserts a batch of raw transaction rows. Designed to
 * be called repeatedly with chunks as a CSV streams in (see csvIngest
 * .ts) or once with a full JSON array.
 *
 * Duplicate handling: MongoDB's unique index on transactionId is the
 * source of truth. We insert with `ordered: false` so one duplicate
 * (or one bad row that slipped past validation) doesn't abort the
 * whole batch, then classify each failure by its error code —
 * duplicate key (11000) vs. anything else.
 */
export async function ingestRows(
  rawRows: Record<string, unknown>[],
  rowOffset: number,
  uploadId: string,
  result: IngestResult
): Promise<void> {
  result.totalRows += rawRows.length;
  const validDocs: (TransactionRowInput & { uploadId: string })[] = [];

  rawRows.forEach((raw, i) => {
    const rowNumber = rowOffset + i + 1;
    const parsed = transactionRowSchema.safeParse(raw);
    if (!parsed.success) {
      result.invalidCount += 1;
      pushSampleError(result, rowNumber, parsed.error.issues.map((iss) => iss.message).join("; "));
      return;
    }
    validDocs.push({ ...parsed.data, uploadId });
  });

  for (let i = 0; i < validDocs.length; i += BATCH_SIZE) {
    const batch = validDocs.slice(i, i + BATCH_SIZE);
    await insertBatch(batch, result);
  }
}

async function insertBatch(
  batch: (TransactionRowInput & { uploadId: string })[],
  result: IngestResult
): Promise<void> {
  if (batch.length === 0) return;

  try {
    const inserted = await Transaction.insertMany(batch, { ordered: false });
    result.insertedCount += inserted.length;
  } catch (err) {
    // With ordered:false, MongoDB still throws once at the end, but
    // reports per-document results — successful inserts already
    // happened. writeErrors tells us which ones failed and why.
    //
    // Mongoose reshapes each write error while preserving both the
    // raw nested `.err.code`/`.err.errmsg` and (via object spread) a
    // flattened `.code`/`.errmsg` — read defensively so this doesn't
    // silently break across driver/mongoose versions.
    const bulkErr = err as {
      insertedDocs?: unknown[];
      writeErrors?: { code?: number; errmsg?: string; err?: { code?: number; errmsg?: string } }[];
    };

    const insertedCount = bulkErr.insertedDocs?.length ?? 0;
    result.insertedCount += insertedCount;

    const writeErrors = bulkErr.writeErrors ?? [];
    for (const we of writeErrors) {
      const code = we.code ?? we.err?.code;
      const errmsg = we.errmsg ?? we.err?.errmsg ?? "Write failed";
      if (code === 11000) {
        result.duplicateCount += 1;
      } else {
        result.invalidCount += 1;
        pushSampleError(result, -1, errmsg);
      }
    }

    // If the driver didn't give us structured writeErrors (shouldn't
    // normally happen with ordered:false), fall back to counting the
    // whole batch as duplicates/invalid so counts still add up.
    if (writeErrors.length === 0 && insertedCount < batch.length) {
      const unresolved = batch.length - insertedCount;
      result.duplicateCount += unresolved;
    }
  }
}

function pushSampleError(result: IngestResult, row: number, message: string) {
  if (result.sampleErrors.length < MAX_SAMPLE_ERRORS) {
    result.sampleErrors.push({ row, message });
  }
}

export function newIngestResult(): IngestResult {
  return { totalRows: 0, insertedCount: 0, duplicateCount: 0, invalidCount: 0, sampleErrors: [] };
}
