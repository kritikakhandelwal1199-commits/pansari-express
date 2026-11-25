/** Where each role lands after sign-in (phone app). */
import type { Href } from 'expo-router';

export const LANDING: Record<string, Href> = {
  customer: '/',
  anonymous: '/',
  temp_qr_guest: '/',
  seller: '/owner',
  staff: '/staff',
  rider: '/rider',
  compliance: '/compliance',
  super_admin: '/admin',
};
export const landing = (role: string | undefined | null): Href => LANDING[role ?? 'customer'] ?? '/';

export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  seller: 'Shop owner',
  staff: 'Staff',
  rider: 'Rider',
  compliance: 'Compliance',
  customer: 'Customer',
};
