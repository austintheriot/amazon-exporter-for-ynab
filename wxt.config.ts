import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Amazon Exporter for YNAB',
    description:
      'Match Amazon order history to YNAB transactions: item-name memos, refund attribution, and per-item splits.',
    permissions: ['storage', 'identity'],
    host_permissions: ['https://api.ynab.com/*'],
    optional_host_permissions: [
      'https://www.amazon.com/*',
      'https://amazon.com/*',
    ],
    // Pins the extension ID (obinghobhinimagmkihogflcieggmcgk) so every
    // install shares one OAuth redirect URI.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApnncYs79+1fEXAk+xjYGMxFeMenwalb0C8DeejpnTYYQ2v2qXRqCjdYpy5wZrMpWgE9iItcsWMRj3PBs28q4vYlKduZ/o8K1SHEZN7i1gx6LUuVXhsNGbQgUbatjqQR5SojokW0YVtStoi3lwRvYVEDfyxyX2qpluBcBm/3kNGVVt8lB+eCtk4J7z8leVqYQityGPvsvBZFPIwk2mRmuEJZ5e5+tvVYsZccDpqSqI+NtDiSx3OIJBjQGcYC4bzA8IrCm3t557aNGyY/0nQcJLjlfBV9uzC1fvYkQi8lTl0hPXDE/8jkjowae/A6QGZ88rqMAtPtP92nLuiP6akfEcwIDAQAB',
  },
});
