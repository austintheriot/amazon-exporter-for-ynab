import { describe, expect, it } from 'vitest';
import { parseCaptureFile } from './captures';

const capture = { orderId: '113-1111111-1111111', html: '<html></html>' };

describe('parseCaptureFile', () => {
  it('reads the popup export shape', () => {
    const popupExport = {
      captures: [
        {
          ...capture,
          requestedUrl: 'https://www.amazon.com/gp/css/summary/print.html',
          finalUrl: 'https://www.amazon.com/gp/css/summary/print.html',
          status: 200,
        },
      ],
      scanDebug: null,
    };
    expect(parseCaptureFile(popupExport)).toEqual({ success: true, captures: [capture] });
  });

  it('reads a bare array of captures', () => {
    expect(parseCaptureFile([capture])).toEqual({ success: true, captures: [capture] });
  });

  it('rejects a capture without html', () => {
    const result = parseCaptureFile({ captures: [{ orderId: '113-1' }], scanDebug: null });
    expect(result.success).toBe(false);
  });
});
