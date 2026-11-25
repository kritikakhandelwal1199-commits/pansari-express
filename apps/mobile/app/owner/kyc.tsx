import { ScrollView, Text } from 'react-native';
import { VENDOR_KYC_DOCS } from '@pansari/shared';
import { KycUploader } from '@/components/role';

export default function BusinessKyc() {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <Text className="text-sm text-muted">Documents for the selling business. The compliance team verifies them; replace any that expire (FSSAI renewals, for example).</Text>
      <KycUploader required={VENDOR_KYC_DOCS} />
    </ScrollView>
  );
}
