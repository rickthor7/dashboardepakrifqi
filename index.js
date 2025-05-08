const express = require('express');
const http = require('http');
const path = require('path');
const bodyParser = require('body-parser');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const mysql = require('mysql2');

// Konfigurasi MQTT
const broker = 'mqtt://broker.emqx.io';
const topics = {
  earthquakeAlerts: 'earthquake/alerts',
  earthquakeMagnitude: 'earthquake/magnitude',
  heartbeatRate: 'heartbeat/rate'
};
const mqttOptions = { reconnectPeriod: 1000, username: '', password: '' };
const mqttClient = mqtt.connect(broker, mqttOptions);

// Konfigurasi koneksi ke database MySQL
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'datajam',
}).promise();

// Koding Express dan Socket.io
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/test', (req, res) => {
  res.json({ message: 'Test route works!' });
});

// Route untuk mendapatkan data dari database
app.get('/api/alerts', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM alerts ORDER BY TIMESTAMP DESC LIMIT 10');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching alerts:', err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

app.get('/api/heartbeat', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM `heartbeat rate` ORDER BY TIMESTAMP DESC LIMIT 10');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching heartbeat data:', err);
    res.status(500).json({ error: 'Failed to fetch heartbeat data' });
  }
});

app.get('/api/magnitude', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM magnitude ORDER BY TIMESTAMP DESC LIMIT 10');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching magnitude data:', err);
    res.status(500).json({ error: 'Failed to fetch magnitude data' });
  }
});

io.on('connection', (socket) => {
  console.log('New client connected');
  
  // Emit pesan test
  socket.emit('message', 'hello');
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
}); 

// Koding MQTT
mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  
  // Subscribe ke semua topik
  Object.values(topics).forEach(topic => {
    mqttClient.subscribe(topic, (err) => {
      if (err) {
        console.error('Subscription error:', err);
      } else {
        console.log(`Subscribed to topic: ${topic}`);
      }
    });
  });
});

mqttClient.on('message', async (topic, message) => {
  const data = message.toString().trim();
  console.log(`Received message on topic "${topic}":`, data);
  
  // Emit data yang diterima ke semua client yang terhubung
  io.emit(topic, data);

  // Simpan data yang diterima ke database sesuai dengan topiknya
  try {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    switch (topic) {
      case topics.earthquakeAlerts:
        await db.query('INSERT INTO alerts (DATA, TIMESTAMP) VALUES (?, ?)', [data, timestamp]);
        break;
      case topics.earthquakeMagnitude:
        // Konversi ke number untuk memastikan data numerik
        const magnitudeValue = parseFloat(data);
        if (!isNaN(magnitudeValue)) {
          await db.query('INSERT INTO magnitude (SR, TIMESTAMP) VALUES (?, ?)', [magnitudeValue, timestamp]);
        }
        break;
      case topics.heartbeatRate:
        // Konversi ke number untuk memastikan data numerik
        const heartRate = parseFloat(data);
        if (!isNaN(heartRate)) {
          await db.query('INSERT INTO `heartbeat rate` (HR, TIMESTAMP) VALUES (?, ?)', [heartRate, timestamp]);
        }
        break;
      default:
        console.log('No specific table for topic:', topic);
    }
    console.log('Data saved to database:', { topic, data });
  } catch (err) {
    console.error('Database error:', err);
  }
});

async function testDatabase() {
    try {
      // Mengambil waktu saat ini dari database
      const [now] = await db.query('SELECT NOW() AS now');
      console.log('Current time from database:', now[0].now);
  
      // Mengambil data terbaru dari tabel sensor_data
      const [rows] = await db.query('SELECT * FROM sensor_data ORDER BY timestamp DESC LIMIT 10');
      console.log('Recent sensor data:', rows);
    } catch (err) {
      console.error('Database error:', err);
    }
  }
  
  // Menjalankan fungsi untuk menguji database
  testDatabase();
  
// Di dalam file server.js Anda, tambahkan endpoint API baru:

// Endpoint untuk mendapatkan data terbaru
app.get('/api/latest-data', async (req, res) => {
  try {
    // Ambil data terbaru dari semua tabel
    const [alerts] = await db.query('SELECT * FROM alerts ORDER BY TIMESTAMP DESC LIMIT 1');
    const [heartbeat] = await db.query('SELECT * FROM `heartbeat rate` ORDER BY TIMESTAMP DESC LIMIT 1');
    const [magnitude] = await db.query('SELECT * FROM magnitude ORDER BY TIMESTAMP DESC LIMIT 1');
    
    res.json({
      success: true,
      data: {
        alerts: alerts[0] || null,
        heartbeat: heartbeat[0] || null,
        magnitude: magnitude[0] || null
      }
    });
  } catch (err) {
    console.error('Error fetching latest data:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch data' });
  }
});

// Endpoint untuk mendapatkan data historis
app.get('/api/historical-data', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const [magnitudeData] = await db.query('SELECT * FROM magnitude ORDER BY TIMESTAMP DESC LIMIT ?', [limit]);
    
    res.json({
      success: true,
      data: magnitudeData
    });
  } catch (err) {
    console.error('Error fetching historical data:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch data' });
  }
});

// ... (kode sebelumnya tetap sama)

// Endpoint untuk mendapatkan semua pesan alerts
app.get('/api/all-alerts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const [alerts] = await db.query('SELECT * FROM alerts ORDER BY TIMESTAMP DESC LIMIT ?', [limit]);
    res.json({
      success: true,
      data: alerts
    });
  } catch (err) {
    console.error('Error fetching alerts:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch alerts' });
  }
});

// ... (kode lainnya tetap sama)

mqttClient.on('message', async (topic, message) => {
  const data = message.toString().trim();
  console.log(`Received message on topic "${topic}":`, data);
  
  // Emit data ke semua client
  io.emit(topic, data);

  try {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    switch (topic) {
      case topics.earthquakeAlerts:
        await db.query('INSERT INTO alerts (DATA, TIMESTAMP) VALUES (?, ?)', [data, timestamp]);
        // Emit event dengan data lengkap termasuk ID dan timestamp
        const [result] = await db.query('SELECT * FROM alerts WHERE ID = LAST_INSERT_ID()');
        if (result.length > 0) {
          io.emit('new-alert', result[0]);
        }
        break;
        
      // ... (case lainnya tetap sama)
    }
  } catch (err) {
    console.error('Database error:', err);
  }
});

const PORT = 3002;
server.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

//kalau mau runni web di http://localhost:3002
