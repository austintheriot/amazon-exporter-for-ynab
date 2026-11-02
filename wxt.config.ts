import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Amazon Exporter for YNAB',
    description:
      'Match Amazon order history to YNAB transactions: item-name memos, refund attribution, and per-item splits.',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    permissions: ['storage', 'identity'],
    host_permissions: ['https://api.ynab.com/*'],
    optional_host_permissions: [
      'https://www.amazon.com/*',
      'https://amazon.com/*',
    ],
    // Pins the extension ID (dfnmlcjhckaldmfigjhjomddnffjiljc) so every
    // unpacked install shares one OAuth redirect URI. Store builds
    // (STORE_BUILD=1, `bun run zip:store`) omit it: the Chrome Web Store
    // rejects manifests containing `key` and assigns its own extension ID,
    // whose redirect URI must also be registered with the YNAB OAuth app.
    ...(process.env['STORE_BUILD']
      ? {}
      : {
          key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx6yVbtJblq8cUr2b8k9s3l2SRX2OVU6bKZPUYMZ2cnj/YGywKlqTEI+Zl5/caGLSo9VbbOeH+ncF2yqjPjohmUO7+Ur3f3Ocj0GCvscMganxc0MdAbwQgeqdrB9oArDsioz/S1xHk91BiDnMjjazdYywAM2kGIyAdFsJd4oLyrkf32gwQvpv6Q9O1WUcbm5RTQnjZILgN2rSxeSU9eDn6NuZ8Hb0Qb9nWMAXFqyB44AXy9xw48cB62IHWqVRfMGwCueq1WSMFxDOlMSl0Pl2QixHequJ4B5qCr+5VG9UEdSWJG4Fi/ZCuU+v6GXFOQpbR+jCDF3PqGeYmHH94P6PCQIDAQAB',
        }),
  },
});
