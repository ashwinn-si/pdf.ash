import { useState, useRef } from 'react';
import {
  Upload,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import {
  verifyPdfSignatures,
  type SignatureReport,
  type CheckStatus,
} from '../utils/pdfSignatures';
import { describeFailure } from '../utils/lazyModule';

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === 'pass') return <CheckCircle2 size={18} />;
  if (status === 'fail') return <XCircle size={18} />;
  return <HelpCircle size={18} />;
}

function CheckRow({
  status,
  label,
  detail,
}: {
  status: CheckStatus;
  label: string;
  detail: string;
}) {
  const word = status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'Not checked';
  return (
    <div className={`verify-check ${status}`}>
      <span className="verify-check-icon" aria-hidden="true">
        <StatusIcon status={status} />
      </span>
      <div className="verify-check-body">
        <div className="verify-check-head">
          <strong>{label}</strong>
          <span className="verify-check-verdict">{word}</span>
        </div>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Not stated';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Not stated' : d.toLocaleString();
}

export default function VerifyPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [reports, setReports] = useState<SignatureReport[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  // The verifier's ASN.1/CMS code is code-split and fetched on first use, so
  // the wait has two distinct phases worth telling the user apart.
  const [phase, setPhase] = useState<'loading' | 'checking'>('loading');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async (selected: File) => {
    setFile(selected);
    setReports(null);
    setError('');
    setPhase('loading');
    setIsChecking(true);
    try {
      const bytes = new Uint8Array(await selected.arrayBuffer());
      setReports(await verifyPdfSignatures(bytes, () => setPhase('checking')));
    } catch (err) {
      console.error('Signature check failed:', err);
      setError(describeFailure(err, 'That file could not be read as a PDF.'));
    } finally {
      setIsChecking(false);
    }
  };

  const accept = (candidate: File | undefined) => {
    if (!candidate) return;
    if (candidate.type !== 'application/pdf' && !candidate.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF file.');
      return;
    }
    run(candidate);
  };

  return (
    <div className="unlock-panel verify-panel">
      <div className="unlock-panel-header">
        <ShieldCheck size={28} />
        <h3>Verify signatures</h3>
        <p>
          Check a signed PDF — an Aadhaar e-PDF, a digitally signed letter or
          certificate — the way a reader's signature panel does. Everything runs
          in your browser; the file is never uploaded.
        </p>
      </div>

      <div className="unlock-panel-body">
        <label
          className="signature-dropzone"
          htmlFor="verify-file"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            accept(e.dataTransfer.files[0]);
          }}
        >
          <input
            id="verify-file"
            ref={inputRef}
            className="signature-file-input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              accept(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {file ? (
            <>
              <FileText size={22} />
              <span>{file.name}</span>
            </>
          ) : (
            <>
              <Upload size={22} />
              <span>Click or drop a PDF to check its signatures</span>
            </>
          )}
        </label>

        {error && (
          <p className="verify-error">
            <AlertTriangle size={15} /> {error}
          </p>
        )}

        {isChecking && (
          <p className="verify-status">
            <Loader2 size={16} className="spinning" />
            {phase === 'loading'
              ? 'Downloading the signature verifier…'
              : 'Checking signatures…'}
          </p>
        )}

        {reports !== null && !isChecking && reports.length === 0 && (
          <div className="verify-empty">
            <HelpCircle size={18} />
            <div>
              <strong>No digital signatures found</strong>
              <p>
                This PDF carries no signature, so there is nothing to verify.
                That is not the same as it being fake — most PDFs are simply
                unsigned.
              </p>
            </div>
          </div>
        )}

        {reports?.map((r) => (
          <div className="verify-report" key={r.index}>
            <div className="verify-report-head">
              <h4>
                Signature {r.index}
                {reports.length > 1 ? ` of ${reports.length}` : ''}
              </h4>
              {r.subFilter && <span className="verify-tag">{r.subFilter}</span>}
            </div>

            <CheckRow
              status={r.integrity}
              label="Document integrity"
              detail={r.integrityDetail}
            />
            <CheckRow
              status={r.signature}
              label="Signature validity"
              detail={r.signatureDetail}
            />
            <CheckRow status={r.trust} label="Signer trust" detail={r.trustDetail} />

            {!r.coversWholeDocument && (
              <p className="verify-note">
                <AlertTriangle size={15} />
                This signature does not cover the whole file — content was added
                after it was applied. That is normal when a document is signed
                more than once, but the added part is not protected by this
                signature.
              </p>
            )}

            <dl className="verify-facts">
              <div>
                <dt>Signed by (claimed)</dt>
                <dd>{r.declaredName || r.certificate?.commonName || 'Not stated'}</dd>
              </div>
              <div>
                <dt>Signing time (claimed)</dt>
                <dd>{formatDate(r.signingTime)}</dd>
              </div>
              {r.reason && (
                <div>
                  <dt>Reason</dt>
                  <dd>{r.reason}</dd>
                </div>
              )}
              {r.location && (
                <div>
                  <dt>Location</dt>
                  <dd>{r.location}</dd>
                </div>
              )}
              {r.certificate && (
                <>
                  <div>
                    <dt>Certificate subject</dt>
                    <dd>{r.certificate.subject}</dd>
                  </div>
                  <div>
                    <dt>Issued by</dt>
                    <dd>
                      {r.certificate.issuer}
                      {r.certificate.selfSigned && (
                        <span className="verify-tag warn">self-signed</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Certificate valid</dt>
                    <dd>
                      {formatDate(r.certificate.validFrom)} – {formatDate(r.certificate.validTo)}
                    </dd>
                  </div>
                  <div>
                    <dt>Serial number</dt>
                    <dd className="verify-mono">{r.certificate.serialNumber}</dd>
                  </div>
                </>
              )}
              {r.digestAlgorithm && (
                <div>
                  <dt>Digest algorithm</dt>
                  <dd>{r.digestAlgorithm}</dd>
                </div>
              )}
            </dl>
          </div>
        ))}

        {reports !== null && reports.length > 0 && (
          <p className="verify-disclaimer">
            <AlertTriangle size={15} />
            <span>
              A passing integrity and signature check proves the file has not
              changed since someone signed it with that certificate. It does
              <strong> not</strong> prove who that someone is — that requires
              checking the certificate against a trusted authority list and a
              live revocation service, which this app does not do. For anything
              that matters, confirm in Adobe Acrobat Reader or on the issuer's
              own verification site.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
