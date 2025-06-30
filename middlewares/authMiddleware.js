// middleware/auth.js
import jwt  from 'jsonwebtoken'
import dotenv from "dotenv";
dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({ message: '❌ Authorization header missing' });
  }

  const token = authHeader.split(' ')[1]; // Expected: Bearer <token>
  if (!token) {
    return res.status(401).json({ message: '❌ Token not provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // decoded = { id, email, role }
    next();
  } catch (err) {
    return res.status(403).json({ message: '❌ Invalid or expired token' });
  }
};

export default authenticateToken;