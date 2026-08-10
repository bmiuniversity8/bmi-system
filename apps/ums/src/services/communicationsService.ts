/**
 * BMI UMS – Communications Center Service
 * Backs the dispatch ledger with real API data instead of localStorage mocks.
 */
import { authFetch } from './authService';
import { API_URL } from './config';

export interface CommunicationRecord {
  id: string;
  type: 'SMS' | 'Email';
  channel: 'sms' | 'email' | 'whatsapp';
  recipient: string;
  subject?: string | null;
  body: string;
  status: 'Delivered' | 'Pending' | 'Failed';
  sent_by?: string | null;
  sent_by_name?: string | null;
  created_at: string;
}

export interface CommunicationsListResponse {
  success: boolean;
  data?: CommunicationRecord[];
  total?: number;
  error?: string;
}

export async function listCommunications(params?: {
  type?: string;
  page?: number;
  perPage?: number;
}): Promise<CommunicationsListResponse> {
  try {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.perPage) qs.set('perPage', String(params.perPage));
    const url = `${API_URL}/communications${qs.toString() ? `?${qs.toString()}` : ''}`;
    const response = await authFetch(url, {}, 8000);
    const data = await response.json();
    return { success: response.ok, data: data?.data, total: data?.total, error: data?.error };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch communications' };
  }
}

export async function createCommunication(input: {
  type: 'SMS' | 'Email';
  channel: 'sms' | 'email' | 'whatsapp';
  recipient: string;
  subject?: string;
  body: string;
  status?: 'Delivered' | 'Pending' | 'Failed';
}): Promise<{ success: boolean; data?: CommunicationRecord; error?: string }> {
  try {
    const response = await authFetch(`${API_URL}/communications`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const data = await response.json();
    if (response.ok && data?.success) return { success: true, data: data.data };
    return { success: false, error: data?.error || 'Failed to record communication' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to record communication' };
  }
}

export async function deleteCommunication(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_URL}/communications/${id}`, { method: 'DELETE' });
    const data = await response.json().catch(() => null);
    return { success: response.ok, error: !response.ok ? (data?.error || 'Failed to delete record') : undefined };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete record' };
  }
}