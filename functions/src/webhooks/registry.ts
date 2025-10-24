import { db } from '../firebase-admin-init';
import { PairKey } from './webhooks-config';

export async function listRegisteredPairs(): Promise<PairKey[]> {
  const snap = await db.collection('pair-registry').get();
  const out: PairKey[] = [];
  for (const d of snap.docs) {
    const data = d.data() as any;
    if (data?.active === false) continue;
    const baseline = String(data?.baseline || '').trim();
    const target = String(data?.target || '').trim();
    if (baseline && target) out.push({ baseline, target });
  }
  return out;
}
