'use client';
import { ListingReview } from '@/components/phase4';
import { PageHead } from '@/components/seller';

export default function ComplianceListings() {
  return (
    <>
      <PageHead title="Listing review" sub="Check net quantity, manufacturer, origin and HSN against the pack label before approving. Approved listings show to shoppers." />
      <ListingReview />
    </>
  );
}
