/// <reference types="node" />

/**
 * List all ST_ORDER_INTENTS documents for the current user.
 * Usage: npx tsx scripts/verify/list-firestore-intents.ts
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

// Load firebase config from .env.local or firebase config
const envContent = readFileSync('.env.local', 'utf8');
const config: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^VITE_([A-Z_]+)=(.+)$/);
  if (match) config[match[1]] = match[2].replace(/^["']|["']$/g, '');
}

const firebaseConfig = {
  apiKey: config['FIREBASE_API_KEY'],
  authDomain: config['FIREBASE_AUTH_DOMAIN'],
  projectId: config['FIREBASE_PROJECT_ID'],
  appId: config['FIREBASE_APP_ID'],
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function main() {
  const colRef = collection(db, 'savant-trader/data/order-intents');
  const snap = await getDocs(colRef);
  console.log(`\n=== ${snap.size} documents in st_order_intents ===\n`);
  for (const doc of snap.docs) {
    const data = doc.data() as any;
    console.log(`ID: ${doc.id}`);
    console.log(`  symbol: ${data.symbol}`);
    console.log(`  side: ${data.side}`);
    console.log(`  status: ${data.status}`);
    console.log(`  source: ${data.source}`);
    console.log(`  sourceRef: ${JSON.stringify(data.sourceRef)}`);
    console.log(`  orderType: ${data.orderType}`);
    console.log(`  quantity: ${data.quantity}`);
    console.log(`  result.orderId: ${data.result?.orderId ?? '(none)'}`);
    console.log(`  result.state: ${data.result?.state ?? '(none)'}`);
    console.log(`  result.filledQuantity: ${data.result?.filledQuantity ?? '(none)'}`);
    console.log(`  result.fillPrice: ${data.result?.fillPrice ?? '(none)'}`);
    console.log(`  createdAt: ${data.createdAt}`);
    console.log(`  updatedAt: ${data.updatedAt}`);
    console.log(`  userId: ${data.userId?.slice(0, 8)}...`);
    console.log('');
  }
}

main().catch(console.error);
