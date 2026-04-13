// Quick test script to rebuild QQQ heatmap snapshot and capture logs
const https = require('https');

const url = 'https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin';

const data = JSON.stringify({
  data: {
    baseline: 'QQQ',
    timeframe: 'DAILY',
    year: 2026,
    half: 1
  }
});

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  }
};

const req = https.request(url, options, (res) => {
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response:', responseData);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();
