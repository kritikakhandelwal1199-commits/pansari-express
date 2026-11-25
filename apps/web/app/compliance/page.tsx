'use client';
import { KycReviewQueue } from '@/components/phase4';
import { PageHead } from '@/components/seller';

export default function KycPage() {
  return (
    <>
      <PageHead title="KYC review" sub="Riders need a driving licence, vehicle RC and masked Aadhaar verified before they can go on shift. The business needs GST, FSSAI, PAN and a cancelled cheque." />
      <KycReviewQueue />
    </>
  );
}
