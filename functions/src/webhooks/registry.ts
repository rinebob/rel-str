import { db } from '../firebase-admin-init';
import { PairKey } from './webhooks-config';

export async function listRegisteredPairs(): Promise<PairKey[]> {
  try {
    console.log('Fetching documents from pair-registry collection');
    const snap = await db.collection('pair-registry').get();
    console.log(`Found ${snap.size} documents in pair-registry collection`);
    
    const out: PairKey[] = [];
    for (const d of snap.docs) {
      const data = d.data() as any;
      console.log(`r lRP listRegisteredPairs.  Processing document ${d.id}:`, { 
        id: d.id,
        data: {
          ...data,
          baseline: data?.baseline,
          target: data?.target,
          active: data?.active
        }
      });
      
      if (data?.active === false) {
        console.log(`Skipping inactive pair: ${data.baseline}-${data.target}`);
        continue;
      }
      
      const baseline = String(data?.baseline || '').trim();
      const target = String(data?.target || '').trim();
      
      if (baseline && target) {
        console.log(`Adding pair: ${baseline}-${target}`);
        out.push({ baseline, target });
      } else {
        console.log(`Skipping invalid pair:`, { baseline, target, docId: d.id });
      }
    }
    
    console.log(`Returning ${out.length} valid pairs`);
    return out;
  } catch (error) {
    console.error('Error in listRegisteredPairs:', error);
    throw error;
  }
}
