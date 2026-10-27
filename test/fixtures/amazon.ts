export const transactionsHtml = `
<html><body>
<form method="post" action="/cpe/yourpayments/transactions">
  <input type="hidden" name="ppw-widgetState" value="STATE_TOKEN_123" />
  <input type="hidden" name="ie" value="UTF-8" />
  <div class="apx-transaction-date-container"><span>June 28, 2026</span></div>
  <div class="apx-transactions-line-item-component-container">
    <div class="a-row"><span class="a-size-base-plus a-text-bold">Prime Visa ****1234</span>
      <span class="a-size-base-plus a-text-bold">-$70.32</span></div>
    <div class="a-row"><a class="a-link-normal" href="/gp/css/summary/edit.html?orderID=113-1111111-1111111">Order #113-1111111-1111111</a></div>
  </div>
  <div class="apx-transactions-line-item-component-container">
    <div class="a-row"><span>Prime Visa ****1234</span><span>-$27.39</span></div>
    <div class="a-row"><a href="#">Order #113-2222222-2222222</a></div>
  </div>
  <div class="apx-transaction-date-container"><span>June 25, 2026</span></div>
  <div class="apx-transactions-line-item-component-container">
    <div class="a-row"><span>Prime Visa ****1234</span><span>$12.50</span></div>
    <div class="a-row"><a href="#">Order #113-3333333-3333333</a></div>
  </div>
  <span class="a-button a-button-span12">
    <input class="a-button-input" type="submit"
      name="ppw-widgetEvent:DefaultNextPageNavigationEvent:{&quot;nextPageKey&quot;:&quot;abc&quot;}" value="" />
  </span>
</form>
</body></html>`;

export const lastPageHtml = '<html><body><form></form></body></html>';

export const legacyInvoiceHtml = `
<html><body>
  <b>Order Placed:</b> June 12, 2026<br/>
  <b>Amazon.com order number:</b> 112-1234567-7654321
  <table>
    <tr><td><b>Items Ordered</b></td><td>Price</td></tr>
    <tr><td><i>Echo Dot (5th Gen) Smart Speaker</i><br/>Sold by Amazon.com</td><td>$49.99</td></tr>
    <tr><td><i>Anker USB-C Cable 6ft (2-pack)</i></td><td>$12.99</td></tr>
  </table>
  <table>
    <tr><td>Item(s) Subtotal:</td><td>$62.98</td></tr>
    <tr><td><b>Grand Total:</b></td><td><b>$67.39</b></td></tr>
  </table>
</body></html>`;

export const modernInvoiceHtml = `
<html><body>
  <div class="" data-component="orderDateLabel"><span>Order placed</span></div>
  <div class="" data-component="orderDate">
    <span>June 28, 2026 <i class="a-icon a-icon-text-separator" role="presentation"></i></span>
  </div>
  <div class="" data-component="itemTitle">
    <div class="a-row"><a class="a-link-normal" href="/dp/B09XN6MQWP?ref_=x">15 Pack 5 Gallon Mylar Bags with Oxygen Absorbers</a></div>
  </div>
  <div class="" data-component="chargeSummary">
    <div class="a-row od-line-item-row">
      <span class="a-text-bold"><span>Grand Total:</span></span>
      <span class="a-text-bold">
        $28.98
      </span>
    </div>
  </div>
</body></html>`;

export const unparseableInvoiceHtml =
  "<html><body><h2>We're sorry!</h2></body></html>";

export const thousandsMarkupHtml = `
<html><body>
  <div class="apx-transaction-date-container"><span>June 28, 2026</span></div>
  <div class="apx-transactions-line-item-component-container">
    <div class="a-row"><span>Prime Visa ****1234</span><span>-$1,234.56</span></div>
    <div class="a-row"><a href="#">Order #113-1111111-1111111</a></div>
  </div>
</body></html>`;

export const thousandsInvoiceHtml = `
<html><body>
  <b>Order Placed:</b> June 12, 2026<br/>
  <b>Amazon.com order number:</b> 112-1234567-7654321
  <table>
    <tr><td><i>Standing Desk</i></td><td>$1,234.56</td></tr>
  </table>
  <table>
    <tr><td><b>Grand Total:</b></td><td><b>$1,234.56</b></td></tr>
  </table>
</body></html>`;

interface NextDataRow {
  formattedAmount: string;
  formattedDate?: string;
  orderDisplayString: string;
  status?: string;
}

export function buildNextDataHtml(rows: NextDataRow[]): string {
  const transactionList = rows.map((row) => ({
    formattedAmount: row.formattedAmount,
    formattedDate: row.formattedDate,
    orderData: [{ orderDisplayString: row.orderDisplayString }],
    statusInfo: row.status ? { amountDetailsStatusType: row.status } : {},
    paymentMethodDisplayStringData: {
      paymentMethodName: 'Prime Visa',
      paymentMethodNumber: { lastDigits: '1234' },
    },
  }));
  const data = {
    props: {
      pageProps: {
        state: {
          transactionResponseState: {
            visibleTransactionResponse: { transactionList },
          },
        },
      },
    },
  };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

export const nextDataHtml = buildNextDataHtml([
  {
    formattedAmount: '-$70.32',
    formattedDate: 'June 28, 2026',
    orderDisplayString: 'Order #113-1111111-1111111',
  },
  {
    formattedAmount: '$12.50',
    formattedDate: 'June 25, 2026',
    orderDisplayString: 'Order #113-3333333-3333333',
    status: 'Refund',
  },
  {
    formattedAmount: '-$9.99',
    orderDisplayString: 'Order #113-4444444-4444444',
  },
]);

export const nextDataThousandsHtml = buildNextDataHtml([
  {
    formattedAmount: '-$1,234.56',
    formattedDate: 'June 28, 2026',
    orderDisplayString: 'Order #113-1111111-1111111',
  },
]);
