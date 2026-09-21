export interface ReceiptData {
  orderNumber: string;
  createdAt?: string;
  customerName: string;
  fulfillmentType?: string;
  totalRs: string | number;
  items: { quantity: number; name: string; unitPriceRs?: number }[];
}

/**
 * Opens a small popup styled for a 58mm thermal receipt and triggers
 * the browser's own print dialog — the person picks their real,
 * already-installed printer there (e.g. "POS58 Printer"), exactly
 * like printing any other webpage. Works on any laptop/desktop with
 * the printer set up as a normal Windows printer; no Bluetooth, no
 * Android app, no special browser permission needed.
 */
export function printReceipt(data: ReceiptData) {
  const printWindow = window.open('', '_blank', 'width=380,height=600');
  if (!printWindow) {
    alert('Please allow pop-ups for this site so the print window can open.');
    return;
  }

    const itemsHtml = data.items
    .map((item) => {
      const priceHtml =
        item.unitPriceRs !== undefined
          ? `<span>₹${(item.unitPriceRs * item.quantity).toFixed(0)}</span>`
          : '';
      return `<div class="item-line" style="display:flex;justify-content:space-between;"><span>${item.quantity} x ${escapeHtml(item.name)}</span>${priceHtml}</div>`;
    })
    .join('');

  printWindow.document.write(`
    <html>
      <head>
        <title>Receipt #${data.orderNumber}</title>
        <style>
          @page { size: 58mm auto; margin: 0; }
          * { box-sizing: border-box; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 13px;
            line-height: 1.5;
            width: 58mm;
            margin: 0;
            padding: 3mm 3mm 6mm;
            color: #000;
          }
          .logo {
            display: block;
            width: 22mm;
            height: 22mm;
            object-fit: contain;
            margin: 0 auto 2mm;
          }
          .brand-name {
            text-align: center;
            font-weight: 800;
            font-size: 18px;
            letter-spacing: 0.5px;
            margin-bottom: 3mm;
          }
          .divider {
            border-top: 1px dashed #000;
            margin: 2mm 0;
          }
          .meta-line {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            margin-bottom: 1mm;
          }
          .item-line {
            font-size: 13px;
            margin-bottom: 1mm;
          }
          .total-line {
            display: flex;
            justify-content: space-between;
            font-weight: 800;
            font-size: 15px;
            margin-top: 2mm;
          }
          .thank-you {
            text-align: center;
            margin-top: 4mm;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <img src="/brand/logo.jpg" class="logo" onerror="this.style.display='none'" />
        <div class="brand-name">PROTEIN PANDA</div>
        <div class="divider"></div>
        <div class="meta-line"><span>Order</span><span>#${escapeHtml(data.orderNumber)}</span></div>
        ${data.createdAt ? `<div class="meta-line"><span>Date</span><span>${new Date(data.createdAt).toLocaleString()}</span></div>` : ''}
        <div class="meta-line"><span>Customer</span><span>${escapeHtml(data.customerName)}</span></div>
        ${data.fulfillmentType ? `<div class="meta-line"><span>Type</span><span>${escapeHtml(data.fulfillmentType)}</span></div>` : ''}
        <div class="divider"></div>
        ${itemsHtml}
        <div class="divider"></div>
        <div class="total-line"><span>TOTAL</span><span>Rs ${data.totalRs}</span></div>
        <div class="thank-you">Thank you for choosing us!</div>
      </body>
    </html>
  `);
  printWindow.document.close();

  // onload with document.write-based content is inconsistent across
  // browsers — a short, fixed delay before printing is the reliable
  // approach here, also giving the logo image time to actually load
  // before the print dialog captures the page.
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 400);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
