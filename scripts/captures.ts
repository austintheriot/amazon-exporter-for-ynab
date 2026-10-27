import { z } from 'zod/mini';
import { invoiceCapturesSchema } from '../lib/core/amazon';

export type InvoiceCapture = z.infer<typeof invoiceCapturesSchema>[number];

const captureFileSchema = z.union([
  invoiceCapturesSchema,
  z.object({ captures: invoiceCapturesSchema }),
]);

export type CaptureFileResult =
  | { success: true; captures: InvoiceCapture[] }
  | { success: false; message: string };

/** Accepts the popup's `{ captures, scanDebug }` export and the older bare array. */
export function parseCaptureFile(raw: unknown): CaptureFileResult {
  const parsed = captureFileSchema.safeParse(raw, { error: z.locales.en().localeError });
  if (!parsed.success) return { success: false, message: z.prettifyError(parsed.error) };
  const captures = Array.isArray(parsed.data) ? parsed.data : parsed.data.captures;
  return { success: true, captures };
}
