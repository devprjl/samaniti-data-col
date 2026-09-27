import { loadEtlData } from '../../../core/db/loader.js';
import { EtlPayload } from '../../../core/types/domain.js';

export async function load(data: EtlPayload): Promise<{ itemsAdded: number; itemsUpdated: number }> {
  return await loadEtlData(data);
}

