import { Component, computed, input } from '@angular/core';
import { GST_STATES, GstBuyer, GstView, money } from './billing-api';

const state = (code: string) => (GST_STATES[code] ? `${GST_STATES[code]} (${code})` : code);

/** GST registration of the seller and the guest, and the place of supply (Rule 46). */
@Component({
  selector: 'app-doc-gst-parties',
  template: `
    @if (gst(); as g) {
      <table class="gst-facts">
        <tbody>
          <tr>
            <th>Supplier GSTIN</th><td class="mono">{{ g.seller.gstin }}</td>
            <th>Place of supply</th><td>{{ stateName(g.invoice.placeOfSupply) }}</td>
          </tr>
          <tr>
            <th>Supplier</th><td>{{ g.seller.legalName }}@if (g.seller.tradeName) { ({{ g.seller.tradeName }}) }<br />
              {{ g.seller.address1 }}@if (g.seller.address2) {, {{ g.seller.address2 }} }, {{ g.seller.location }} {{ g.seller.pincode }}, {{ stateName(g.seller.stateCode) }}</td>
            <th>Recipient</th>
            <td>
              @if (buyer()?.gstin) {
                GSTIN <span class="mono">{{ buyer()!.gstin }}</span><br />{{ buyer()!.legalName }}<br />
                {{ buyer()!.address }}@if (buyer()!.location) {, {{ buyer()!.location }} } {{ buyer()!.pincode }}
              } @else {
                Unregistered (B2C)
              }
            </td>
          </tr>
        </tbody>
      </table>
    }
  `,
  styles: `
    .gst-facts { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 1rem; }
    .gst-facts th { text-align: left; color: var(--muted); font-weight: 500; width: 14%; padding: 0.25rem 0.5rem 0.25rem 0; vertical-align: top; }
    .gst-facts td { padding: 0.25rem 1rem 0.25rem 0; vertical-align: top; }
    .mono { font-family: ui-monospace, monospace; }
  `,
})
export class DocGstParties {
  readonly gst = input<GstView | null>(null);
  readonly buyer = input<GstBuyer | null>(null);
  protected readonly stateName = state;
}

