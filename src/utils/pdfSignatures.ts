/**
 * Digital signature inspection for PDFs — the check Adobe Reader surfaces as
 * its "Signature panel" banner on documents like an Aadhaar e-PDF.
 *
 * Three independent questions get three independent answers, because only the
 * first two can be settled inside a browser with no backend:
 *
 *   1. INTEGRITY — do the bytes still hash to what was signed? Answers
 *      "has this file been altered since it was signed?".
 *   2. SIGNATURE — does the CMS signature verify against the public key in the
 *      embedded signer certificate? Answers "was this made by whoever holds
 *      that certificate's private key?".
 *   3. TRUST — is that certificate one anyone should believe, and was it still
 *      valid and unrevoked at signing time? This needs a trust store plus
 *      OCSP/CRL lookups, so it is always reported as NOT CHECKED.
 *
 * Layers 1 and 2 passing does NOT mean a document is genuine: anyone can sign
 * a forgery with a self-issued certificate and satisfy both. Never collapse
 * these into a single green verdict.
 */

export type CheckStatus = 'pass' | 'fail' | 'unknown';

export interface CertificateInfo {
  subject: string;
  issuer: string;
  commonName: string;
  organisation: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  selfSigned: boolean;
}

export interface SignatureReport {
  /** Index of this signature within the document, 1-based. */
  index: number;
  /** From the signature dictionary, not the certificate — unauthenticated. */
  declaredName: string;
  reason: string;
  location: string;
  contactInfo: string;
  /** Signing time claimed by the signature dictionary (/M). */
  signingTime: string | null;
  subFilter: string;

  integrity: CheckStatus;
  signature: CheckStatus;
  /** Always 'unknown' — see the module comment. */
  trust: CheckStatus;

  /** Per-check human-readable detail, shown under each row. */
  integrityDetail: string;
  signatureDetail: string;
  trustDetail: string;

  /**
   * True when the signature's ByteRange does not span the whole file, i.e.
   * content was appended after signing. Legitimate for multi-signature
   * workflows, but worth surfacing.
   */
  coversWholeDocument: boolean;

  certificate: CertificateInfo | null;
  digestAlgorithm: string;
}

interface RawSignature {
  byteRange: number[];
  contents: Uint8Array;
  declaredName: string;
  reason: string;
  location: string;
  contactInfo: string;
  signingTime: string | null;
  subFilter: string;
}

/** PDF date strings look like D:20240115103000+05'30'. */
function parsePdfDate(raw: string): string | null {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s)
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decodePdfString(raw: string): string {
  // Literal strings may be hex-encoded, and UTF-16BE text starts with a BOM.
  if (/^[0-9A-Fa-f\s]*$/.test(raw) && raw.length % 2 === 0 && raw.length > 0) {
    const bytes = new Uint8Array(raw.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(raw.substr(i * 2, 2), 16);
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      let out = '';
      for (let i = 2; i + 1 < bytes.length; i += 2) {
        out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      }
      return out.replace(/\0+$/, '');
    }
    return new TextDecoder('latin1').decode(bytes).replace(/\0+$/, '');
  }
  return raw.replace(/\\([nrtbf()\\])/g, (_, c) =>
    ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c as string] ?? c)
  );
}

/**
 * Locate signature dictionaries by scanning the raw bytes.
 *
 * Deliberately not going through pdf-lib's object graph: a signed PDF is
 * usually a chain of incremental updates, and the byte offsets in /ByteRange
 * only mean anything against the original file. Re-serialising would
 * invalidate every signature before we could check it.
 */
