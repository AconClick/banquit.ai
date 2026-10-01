import { Component, OnDestroy, OnInit, input } from '@angular/core';
import type { PrintSetup } from '../../master/billing-setup-api';

/** Letterhead for printed documents, from the property's Print Setup. */
@Component({
  selector: 'app-doc-letterhead',
  template: `
    <div class="letterhead">
      @if (print()?.logo) { <img class="logo" [src]="print()!.logo" alt="" /> }
      <div>
        <p class="org">{{ print()?.legalName || fallbackName() }}</p>
        @if (print()?.headerLines) { <p class="muted lines">{{ print()!.headerLines }}</p> } @else { <p class="muted">{{ fallbackPlace() }}</p> }
        @if (print()?.registration) { <p class="reg">{{ print()!.registration }}</p> }
      </div>
    </div>
  `,
  styles: `
    .letterhead { display: flex; gap: 0.9rem; align-items: flex-start; }
    .letterhead p { margin: 0; }
    .logo { max-width: 180px; max-height: 64px; object-fit: contain; }
    .org { font-weight: 700; font-size: 1.15rem; }
    .lines { white-space: pre-line; font-size: 0.85rem; }
    .reg { font-size: 0.85rem; font-weight: 600; margin-top: 0.15rem; }
  `,
})
export class DocLetterhead {
  readonly print = input<PrintSetup | undefined>();
  readonly fallbackName = input('');
  readonly fallbackPlace = input('');
}

/** Bank details, terms and footer under a printed document. */
@Component({
  selector: 'app-doc-notes',
  template: `
    @if (print()?.bankDetails) { <section><h3>Bank details</h3><p>{{ print()!.bankDetails }}</p></section> }
    @if (print()?.terms) { <section><h3>Terms and conditions</h3><p>{{ print()!.terms }}</p></section> }
    @if (print()?.footer) { <p class="footer">{{ print()!.footer }}</p> }
  `,
  styles: `
    section { margin-top: 1rem; }
    h3 { font-size: 0.85rem; margin: 0 0 0.2rem; }
    p { margin: 0; white-space: pre-line; font-size: 0.8rem; color: var(--muted); }
    .footer { text-align: center; margin-top: 1.5rem; }
  `,
})
export class DocNotes {
  readonly print = input<PrintSetup | undefined>();
}

/** Sets the printed page size (A4 or Letter) while a document is open. */
@Component({ selector: 'app-doc-page-size', template: '' })
export class DocPageSize implements OnInit, OnDestroy {
  readonly size = input<'A4' | 'Letter' | undefined>('A4');
  private style?: HTMLStyleElement;

  ngOnInit() {
    this.style = document.createElement('style');
    this.style.textContent = `@page { size: ${this.size() === 'Letter' ? 'letter' : 'A4'}; margin: 14mm; }`;
    document.head.appendChild(this.style);
  }

  ngOnDestroy() {
    this.style?.remove();
  }
}