/** GST lines with SAC codes and the CGST / SGST (or IGST) split, and the tax summary by rate. */
@Component({
  selector: 'app-doc-gst-lines',
  template: `
    @if (gst(); as g) {
      <table class="list">
        <thead>
          <tr><th>#</th><th>Description</th><th>SAC</th><th class="num">Qty</th><th class="num">Taxable value</th><th class="num">GST %</th>
            @if (g.invoice.intraState) { <th class="num">CGST</th><th class="num">SGST</th> } @else { <th class="num">IGST</th> }
            @if (hasCess()) { <th class="num">Cess</th> }
            @if (g.invoice.other) { <th class="num">Other</th> }
            <th class="num">Total</th></tr>
        </thead>
        <tbody>
          @for (l of g.invoice.lines; track l.slNo) {
            <tr>
              <td>{{ l.slNo }}</td><td>{{ l.label }}</td><td class="mono">{{ l.sac }}</td><td class="num">{{ l.qty }}</td>
              <td class="num">{{ m(l.taxable) }}</td><td class="num">{{ l.gstRate }}</td>
              @if (g.invoice.intraState) { <td class="num">{{ m(l.cgst) }}</td><td class="num">{{ m(l.sgst) }}</td> } @else { <td class="num">{{ m(l.igst) }}</td> }
              @if (hasCess()) { <td class="num">{{ m(l.cess + l.cessFixed) }}</td> }
              @if (g.invoice.other) { <td class="num">{{ m(l.other) }}</td> }
              <td class="num">{{ m(l.total) }}</td>
            </tr>
          }
        </tbody>
      </table>

      <div class="gst-bottom">
        <table class="list rates">
          <thead>
            <tr><th class="num">GST %</th><th class="num">Taxable value</th>
              @if (g.invoice.intraState) { <th class="num">CGST</th><th class="num">SGST</th> } @else { <th class="num">IGST</th> }</tr>
          </thead>
          <tbody>
            @for (r of g.invoice.byRate; track r.gstRate) {
              <tr><td class="num">{{ r.gstRate }}</td><td class="num">{{ m(r.taxable) }}</td>
                @if (g.invoice.intraState) { <td class="num">{{ m(r.cgst) }}</td><td class="num">{{ m(r.sgst) }}</td> } @else { <td class="num">{{ m(r.igst) }}</td> }</tr>
            }
          </tbody>
        </table>
        <dl>
          <dt>Taxable value</dt><dd>{{ m(g.invoice.taxable) }}</dd>
          @if (g.invoice.intraState) {
            <dt>CGST</dt><dd>{{ m(g.invoice.cgst) }}</dd>
            <dt>SGST</dt><dd>{{ m(g.invoice.sgst) }}</dd>
          } @else {
            <dt>IGST</dt><dd>{{ m(g.invoice.igst) }}</dd>
          }
          @if (g.invoice.cess) { <dt>Cess</dt><dd>{{ m(g.invoice.cess) }}</dd> }
          @if (g.invoice.other) { <dt>Other charges</dt><dd>{{ m(g.invoice.other) }}</dd> }
          @if (g.invoice.roundOff) { <dt>Round off</dt><dd>{{ m(g.invoice.roundOff) }}</dd> }
          <dt class="grand">{{ totalLabel() }}</dt><dd class="grand">{{ m(g.invoice.total) }}</dd>
        </dl>
      </div>
    }
  `,
  styles: `
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .list th, .list td { text-align: left; padding: 0.3rem 0.45rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    .list th { font-weight: 500; color: var(--muted); font-size: 0.78rem; }
    .list .num { text-align: right; font-variant-numeric: tabular-nums; }
    .mono { font-family: ui-monospace, monospace; }
    .gst-bottom { display: flex; justify-content: space-between; gap: 2rem; margin-top: 1rem; flex-wrap: wrap; align-items: flex-start; }
    .rates { width: auto; min-width: 280px; }
    dl { display: grid; grid-template-columns: auto auto; gap: 0.2rem 2rem; margin: 0; min-width: 280px; font-variant-numeric: tabular-nums; }
    dt { color: var(--muted); }
    dd { margin: 0; text-align: right; }
    .grand { color: var(--text); font-weight: 700; border-top: 1px solid var(--text); padding-top: 0.2rem; }
  `,
})
export class DocGstLines {
  readonly gst = input<GstView | null>(null);
  readonly totalLabel = input('Total INR');
  protected readonly hasCess = computed(() => !!this.gst()?.invoice.cess);
  protected readonly m = (n: number) => money(n, 2);
}

/** The e-invoice registration: IRN, acknowledgement and the signed QR code. */
@Component({
  selector: 'app-doc-einvoice',
  template: `
    @if (gst()?.eInvoice; as e) {
      <div class="einv" [class.cancelled]="e.status === 'cancelled'">
        @if (e.qr) { <img [src]="e.qr" alt="E-invoice QR code" /> }
        <div>
          @if (e.status === 'cancelled') { <p class="flag">E-invoice cancelled {{ e.cancelDate }}</p> }
          @if (e.sandbox) { <p class="flag">TEST PORTAL: not a registered IRN</p> }
          <p><span class="muted">IRN </span><span class="mono irn">{{ e.irn }}</span></p>
          <p><span class="muted">Ack no.</span> {{ e.ackNo }} <span class="muted">Ack date</span> {{ e.ackDate }}</p>
        </div>
      </div>
    }
  `,
  styles: `
    .einv { display: flex; gap: 0.8rem; align-items: center; margin: 0 0 1rem; font-size: 0.78rem; }
    .einv img { width: 110px; height: 110px; }
    .einv p { margin: 0 0 0.15rem; }
    .mono { font-family: ui-monospace, monospace; }
    .irn { word-break: break-all; }
    .flag { font-weight: 700; color: var(--danger); }
    .cancelled { opacity: 0.7; }
  `,
})
export class DocEInvoice {
  readonly gst = input<GstView | null>(null);
}