export function findSignatures(bytes: Uint8Array): RawSignature[] {
  const latin1 = new TextDecoder('latin1').decode(bytes);
  const found: RawSignature[] = [];

  // Every signature value dictionary carries a /ByteRange and a /Contents.
  const byteRangeRe = /\/ByteRange\s*\[\s*([\d\s]+?)\s*\]/g;
  let match: RegExpExecArray | null;

  while ((match = byteRangeRe.exec(latin1)) !== null) {
    const byteRange = match[1].trim().split(/\s+/).map(Number);
    if (byteRange.length < 4 || byteRange.some((n) => !Number.isFinite(n))) continue;

    // /Contents is the hex-encoded CMS blob; it sits in the same dictionary,
    // usually right after /ByteRange but occasionally before it.
    const windowStart = Math.max(0, match.index - 4000);
    const windowEnd = Math.min(latin1.length, match.index + 120000);
    const region = latin1.slice(windowStart, windowEnd);
    const contentsMatch = /\/Contents\s*<([0-9A-Fa-f\s]+)>/.exec(region);
    if (!contentsMatch) continue;

    const hex = contentsMatch[1].replace(/\s+/g, '');
    const raw = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < raw.length; i++) {
      raw[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    // /Contents is zero-padded to a fixed reserved length; trim the tail.
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end--;

    const readName = (key: string) => {
      const re = new RegExp(`/${key}\\s*(?:\\(([^)]*)\\)|<([0-9A-Fa-f\\s]*)>)`);
      const m = re.exec(region);
      return m ? decodePdfString(m[1] ?? m[2] ?? '') : '';
    };
    const subFilterMatch = /\/SubFilter\s*\/([\w.]+)/.exec(region);
    const dateRaw = readName('M');

    found.push({
      byteRange,
      contents: raw.subarray(0, end),
      declaredName: readName('Name'),
      reason: readName('Reason'),
      location: readName('Location'),
      contactInfo: readName('ContactInfo'),
      signingTime: dateRaw ? parsePdfDate(dateRaw) : null,
      subFilter: subFilterMatch ? subFilterMatch[1] : '',
    });
  }

  return found;
}

/** Concatenate the byte spans the signature actually covers. */
function signedBytes(bytes: Uint8Array, byteRange: number[]): Uint8Array {
  let total = 0;
  for (let i = 0; i < byteRange.length; i += 2) total += byteRange[i + 1];
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < byteRange.length; i += 2) {
    const start = byteRange[i];
    const length = byteRange[i + 1];
    out.set(bytes.subarray(start, start + length), offset);
    offset += length;
  }
  return out;
}

const DIGEST_OIDS: Record<string, string> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function nameToString(name: { typesAndValues: { type: string; value: { valueBlock: { value: string } } }[] }): string {
  const OIDS: Record<string, string> = {
    '2.5.4.3': 'CN',
    '2.5.4.6': 'C',
    '2.5.4.7': 'L',
    '2.5.4.8': 'ST',
    '2.5.4.10': 'O',
    '2.5.4.11': 'OU',
    '1.2.840.113549.1.9.1': 'E',
  };
  return name.typesAndValues
    .map((tv) => `${OIDS[tv.type] ?? tv.type}=${tv.value.valueBlock.value}`)
    .join(', ');
}

function attributeOf(
  name: { typesAndValues: { type: string; value: { valueBlock: { value: string } } }[] },
  oid: string
): string {
  const hit = name.typesAndValues.find((tv) => tv.type === oid);
  return hit ? hit.value.valueBlock.value : '';
}

/**
 * Inspect every signature in a PDF. pkijs is imported lazily so the CMS/ASN.1
 * machinery is only downloaded when someone actually opens this tool.
 */
