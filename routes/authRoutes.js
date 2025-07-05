// routes/api.js
import express from "express";
import bcrypt from "bcryptjs";
import pool from "../config/db.js";
const router = express.Router();
import dotenv from "dotenv";
dotenv.config();

// ✅ Login
import jwt from "jsonwebtoken";

// secret key for JWT (in real apps, keep this in env variables)
const JWT_SECRET = process.env.JWT_SECRET;

// ✅ Create Users Table
router.get("/createtable/users", async (req, res) => {
  try {
    await pool.query(`


CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW()
);
    `);
    res.status(200).json({ message: "✅ Users table with role created" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "❌ Failed to create users table" });
  }
});




// Allowed roles
const allowedRoles = ["business", "influencer", "admin"];

router.post("/signup", async (req, res) => {
  const { role, fullname, email, phone, password } = req.body;

  if (!role || !allowedRoles.includes(role)) {
    return res.status(400).json({
      message: "❌ Please select a valid role: business, influencer, or admin.",
    });
  }

  if (!fullname || !email || !phone || !password) {
    return res.status(400).json({
      message: `❌ Missing fields. Provide fullname, email, phone, and password for role: ${role}.`,
    });
  }
  try {
    // 1. Check if OTP is verified
    const otpCheck = await pool.query(
      `SELECT * FROM otps WHERE email = $1 AND verified = true ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    if (otpCheck.rows.length === 0) {
      return res.status(403).json({
        message: "❌ OTP not verified. Please verify your email first.",
      });
    }

    // 2. Check for duplicate email or phone
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR phone = $2",
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        message: "❌ Email or Phone already exists.",
      });
    }

    // 3. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Insert user
    const insertResult = await pool.query(
      "INSERT INTO users (fullname, email, phone, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, fullname, email, phone, role",
      [fullname, email, phone, hashedPassword, role]
    );

    // 5. Cleanup OTP
    await pool.query(`DELETE FROM otps WHERE email = $1`, [email]);

    res.status(201).json({
      message: `✅ ${role.charAt(0).toUpperCase() + role.slice(1)} registered successfully.`,
      user: insertResult.rows[0],
    });
  } catch (err) {
    console.error("❌ Signup Error:", err);
    res.status(500).json({ message: "❌ Signup failed due to server error." });
  }
});

router.post("/login", async (req, res) => {
  const { email, password, role } = req.body;
  console.log("login");
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "❌ User not found" });
    }

    const user = result.rows[0];

    // ✅ Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "❌ Invalid credentials" });
    }

    // ✅ Check if role matches
    if (role && user.role !== role) {
      return res.status(403).json({
        message: `❌ Access denied. This email is registered as '${user.role}', not '${role}'.`,
      });
    }

    // ✅ Create token
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(payload, JWT_SECRET);

    res.status(200).json({
      message: "✅ Login successful",
      token,
      user: {
        id: user.id,
        fullname: user.fullname,
        email: user.email,
        role: user.role,
        company: user.company || null,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "❌ Login failed" });
  }
});

export default router;



