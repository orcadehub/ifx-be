import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import auth from './routes/autth.js'
import dataDeletionRoutes from './routes/dataDeletionRoutes.js';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/autth', auth);
app.use('/api', dataDeletionRoutes);



const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