export async function verifyPdfSignatures(
  bytes: Uint8Array,
  /** Called once the code-split CMS parser is in and checking begins. */
  onReady?: () => void
): Promise<SignatureReport[]> {
  const raw = findSignatures(bytes);
  if (raw.length === 0) return [];

  const [pkijs, asn1js] = await Promise.all([import('pkijs'), import('asn1js')]);
  onReady?.();
  const reports: SignatureReport[] = [];

  for (let i = 0; i < raw.length; i++) {
    const sig = raw[i];
    const report: SignatureReport = {
      index: i + 1,
      declaredName: sig.declaredName,
      reason: sig.reason,
      location: sig.location,
      contactInfo: sig.contactInfo,
      signingTime: sig.signingTime,
      subFilter: sig.subFilter,
      integrity: 'unknown',
      signature: 'unknown',
      trust: 'unknown',
      integrityDetail: '',
      signatureDetail: '',
      trustDetail:
        'Not checked. Confirming who the signer really is needs a trusted ' +
        'certificate authority list and a live revocation (OCSP/CRL) lookup, ' +
        'neither of which this browser-only app performs.',
      coversWholeDocument: false,
      certificate: null,
      digestAlgorithm: '',
    };

    // A ByteRange ending before EOF means bytes were appended after signing.
    const last = sig.byteRange[sig.byteRange.length - 2] + sig.byteRange[sig.byteRange.length - 1];
    report.coversWholeDocument = last >= bytes.length - 1;

    try {
      const asn1 = asn1js.fromBER(sig.contents.slice().buffer);
      if (asn1.offset === -1) throw new Error('Signature is not valid DER.');

      const contentInfo = new pkijs.ContentInfo({ schema: asn1.result });
      const signedData = new pkijs.SignedData({ schema: contentInfo.content });
      const signerInfo = signedData.signerInfos[0];
      if (!signerInfo) throw new Error('No signer information in the signature.');

      const digestOid = signerInfo.digestAlgorithm.algorithmId;
      const hashName = DIGEST_OIDS[digestOid] ?? 'SHA-256';
      report.digestAlgorithm = DIGEST_OIDS[digestOid] ?? digestOid;

      // --- Layer 1: integrity -------------------------------------------
      const covered = signedBytes(bytes, sig.byteRange);
      const computed = new Uint8Array(
        await crypto.subtle.digest(hashName, covered.slice().buffer)
      );

      const messageDigestAttr = signerInfo.signedAttrs?.attributes.find(
        (a: { type: string }) => a.type === '1.2.840.113549.1.9.4'
      );

      if (messageDigestAttr) {
        const embedded = new Uint8Array(
          messageDigestAttr.values[0].valueBlock.valueHexView ??
            messageDigestAttr.values[0].valueBlock.valueHex
        );
        const ok = equalBytes(embedded, computed);
        report.integrity = ok ? 'pass' : 'fail';
        report.integrityDetail = ok
          ? `The ${report.digestAlgorithm} digest of the signed bytes matches the one inside the signature — the covered content is unchanged.`
          : `The ${report.digestAlgorithm} digest of the file does not match the one inside the signature. The document has been altered since it was signed.`;
      } else {
        report.integrityDetail =
          'The signature carries no messageDigest attribute, so the content hash could not be compared.';
      }

      // --- Layer 2: cryptographic validity -------------------------------
      // Kept in its own try: pkijs throws on a genuine mismatch rather than
      // returning false, and a failed verification is a definite FAIL, not the
      // "could not evaluate" that the outer handler reports.
      try {
        const verified = await signedData.verify({
          signer: 0,
          data: covered.slice().buffer,
          checkChain: false,
          extendedMode: false,
        });
        const ok =
          verified === true ||
          (verified as unknown as { signatureVerified?: boolean })?.signatureVerified === true;
        report.signature = ok ? 'pass' : 'fail';
        report.signatureDetail = ok
          ? 'The signature verifies against the public key in the embedded certificate.'
          : 'The signature does not verify against the embedded certificate.';
      } catch (verifyErr) {
        const message = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        // An unsupported algorithm means we could not judge; anything else at
        // this point means the check ran and did not pass.
        const unsupported = /unsupported|not supported|unknown algorithm/i.test(message);
        report.signature = unsupported ? 'unknown' : 'fail';
        report.signatureDetail = unsupported
          ? `This signature uses an algorithm this browser cannot verify (${message}).`
          : `Verification failed: ${message}.`;
      }

      // --- Certificate details -------------------------------------------
      const cert =
        signedData.certificates?.find(
          (c: unknown): c is InstanceType<typeof pkijs.Certificate> =>
            c instanceof pkijs.Certificate
        ) ?? null;

      if (cert) {
        const subject = nameToString(cert.subject);
        const issuer = nameToString(cert.issuer);
        report.certificate = {
          subject,
          issuer,
          commonName: attributeOf(cert.subject, '2.5.4.3'),
          organisation: attributeOf(cert.subject, '2.5.4.10'),
          serialNumber: Array.from(
            new Uint8Array(
              cert.serialNumber.valueBlock.valueHexView ?? cert.serialNumber.valueBlock.valueHex
            )
          )
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(':'),
          validFrom: cert.notBefore.value.toISOString(),
          validTo: cert.notAfter.value.toISOString(),
          selfSigned: subject === issuer,
        };
        if (report.certificate.selfSigned) {
          report.trustDetail =
            'Not checked — and note this certificate is self-signed, meaning ' +
            'no certificate authority vouches for it. ' +
            report.trustDetail;
        }
      }
    } catch (err) {
      // Only reached when the CMS blob itself could not be read, so nothing
      // was actually judged either way.
      report.signature = 'unknown';
      report.signatureDetail =
        err instanceof Error
          ? `This signature could not be read: ${err.message}`
          : 'This signature could not be read.';
    }

    reports.push(report);
  }

  return reports;
}
