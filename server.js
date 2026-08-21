const dns = require('dns');
// Fixes "querySrv ECONNREFUSED" on ISPs that block/fail SRV lookups
dns.setServers(['8.8.8.8', '1.1.1.1']);

const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URL = 'mongodb+srv://madhu:667788@annadatha.raljj9h.mongodb.net/?appName=annadatha';

app.use(express.json());
app.use(express.static(__dirname)); // serves index.html

let col;

(async () => {
  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    col = client.db('tracker').collection('locations');
    console.log('MongoDB connected');
    app.listen(PORT, () => console.log('Server on http://localhost:' + PORT));
  } catch (e) {
    console.error('Mongo error:', e.message);
    if (e.message.includes('querySrv') || e.message.includes('ECONNREFUSED')) {
      console.error('=> Cluster paused OR DNS blocked. Resume it at cloud.mongodb.com and re-run.');
    }
    process.exit(1);
  }
})();

// receive a location fix
app.post('/loc', async (req, res) => {
  try {
    const fix = req.body || {};
    fix.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    fix.received = new Date();
    const r = await col.insertOne(fix);
    res.json({ ok: true, id: r.insertedId });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// admin: all saved locations (no auth)
app.get('/api/locations', async (req, res) => {
  try {
    res.json(await col.find().sort({ _id: -1 }).limit(200).toArray());
  } catch (e) { res.status(500).json({ ok: false }); }
});