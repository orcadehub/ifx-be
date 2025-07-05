import express from "express";
import pool from "../config/db.js";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";

const router = express.Router();
import dotenv from "dotenv";
dotenv.config();

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // use STARTTLS
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false, // allow self-signed certs (try removing this in production)
  },
});

// Send OTP
router.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  console.log(email);
  if (!email)
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // expires in 5 min

  try {
    await pool.query(
      `INSERT INTO otps (email, otp , expires_at) VALUES ($1, $2, $3)`,
      [email, otp, expiresAt]
    );

    await transporter.sendMail({
      from: process.env.MAIL_USER,
      to: email,
      subject: "Your OTP from InfluexKonnect",
      text: `Hi, We are from InfluexKonnect and Your OTP is ${otp}. It is valid for 5 minutes.
      Please don't share it with anyone. And if you didn't request this, please ignore this email.

              Thank you.
      
      
      Best Regards:
        Team InfluexKonnect`,
    });

    res.json({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

// Verify OTP
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res
      .status(400)
      .json({ success: false, message: "Email and OTP are required" });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM otps WHERE email = $1 AND otp = $2 ORDER BY created_at DESC LIMIT 1`,
      [email, otp]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    const record = result.rows[0];

    if (new Date() > new Date(record.expires_at)) {
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    await pool.query(`UPDATE otps SET verified = true WHERE id = $1`, [
      record.id,
    ]);

    res.json({ success: true, message: "OTP verified successfully" });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ success: false, message: "Failed to verify OTP" });
  }
});


// Reset password after OTP verification
router.post("/reset-password", async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res
      .status(400)
      .json({ success: false, message: "Email and new password are required" });
  }

  try {
    // Check latest verified OTP
    const result = await pool.query(
      `SELECT * FROM otps WHERE email = $1 AND verified = true ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "OTP not verified" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(`UPDATE users SET password = $1 WHERE email = $2`, [
      hashedPassword,
      email,
    ]);

    // Send confirmation email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset - InfluexKonnect",
      html: `
        <p>Hello,</p>
        <p>Your password has been successfully reset on <b>InfluexKonnect</b>.</p>
        <p>If you did not request this, please contact our support immediately.</p>
        <p>Thank you,<br/>InfluexKonnect Team</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: "Password updated and confirmation email sent",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Server error while resetting password",
      });
  }
});

export default router;
