import { Injectable } from '@nestjs/common';
import { resolveTxt } from 'node:dns/promises';

/** Looks up DNS TXT records. A class of its own so tests can answer without the internet. */
export abstract class DnsLookup {
  abstract txt(name: string): Promise<string[]>;
}

@Injectable()
export class NodeDnsLookup extends DnsLookup {
  async txt(name: string) {
    // A TXT record can be split into several strings; join them back into one value each.
    return (await resolveTxt(name)).map((parts) => parts.join(''));
  }
}

export const VERIFY_PREFIX = '_banquet-verify';
