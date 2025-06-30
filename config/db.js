import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Neon requires SSL
  },
});


pool.connect()
  .then(() => {
    console.log('✅ PostgreSQL connected successfully!');
  })
  .catch((err) => {
    console.error('❌ PostgreSQL connection error:', err);
  });

export default pool;
