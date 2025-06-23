import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createUser, findUserByEmailOrPhone } from '../models/userModel.js';

export const signup = async (req, res) => {
  try {
    const { username, email, phone, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await createUser(username, email, phone, hashedPassword);
    res.status(201).json({ message: 'User created', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { userInput, password } = req.body;
    const user = await findUserByEmailOrPhone(userInput);
    if (!user) return res.status(400).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id }, 'jwt-secret', { expiresIn: '1d' });
    res.json({ message: 'Login success', token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
