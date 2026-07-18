import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'YNAB Amazon Matcher',
    description:
      'Match Amazon order history to YNAB transactions and enrich memos with item names.',
    permissions: ['storage'],
    host_permissions: ['https://api.ynab.com/*'],
    optional_host_permissions: [
      'https://www.amazon.com/*',
      'https://amazon.com/*',
    ],
  },
});
