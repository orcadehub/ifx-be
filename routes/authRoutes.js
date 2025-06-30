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
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'influencer', 'admin'))
      )
    `);
    res.status(200).json({ message: "✅ Users table with role created" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "❌ Failed to create users table" });
  }
});

router.post("/signup", async (req, res) => {
  const { role, fullname, email, password, company } = req.body;
  const allowedRoles = ["business", "influencer", "admin"];
  console.log(req.body);
  if (!role) {
    return res.status(400).json({
      message: "❌ Please select a role first (business, influencer, admin).",
    });
  }

  if (!allowedRoles.includes(role)) {
    return res.status(400).json({
      message: "❌ Invalid role. Must be user, influencer, or admin.",
    });
  }

  if (!fullname || !email || !password) {
    return res.status(400).json({
      message: `❌ Missing required fields. Provide name, email, and password for role: ${role}.`,
    });
  }

  try {
    // Check if email already exists in any role
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length > 0) {
      return res.status(400).json({ message: "❌ Email already exists" });
    }

    // Hash password and insert
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (fullname, email, password, role,company) VALUES ($1, $2, $3, $4,$5)",
      [fullname, email, hashedPassword, role, company]
    );

    res.status(201).json({
      message: `✅ ${
        role.charAt(0).toUpperCase() + role.slice(1)
      } registered successfully.`,
    });
  } catch (err) {
    console.error(err);
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
