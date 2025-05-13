const express = require('express');
const http = require('http');
const path = require('path');
const bodyParser = require('body-parser');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const mysql = require('mysql2/promise');

// Konfigurasi MQTT
const broker = 'mqtt://broker.emqx.io';
const topics = {
  earthquakeAlerts: 'earthquake/alerts',
  earthquakeMagnitude: 'earthquake/magnitude',
  heartbeatRate: 'heartbeat/rate'
};
const mqttOptions = { reconnectPeriod: 1000, username: '', password: '' };
const mqttClient = mqtt.connect(broker, mqttOptions);

// Konfigurasi database MySQL
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'datajam',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let db;

// Inisialisasi aplikasi Express
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3002",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fungsi untuk menambahkan 7 jam ke timestamp
function add7HoursToTimestamp(timestamp) {
  const date = new Date(timestamp);
  date.setHours(date.getHours() + 7);
  return date;
}

// Fungsi untuk memformat waktu menjadi "time ago"
function formatTimeAgo(date) {
  const now = new Date();
  const diff = now - new Date(date);

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'Baru saja';
  if (diff < hour) return `${Math.floor(diff / minute)} menit lalu`;
  if (diff < day) return `${Math.floor(diff / hour)} jam lalu`;
  return `${Math.floor(diff / day)} hari lalu`;
}

// Fungsi untuk menambahkan pesan server
function addServerMessage(message, timestamp) {
  const emptyMessage = document.getElementById('emptyMessage');
  if (emptyMessage && emptyMessage.parentNode) {
    emptyMessage.style.display = 'none';
  }

  const template = document.getElementById('messageTemplate');
  if (!template) return;

  const clone = template.cloneNode(true);
  clone.id = '';
  clone.classList.remove('hidden');
  clone.classList.add('new-message');

  // Isi dengan data aktual
  clone.querySelector('[data-content="text"]').textContent = message;
  clone.querySelector('[data-content="time"]').textContent = formatTimeAgo(timestamp);

  const container = document.getElementById('serverMessage');
  if (container) {
    // Batasi maksimal 5 notifikasi
    const messages = container.querySelectorAll('.message-item');
    if (messages.length >= 5) {
      if (messages[messages.length - 1].parentNode === container) {
        container.removeChild(messages[messages.length - 1]);
      }
    }

    container.insertBefore(clone, container.firstChild);

    // Auto-scroll ke atas
    container.scrollTop = 0;

    // Hentikan animasi setelah 3 detik
    setTimeout(() => {
      clone.classList.remove('new-message');
    }, 3000);
  }
}

// Inisialisasi database
async function initializeDatabase() {
  try {
    db = await mysql.createPool(dbConfig);
    const [rows] = await db.query('SELECT 1');
    console.log('Koneksi database berhasil');
  } catch (err) {
    console.error('Gagal terkoneksi ke database:', err);
    process.exit(1);
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'revisigisel.html'));
});

app.get('/test', (req, res) => {
  res.json({ message: 'Test route works!' });
});

// API untuk data magnitude
app.get('/api/magnitude', async (req, res) => {
  try {
    const [magnitudeData] = await db.query('SELECT SR, latitude, longitude, kedalaman, lokasi, TIMESTAMP FROM magnitude ORDER BY TIMESTAMP DESC LIMIT 10');
    
    // Tambahkan 7 jam ke setiap timestamp
    const adjustedData = magnitudeData.map((item) => ({
      ...item,
      TIMESTAMP: add7HoursToTimestamp(item.TIMESTAMP)
    }));

    res.json({
      success: true,
      data: adjustedData
    });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil data magnitude' });
  }
});

app.get('/api/latest-magnitude', async (req, res) => {
  try {
    const [magnitude] = await db.query('SELECT * FROM magnitude ORDER BY TIMESTAMP DESC LIMIT 1');
    if (magnitude.length > 0) {
      magnitude[0].TIMESTAMP = add7HoursToTimestamp(magnitude[0].TIMESTAMP);
    }
    res.json({
      success: true,
      data: magnitude[0] || null
    });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil data magnitude terbaru' });
  }
});

app.post('/api/magnitude', async (req, res) => {
  try {
    const { SR, latitude, longitude, kedalaman, lokasi } = req.body;
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    await db.query(
      'INSERT INTO magnitude (SR, latitude, longitude, kedalaman, lokasi, TIMESTAMP) VALUES (?, ?, ?, ?, ?, ?)',
      [SR, latitude, longitude, kedalaman, lokasi, timestamp]
    );
    
    // Ambil data yang baru saja disimpan
    const [result] = await db.query('SELECT * FROM magnitude WHERE id = LAST_INSERT_ID()');
    
    // Kirim update ke semua client via Socket.io
    io.emit('magnitude-update', result[0]);
    
    res.json({
      success: true,
      data: result[0],
      message: 'Data magnitude berhasil disimpan'
    });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ success: false, error: 'Gagal menyimpan data magnitude' });
  }
});

// API lainnya (alerts dan heartbeat)
app.get('/api/alerts', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM alerts ORDER BY TIMESTAMP DESC LIMIT 10');
    res.json(rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Gagal mengambil data alerts' });
  }
});

