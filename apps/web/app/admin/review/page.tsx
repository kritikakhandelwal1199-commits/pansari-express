'use client';
import { ListingReview } from '@/components/phase4';
import { PageHead } from '@/components/seller';

export default function AdminReview() {
  return (
    <>
      <PageHead title="Listing review" sub="New and edited products stay hidden from shoppers until approved. Check the Legal Metrology label details before approving." />
      <ListingReview />
    </>
  );
}
