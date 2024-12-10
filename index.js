require('dotenv').config();
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const express = require('express'); // Import Express
const { Connector } = require('@google-cloud/cloud-sql-connector');
const { Pool } = require('pg');

const app = express(); // Membuat instance dari Express
const PORT = process.env.PORT || 3000; // Menentukan port

// Koneksi database PostgreSQL ke GCP
const connector = new Connector();

async function initializeDatabase() {
  const clientOpts = await connector.getOptions({
    instanceConnectionName: process.env.INSTANCE_CONNECTION_NAME,
    authType: 'IAM'
  });

  // Konfigurasi koneksi
  const pool = new Pool({
    ...clientOpts,
    user: process.env.PG_USER,
    database: process.env.PG_NAME,
    password: process.env.PG_PASSWORD,    
  });

  // Tes koneksi ke PostgreSQL
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('Connected to PostgreSQL:', res.rows[0]);
  } catch (err) {
    console.error('Error connecting to PostgreSQL:', err);
  }

  return pool;
}

// Menjalankan server
initializeDatabase().then(pool => {
  app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
    
    // Simpan pool ke dalam konteks aplikasi jika diperlukan
    app.set('dbPool', pool);
  });
}).catch(err => {
  console.error('Database initialization failed:', err);
});




// Endpoint default untuk root URL (http://localhost:3000)
app.get('/', (req, res) => {
  res.send('Server berjalan dengan baik!');
});

let users = []; // Database sementara untuk menyimpan pengguna

app.use(express.urlencoded({ extended: true })); // Middleware untuk mengolah form data
app.use(express.json()); // Middleware untuk mengubah request body ke JSON
// Endpoint untuk register user
app.post('/register', async (req, res) => {
  
  try{
    const {username, email, password} = await req.body
    console.log(req.body)
    
    const pool = app.get('dbPool')
    const checkEmail = await pool.query(
      "SELECT * FROM users WHERE email = $1", [email]
    )
  
    console.log(checkEmail.rows)
    console.log(checkEmail.rows.length)
    if(checkEmail.rows.length > 0){
      return res.status(409).json({
        message: 'Email sudah terdaftar !',
      })
    }

    const hashedPassword = await bcrypt.hash(password, 10)    
    const id = Math.floor(Math.random() * 100) + 1
    const register = await pool.query(
      "INSERT INTO users (id,username,email,password) VALUES ($1,$2,$3,$4) RETURNING *", [id, username, email, hashedPassword]
    )
    const result = register.rows[0]
    return res.status(201).json({
      message: "Registrasi berhasil",   
      data: {
        id,
        username,
        email
      }
    })

  }catch(e){
    console.error('Error registering user: ', e)
    return res.status(500).json({
      message: 'Internal server error'
    })
  }
});

// Endpoint untuk login user
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const pool = app.get('dbPool')

  try{
    // $1 adalah placeholder untuk variable pertama
    const checkEmail = await pool.query(
      "SELECT * FROM users WHERE email = $1", [email]
    )
    const user = checkEmail.rows[0]
    const comparePass = user ? await bcrypt.compare(password, user.password) : null
    
    if(user && comparePass){
      const token = jwt.sign({id: user.id, username: user.username}, process.env.JWT_SECRET, {
        expiresIn: '30d'
      })

      res.status(200).json({
        message: 'Login Berhasil',
        username: user.username,
        email: user.email,
        token: token
      })
    }else{
      res.status(401).json({
        message: 'Username atau password salah',
        username: null,
        email: null,
        token: null
      })
    }

  }catch(err){
    console.error('Error loggin in user:', err)
    res.status(500).json({
      message: 'Internal Server Error',
      username: null,
      email: null,
      token: null
    })
  }
});

// Endpoint untuk mendapatkan user berdasarkan id
app.get('/user/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ message: 'User tidak ditemukan' });
  }
});




// Endpoint VertexAI
const {VertexAI} = require('@google-cloud/vertexai')
const serviceAccount = require('./service-account-vertex-ai.json')


// const authClient = await gAuth.getClient()
const vertex_ai = new VertexAI({
  project: '364565880018', 
  location: 'us-central1',
  googleAuthOptions: {
    credentials: serviceAccount
  }
});
const model = 'projects/364565880018/locations/us-central1/endpoints/7103101301642231808';

// Instantiate the models
const generativeModel = vertex_ai.preview.getGenerativeModel({
  model: model,
  generationConfig: {
    'maxOutputTokens': 8192,
    'temperature': 1,
    'topP': 0.95,
  },
  safetySettings: [
    {
      'category': 'HARM_CATEGORY_HATE_SPEECH',
      'threshold': 'OFF',
    },
    {
      'category': 'HARM_CATEGORY_DANGEROUS_CONTENT',
      'threshold': 'OFF',
    },
    {
      'category': 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'threshold': 'OFF',
    },
    {
      'category': 'HARM_CATEGORY_HARASSMENT',
      'threshold': 'OFF',
    }
  ],
});

// Endpoint untuk generate fun fact
app.post('/generatefunfact', async (req, res) => {
  try {
    const { category } = req.body;

    // Memastikan category diterima dari body request
    if (!category) {
      return res.status(400).json({ message: "Category is required" });
    }

    // Menggunakan chat API untuk mendapatkan fun fact
    const request = {
      contents: [
        {role: 'user', parts: [{text: `berikan 10 funfact tentang sampah ${category} di indonesia, dibungkus menjadi deskripsi`}]}
      ]
    }

    // Mengambil hasil dari response
    const result = await generativeModel.generateContent(request)
    const funFact = result.response.candidates[0]?.content;

    if (!funFact) {
      return res.status(500).json({ message: "Failed to generate fun fact" });
    }    
            
    // Mengirim hasil sebagai respons ke klien
    res.status(200).json({ funFact });
  } catch (error) {
    console.error("Error generating fun fact:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


