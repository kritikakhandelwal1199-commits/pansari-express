'use client';
import { VENDOR_KYC_DOCS } from '@pansari/shared';
import { KycUploader } from '@/components/phase4';
import { PageHead } from '@/components/seller';

export default function BusinessKyc() {
  return (
    <>
      <PageHead title="Business KYC" sub="Documents for the selling business. The compliance team verifies them; replace any that expire (FSSAI licence renewals, for example)." />
      <div className="max-w-2xl">
        <KycUploader required={VENDOR_KYC_DOCS} title="Business documents" sub="Clear photos or PDFs, under 10 MB each." />
      </div>
    </>
  );
}