app.get('/api/heartbeat', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM `heartbeat rate` ORDER BY TIMESTAMP DESC LIMIT 10');
    res.json(rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Gagal mengambil data heartbeat' });
  }
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Terima pesan chat dari client
  socket.on('chat-message', (message) => {
    console.log('Pesan diterima:', message);

    // Kirim pesan ke semua client
    io.emit('chat-message', message);
  });

  // Kirim data terbaru saat client terhubung
  db.query('SELECT * FROM magnitude ORDER BY TIMESTAMP DESC LIMIT 1')
    .then(([results]) => {
      if (results.length > 0) {
        const adjustedResult = {
          ...results[0],
          TIMESTAMP: add7HoursToTimestamp(results[0].TIMESTAMP)
        };
        socket.emit('latest-magnitude', adjustedResult);
      }
    })
    .catch(err => console.error('Database error:', err));
    
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// MQTT Handler
mqttClient.on('connect', () => {
  console.log('Terhubung ke MQTT broker');
  
  Object.values(topics).forEach(topic => {
    mqttClient.subscribe(topic, (err) => {
      if (err) {
        console.error('Gagal subscribe ke topic:', topic, err);
      } else {
        console.log(`Berhasil subscribe ke topic: ${topic}`);
      }
    });
  });
});

mqttClient.on('message', async (topic, message) => {
  try {
    let data = message.toString().trim();
    console.log(`Received raw message on ${topic}:`, data);

    if (!data) {
      console.log('Empty message received, skipping');
      return;
    }

    let parsedData;
    if (topic === topics.earthquakeAlerts) {
      parsedData = { message: data };
    } else {
      try {
        parsedData = JSON.parse(data);
      } catch (parseError) {
        console.error(`Failed to parse message on ${topic}:`, data);
        console.error('Parse error:', parseError.message);
        return;
      }
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

    switch (topic) {
      case topics.earthquakeAlerts:
        try {
          await db.query(
            'INSERT INTO alerts (message, TIMESTAMP) VALUES (?, ?)',
            [parsedData.message, timestamp]
          );
          io.emit('alert-update', { 
            message: parsedData.message, 
            timestamp: add7HoursToTimestamp(timestamp) // Tambahkan 7 jam
          });
          console.log('Alert berhasil disimpan dan dikirim ke frontend:', parsedData.message);
        } catch (err) {
          console.error('Error saving alert:', err);
        }
        break;

      case topics.earthquakeMagnitude:
        try {
          const SR = parseFloat(parsedData.SR);
          const latitude = parseFloat(parsedData.latitude);
          const longitude = parseFloat(parsedData.longitude);
          const kedalaman = parsedData.kedalaman ? String(parsedData.kedalaman) : 'Tidak diketahui';
          const lokasi = parsedData.lokasi ? String(parsedData.lokasi) : 'Tidak diketahui';

          if (isNaN(SR) || isNaN(latitude) || isNaN(longitude)) {
            console.error('Invalid magnitude data:', parsedData);
            return;
          }

          await db.query(
            'INSERT INTO magnitude (SR, latitude, longitude, kedalaman, lokasi, TIMESTAMP) VALUES (?, ?, ?, ?, ?, ?)',
            [SR, latitude, longitude, kedalaman, lokasi, timestamp]
          );

          const [latestMagnitude] = await db.query('SELECT * FROM magnitude ORDER BY TIMESTAMP DESC LIMIT 1');
          if (latestMagnitude.length > 0) {
            latestMagnitude[0].TIMESTAMP = add7HoursToTimestamp(latestMagnitude[0].TIMESTAMP);
            io.emit('magnitude-update', latestMagnitude[0]);
            console.log('Data magnitude berhasil disimpan:', latestMagnitude[0]);
          }
        } catch (dbError) {
          console.error('Database error saat menyimpan magnitude:', dbError);
        }
        break;
    }
  } catch (err) {
    console.error('General error processing MQTT message:', err.message);
  }
});

// Data contoh pengguna
const sampleUsers = [
  {
    name: 'Rescue Watch 1',
    sos: false,
    heartRate: 72,
    spo2: 98,
    bloodPressure: '120/80',
    lastLocation: '4.69513500, 96.74939700' // Lokasi Aceh
  },
  {
    name: 'Rescue Watch 2',
    sos: true,
    heartRate: 112,
    spo2: 95,
    bloodPressure: '140/90',
    lastLocation: '-3.23846160, 119.85254700' // Lokasi Sulawesi
  }
];

// Fungsi untuk mengirim data pengguna contoh
function sendSampleUserData() {
  io.emit('user-update', { users: sampleUsers });
}

// Jalankan server
async function startServer() {
  await initializeDatabase();
  
  const PORT = 3002;
  server.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
    
    // Kirim data contoh setiap 10 detik (untuk testing)
    setInterval(sendSampleUserData, 10000);
  });
}

startServer().catch(err => {
  console.error('Gagal menjalankan server:', err);
  process.exit(1);
});
